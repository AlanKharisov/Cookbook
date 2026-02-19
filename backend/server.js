const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

// ========== ПЕРЕВІРКА СЕРЕДОВИЩА ==========
const isProduction = process.env.NODE_ENV === 'production';
console.log('🌍 Environment:', isProduction ? 'PRODUCTION (Render)' : 'DEVELOPMENT (Local)');

// ========== ІНІЦІАЛІЗАЦІЯ FIREBASE ADMIN ==========
let serviceAccount;

if (isProduction) {
  // НА RENDER: беремо з змінних середовища
  console.log('📡 Loading Firebase config from environment variables...');
  try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
      console.error('❌ FIREBASE_SERVICE_ACCOUNT environment variable is not set!');
      console.error('Please add it in Render dashboard → Environment Variables');
      process.exit(1);
    }
    
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log('✅ Firebase configured from environment variables');
    console.log('📁 Project ID:', serviceAccount.project_id);
  } catch (error) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error.message);
    process.exit(1);
  }
} else {
  // ЛОКАЛЬНО: беремо з файлу
  console.log('📡 Loading Firebase config from local file...');
  try {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Firebase configured from serviceAccountKey.json');
    console.log('📁 Project ID:', serviceAccount.project_id);
  } catch (error) {
    console.error('❌ serviceAccountKey.json not found!');
    console.error('Please download it from Firebase Console:');
    console.error('Project Settings → Service Accounts → Generate new private key');
    process.exit(1);
  }
}

// ========== ФОРМУЄМО ПРАВИЛЬНИЙ DATABASE URL ==========
const databaseURL = `https://${serviceAccount.project_id}-default-rtdb.firebaseio.com`;

// Ініціалізація Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: databaseURL
  });
  console.log('🔥 Firebase Admin initialized successfully');
  console.log('🔗 Database URL:', databaseURL);
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  process.exit(1);
}

// ========== СТВОРЮЄМО EXPRESS APP ==========
const app = express();
const db = admin.database();

// ========== НАЛАШТУВАННЯ CORS ==========
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== ЛОГУВАННЯ ЗАПИТІВ ==========
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// ========== ГОЛОВНИЙ МАРШРУТ ==========
app.get('/', (req, res) => {
  res.json({
    name: '🍳 Cookbook API',
    version: '1.0.0',
    status: 'running',
    message: 'API is working!',
    environment: isProduction ? 'production' : 'development',
    projectId: serviceAccount.project_id,
    databaseURL: databaseURL,
    timestamp: new Date().toISOString(),
    endpoints: {
      root: 'GET / - цей список',
      health: 'GET /api/health - перевірка статусу',
      auth: 'POST /api/auth/verify - перевірка токена',
      categories: 'GET /api/categories - всі категорії',
      createCategory: 'POST /api/categories - створити категорію',
      dishes: 'GET /api/categories/:catId/dishes - страви категорії',
      createDish: 'POST /api/categories/:catId/dishes - додати страву',
      debug: 'GET /api/debug - діагностика'
    }
  });
});

// ========== ТЕСТОВИЙ МАРШРУТ ==========
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Cookbook API is healthy',
    timestamp: new Date().toISOString(),
    environment: isProduction ? 'production' : 'development',
    database: databaseURL ? 'connected' : 'not configured'
  });
});

// ========== ДІАГНОСТИЧНИЙ МАРШРУТ ==========
app.get('/api/debug', (req, res) => {
  res.json({
    projectId: serviceAccount.project_id,
    databaseURL: databaseURL,
    environment: isProduction ? 'production' : 'development',
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    headers: {
      hasAuth: !!req.headers.authorization
    }
  });
});

// ========== МІДЛВАР АВТОРИЗАЦІЇ ==========
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  
  try {
    console.log('🔑 Verifying token...');
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log('✅ Token verified for:', decodedToken.email);
    console.log('📌 User ID:', decodedToken.uid);
    
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('❌ Token verification failed:', error.code, error.message);
    
    if (error.code === 'auth/argument-error') {
      return res.status(400).json({ error: 'Invalid token format' });
    } else if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ error: 'Token expired' });
    } else {
      return res.status(403).json({ error: 'Invalid token: ' + error.message });
    }
  }
};

// ========== АУТЕНТИФІКАЦІЯ ==========
app.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    const userRecord = await admin.auth().getUser(decodedToken.uid);
    
    res.json({
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: userRecord.displayName || '',
      emailVerified: decodedToken.email_verified
    });
  } catch (error) {
    console.error('Auth verification error:', error.message);
    res.status(401).json({ error: error.message });
  }
});

