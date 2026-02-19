// ВАШ ПРАВИЛЬНИЙ КОД НА БЕКЕНДІ
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';
console.log('🌍 Environment:', isProduction ? 'PRODUCTION' : 'DEVELOPMENT');

// ========== ІНІЦІАЛІЗАЦІЯ FIREBASE ADMIN ==========
let serviceAccount;

if (isProduction) {
  // НА RENDER
  if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT not set!');
    process.exit(1);
  }
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  // ЛОКАЛЬНО
  try {
    serviceAccount = require('./serviceAccountKey.json');
  } catch (error) {
    console.error('❌ serviceAccountKey.json not found!');
    process.exit(1);
  }
}

// ВАЖЛИВО: databaseURL має бути з вашого Firebase проекту!
const databaseURL = `https://${serviceAccount.projectId}-default-rtdb.firebaseio.com`;

try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: databaseURL
  });
  console.log('🔥 Firebase Admin initialized');
  console.log('📁 Project ID:', serviceAccount.projectId);
  console.log('🔗 Database URL:', databaseURL);
} catch (error) {
  console.error('❌ Firebase init failed:', error);
  process.exit(1);
}

const app = express();
const db = admin.database();

// CORS
app.use(cors({
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ===== ТЕСТОВИЙ МАРШРУТ =====
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    projectId: serviceAccount.projectId,
    timestamp: new Date().toISOString() 
  });
});

// ===== МІДЛВАР АВТОРИЗАЦІЇ =====
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.log('❌ No token provided');
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split('Bearer ')[1];
  
  try {
    // ДЕТАЛЬНЕ ЛОГУВАННЯ
    console.log('🔑 Verifying token...');
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log('✅ Token verified for:', decodedToken.email);
    console.log('📌 Token expires:', new Date(decodedToken.exp * 1000).toISOString());
    
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

// ===== АУТЕНТИФІКАЦІЯ =====
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
    console.error('Auth error:', error);
    res.status(401).json({ error: error.message });
  }
});

// ===== КАТЕГОРІЇ =====
app.get('/api/categories', authenticate, async (req, res) => {
  try {
    console.log('📥 Fetching categories for user:', req.user.uid);
    const snapshot = await db
      .ref(`users/${req.user.uid}/categories`)
      .once('value');
    
    const categories = snapshot.val() || {};
    console.log('✅ Found', Object.keys(categories).length, 'categories');
    res.json(categories);
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categories', authenticate, async (req, res) => {
  const { name } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Category name required' });
  }
  
  try {
    const catId = db.ref().push().key;
    await db
      .ref(`users/${req.user.uid}/categories/${catId}`)
      .set({ name: name.trim(), dishes: {} });
    
    res.status(201).json({ id: catId, name: name.trim() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== СТРАВИ =====
app.get('/api/categories/:catId/dishes', authenticate, async (req, res) => {
  const { catId } = req.params;
  
  try {
    const snapshot = await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes`)
      .once('value');
    
    res.json(snapshot.val() || {});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/categories/:catId/dishes', authenticate, async (req, res) => {
  const { catId } = req.params;
  const { name, description = '', favorite = false } = req.body;
  
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Dish name required' });
  }
  
  try {
    const dishId = db.ref().push().key;
    await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes/${dishId}`)
      .set({ name: name.trim(), description, favorite });
    
    res.status(201).json({ id: dishId, name: name.trim(), description, favorite });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===== ЗАПУСК =====
const PORT = process.env.PORT || 4501;

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n' + '='.repeat(50));
  console.log('🍳 Cookbook API Server');
  console.log('='.repeat(50));
  console.log(`📍 Port: ${PORT}`);
  console.log(`📁 Project: ${serviceAccount.projectId}`);
  console.log(`🔗 Database: ${databaseURL}`);
  console.log(`🌍 Environment: ${isProduction ? 'PRODUCTION' : 'DEVELOPMENT'}`);
  console.log('='.repeat(50) + '\n');
});
