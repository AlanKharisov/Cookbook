const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

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
  } catch (error) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT:', error.message);
    console.error('Make sure it contains valid JSON string');
    process.exit(1);
  }
} else {
  // ЛОКАЛЬНО: беремо з файлу
  console.log('📡 Loading Firebase config from local file...');
  try {
    serviceAccount = require('./serviceAccountKey.json');
    console.log('✅ Firebase configured from serviceAccountKey.json');
  } catch (error) {
    console.error('❌ serviceAccountKey.json not found!');
    console.error('Please download it from Firebase Console:');
    console.error('Project Settings → Service Accounts → Generate new private key');
    process.exit(1);
  }
}

// Ініціалізація Firebase Admin
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://notebook-66f4e-default-rtdb.firebaseio.com'
  });
  console.log('🔥 Firebase Admin initialized successfully');
} catch (error) {
  console.error('❌ Firebase initialization failed:', error.message);
  process.exit(1);
}

const app = express();
const db = admin.database();

// ========== НАЛАШТУВАННЯ CORS (ТИМЧАСОВО ДЛЯ ТЕСТУ) ==========
app.use(cors({
  origin: '*',  // ДОЗВОЛЯЄ ВСІ ДОМЕНИ!
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========== ЛОГУВАННЯ ==========
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  if (!isProduction || req.method !== 'GET') {
    console.log(`[${timestamp}] ${req.method} ${req.url}`);
  }
  next();
});

// ========== БАЗОВИЙ МАРШРУТ ==========
app.get('/', (req, res) => {
  res.json({
    name: 'Cookbook API',
    version: '1.0.0',
    status: 'running',
    environment: isProduction ? 'production' : 'development',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/api/health',
      auth: '/api/auth/verify',
      categories: '/api/categories',
      sampleData: '/api/sample-data',
      payment: '/api/create-payment'
    }
  });
});

// ========== МІДЛВАР АВТОРИЗАЦІЇ ==========
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// ========== ТЕСТОВИЙ ЕНДПОІНТ ==========
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Cookbook API is running',
    environment: isProduction ? 'production' : 'development'
  });
});