// ========== КАТЕГОРІЇ ==========
// Отримати всі категорії
app.get('/api/categories', authenticate, async (req, res) => {
  try {
    console.log('📥 Fetching categories for user:', req.user.uid);
    
    // Пробуємо різні шляхи
    let snapshot = await db
      .ref(`users/${req.user.uid}/categories`)
      .once('value');
    
    let categories = snapshot.val();
    
    // Якщо немає даних, пробуємо кореневий шлях
    if (!categories) {
      console.log('📥 No data in users path, trying root...');
      const rootSnapshot = await db.ref('/').once('value');
      const rootData = rootSnapshot.val();
      
      if (rootData && rootData.categories) {
        categories = rootData.categories;
      } else {
        categories = {};
      }
    }
    
    console.log('✅ Found', Object.keys(categories).length, 'categories');
    res.json(categories);
    
  } catch (error) {
    console.error('Error fetching categories:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Створити категорію
app.post('/api/categories', authenticate, async (req, res) => {
  const { name } = req.body;
  
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Category name is required' });
  }
  
  try {
    const catId = db.ref().push().key;
    const categoryData = {
      name: name.trim(),
      dishes: {}
    };
    
    // Зберігаємо в обидва місця
    await db
      .ref(`users/${req.user.uid}/categories/${catId}`)
      .set(categoryData);
    
    await db
      .ref(`categories/${catId}`)
      .set(categoryData);
    
    console.log('✅ Category created for user:', req.user.uid, 'ID:', catId);
    res.status(201).json({ 
      id: catId, 
      name: name.trim() 
    });
  } catch (error) {
    console.error('Error creating category:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Оновити категорію
app.put('/api/categories/:catId', authenticate, async (req, res) => {
  const { name } = req.body;
  const { catId } = req.params;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Category name is required' });
  }
  
  try {
    await db
      .ref(`users/${req.user.uid}/categories/${catId}/name`)
      .set(name.trim());
    
    await db
      .ref(`categories/${catId}/name`)
      .set(name.trim());
    
    console.log('✅ Category updated:', catId);
    res.json({ id: catId, name: name.trim() });
  } catch (error) {
    console.error('Error updating category:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Видалити категорію
app.delete('/api/categories/:catId', authenticate, async (req, res) => {
  const { catId } = req.params;
  
  try {
    await db
      .ref(`users/${req.user.uid}/categories/${catId}`)
      .remove();
    
    await db
      .ref(`categories/${catId}`)
      .remove();
    
    console.log('✅ Category deleted:', catId);
    res.json({ success: true, id: catId });
  } catch (error) {
    console.error('Error deleting category:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== СТРАВИ ==========
// Отримати страви категорії
app.get('/api/categories/:catId/dishes', authenticate, async (req, res) => {
  const { catId } = req.params;
  
  try {
    let snapshot = await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes`)
      .once('value');
    
    let dishes = snapshot.val();
    
    if (!dishes) {
      console.log('📥 Trying root path for dishes...');
      snapshot = await db
        .ref(`categories/${catId}/dishes`)
        .once('value');
      dishes = snapshot.val();
    }
    
    console.log('📥 Found', Object.keys(dishes || {}).length, 'dishes in category', catId);
    res.json(dishes || {});
  } catch (error) {
    console.error('Error fetching dishes:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Додати страву
app.post('/api/categories/:catId/dishes', authenticate, async (req, res) => {
  const { catId } = req.params;
  const { name, description = '', favorite = false } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Dish name is required' });
  }
  
  try {
    const dishId = db.ref().push().key;
    const dishData = {
      name: name.trim(),
      description: description || '',
      favorite: !!favorite
    };
    
    await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes/${dishId}`)
      .set(dishData);
    
    await db
      .ref(`categories/${catId}/dishes/${dishId}`)
      .set(dishData);
    
    console.log('✅ Dish created:', dishId);
    res.status(201).json({ id: dishId, ...dishData });
  } catch (error) {
    console.error('Error creating dish:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Оновити страву
app.put('/api/categories/:catId/dishes/:dishId', authenticate, async (req, res) => {
  const { catId, dishId } = req.params;
  const updates = req.body;
  
  delete updates.id;
  
  try {
    await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes/${dishId}`)
      .update(updates);
    
    await db
      .ref(`categories/${catId}/dishes/${dishId}`)
      .update(updates);
    
    console.log('✅ Dish updated:', dishId);
    res.json({ id: dishId, ...updates });
  } catch (error) {
    console.error('Error updating dish:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Видалити страву
app.delete('/api/categories/:catId/dishes/:dishId', authenticate, async (req, res) => {
  const { catId, dishId } = req.params;
  
  try {
    await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes/${dishId}`)
      .remove();
    
    await db
      .ref(`categories/${catId}/dishes/${dishId}`)
      .remove();
    
    console.log('✅ Dish deleted:', dishId);
    res.json({ success: true, id: dishId });
  } catch (error) {
    console.error('Error deleting dish:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Переключити улюблене
app.patch('/api/categories/:catId/dishes/:dishId/favorite', authenticate, async (req, res) => {
  const { catId, dishId } = req.params;
  
  try {
    const favRef = db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes/${dishId}/favorite`);
    
    const snapshot = await favRef.once('value');
    const current = !!snapshot.val();
    const newValue = !current;
    
    await favRef.set(newValue);
    
    await db
      .ref(`categories/${catId}/dishes/${dishId}/favorite`)
      .set(newValue);
    
    console.log('✅ Favorite toggled:', dishId, newValue);
    res.json({ favorite: newValue });
  } catch (error) {
    console.error('Error toggling favorite:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = process.env.PORT || 4501;

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(50));
  console.log('🍳 Cookbook Backend Server');
  console.log('='.repeat(50));
  console.log(`📍 Port: ${PORT}`);
  console.log(`📁 Project: ${serviceAccount.project_id}`);
  console.log(`🔗 Database: ${databaseURL}`);
  console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  if (isProduction) {
    console.log(`🔗 Public URL: ${process.env.RENDER_EXTERNAL_URL || 'Not set'}`);
  }
  console.log('\n✅ Available endpoints:');
  console.log('   • GET  /');
  console.log('   • GET  /api/health');
  console.log('   • GET  /api/debug');
  console.log('   • POST /api/auth/verify');
  console.log('   • GET  /api/categories');
  console.log('   • POST /api/categories');
  console.log('   • GET  /api/categories/:catId/dishes');
  console.log('   • POST /api/categories/:catId/dishes');
  console.log('='.repeat(50) + '\n');
});

// ========== ОБРОБКА ПОМИЛОК ==========
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error(error.stack);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error.message);
  console.error(error.stack);
});