// ========== АУТЕНТИФІКАЦІЯ ==========
app.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }
  
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    // Отримуємо додаткову інформацію про користувача
    const userRecord = await admin.auth().getUser(decodedToken.uid);
    
    res.json({
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: userRecord.displayName || decodedToken.name || '',
      emailVerified: decodedToken.email_verified
    });
  } catch (error) {
    console.error('Auth verification error:', error.message);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// ========== КАТЕГОРІЇ ==========
// Отримати всі категорії
app.get('/api/categories', authenticate, async (req, res) => {
  try {
    const snapshot = await db
      .ref(`users/${req.user.uid}/categories`)
      .once('value');
    
    const categories = snapshot.val() || {};
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
    
    await db
      .ref(`users/${req.user.uid}/categories/${catId}`)
      .set(categoryData);
    
    res.status(201).json({ 
      id: catId, 
      ...categoryData 
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
    const snapshot = await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes`)
      .once('value');
    
    const dishes = snapshot.val() || {};
    res.json(dishes);
  } catch (error) {
    console.error('Error fetching dishes:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Додати страву
app.post('/api/categories/:catId/dishes', authenticate, async (req, res) => {
  const { catId } = req.params;
  const { name, description = '', favorite = false, videoUrl = '' } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Dish name is required' });
  }
  
  try {
    const dishId = db.ref().push().key;
    const dishData = {
      name: name.trim(),
      description: description || '',
      favorite: !!favorite,
      videoUrl: videoUrl || ''
    };
    
    await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes/${dishId}`)
      .set(dishData);
    
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
  
  // Видаляємо заборонені поля
  delete updates.id;
  
  try {
    const dishRef = db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes/${dishId}`);
    
    // Перевіряємо чи існує страва
    const snapshot = await dishRef.once('value');
    if (!snapshot.exists()) {
      return res.status(404).json({ error: 'Dish not found' });
    }
    
    await dishRef.update(updates);
    
    const updated = await dishRef.once('value');
    res.json({ id: dishId, ...updated.val() });
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
    
    res.json({ favorite: newValue });
  } catch (error) {
    console.error('Error toggling favorite:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== ЗРАЗКОВІ ДАНІ ==========
app.post('/api/sample-data', authenticate, async (req, res) => {
  try {
    const sampleCategories = {
      sample1: {
        name: "Салати",
        dishes: {
          dish1: {
            name: "Грецький салат",
            description: "Класичний грецький салат з сиром фета, оливками та свіжими овочами.",
            favorite: false,
            videoUrl: ""
          },
          dish2: {
            name: "Цезар",
            description: "Салат з куркою, сухариками та соусом цезар.",
            favorite: true,
            videoUrl: ""
          }
        }
      },
      sample2: {
        name: "Супи",
        dishes: {
          dish1: {
            name: "Борщ",
            description: "Традиційний український борщ з буряком та капустою.",
            favorite: true,
            videoUrl: ""
          }
        }
      },
      sample3: {
        name: "Десерти",
        dishes: {
          dish1: {
            name: "Наполеон",
            description: "Класичний торт Наполеон з заварним кремом.",
            favorite: false,
            videoUrl: ""
          }
        }
      }
    };
    
    await db
      .ref(`users/${req.user.uid}/categories`)
      .set(sampleCategories);
    
    res.json({ success: true, message: 'Sample data created' });
  } catch (error) {
    console.error('Error creating sample data:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Видалити всі дані
app.delete('/api/all-data', authenticate, async (req, res) => {
  try {
    await db
      .ref(`users/${req.user.uid}`)
      .remove();
    
    res.json({ success: true, message: 'All data deleted' });
  } catch (error) {
    console.error('Error deleting data:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ========== ПЛАТЕЖІ (STRIPE) ==========
// Перевіряємо чи є Stripe ключ
if (process.env.STRIPE_SECRET_KEY) {
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  
  app.post('/api/create-payment', authenticate, async (req, res) => {
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: 1500,
        currency: 'usd',
        metadata: {
          firebaseUid: req.user.uid,
          type: 'lifetime_access'
        }
      });
      
      res.json({
        clientSecret: paymentIntent.client_secret
      });
    } catch (error) {
      console.error('Stripe error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
  
  app.post('/api/payment-success', authenticate, async (req, res) => {
    const { paymentIntentId } = req.body;
    
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      
      if (paymentIntent.status === 'succeeded') {
        await db.ref(`users/${req.user.uid}/payment`).set({
          type: 'lifetime',
          amount: paymentIntent.amount,
          paidAt: new Date().toISOString(),
          status: 'active',
          paymentIntentId: paymentIntent.id
        });
        
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Payment not succeeded' });
      }
    } catch (error) {
      console.error('Payment success error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
  
  app.get('/api/check-payment', authenticate, async (req, res) => {
    try {
      const snapshot = await db.ref(`users/${req.user.uid}/payment`).once('value');
      const payment = snapshot.val();
      
      res.json({ 
        hasLifetimeAccess: payment?.status === 'active',
        paidAt: payment?.paidAt || null
      });
    } catch (error) {
      console.error('Check payment error:', error.message);
      res.status(500).json({ error: error.message });
    }
  });
  
  console.log('💳 Stripe payments enabled');
} else {
  console.log('⚠️ Stripe payments disabled (STRIPE_SECRET_KEY not set)');
}

// ========== ЗАПУСК СЕРВЕРА ==========
const PORT = process.env.PORT || 4501;

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(40));
  console.log('🍳 Cookbook Backend Server');
  console.log('='.repeat(40));
  console.log(`📍 Server: http://0.0.0.0:${PORT}`);
  console.log(`📊 Health: http://0.0.0.0:${PORT}/api/health`);
  console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  if (isProduction) {
    console.log(`🔗 Public URL: ${process.env.RENDER_EXTERNAL_URL || 'Not set'}`);
  }
  console.log('='.repeat(40) + '\n');
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
