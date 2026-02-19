// ========== КАТЕГОРІЇ ==========
// Отримати всі категорії
app.get('/api/categories', authenticate, async (req, res) => {
  try {
    console.log('📥 Fetching categories for user:', req.user.uid);
    
    // СПРОБУЄМО РІЗНІ ШЛЯХИ
    let snapshot;
    
    // Спочатку пробуємо шлях з users/${uid}
    snapshot = await db
      .ref(`users/${req.user.uid}/categories`)
      .once('value');
    
    let categories = snapshot.val();
    
    // Якщо немає даних, пробуємо кореневий шлях
    if (!categories) {
      console.log('📥 No data in users path, trying root...');
      const rootSnapshot = await db.ref('/').once('value');
      const rootData = rootSnapshot.val();
      
      // Перевіряємо чи є категорії в корені
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
    
    // ЗБЕРІГАЄМО В ОБИДВА МІСЦЯ ДЛЯ СУМІСНОСТІ
    await db
      .ref(`users/${req.user.uid}/categories/${catId}`)
      .set(categoryData);
    
    // Також зберігаємо в корінь
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
    // Оновлюємо в обох місцях
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
    // Видаляємо з обох місць
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
    // Спочатку пробуємо users/${uid}
    let snapshot = await db
      .ref(`users/${req.user.uid}/categories/${catId}/dishes`)
      .once('value');
    
    let dishes = snapshot.val();
    
    // Якщо немає, пробуємо корінь
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
    
    // Зберігаємо в обох місцях
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
    // Оновлюємо в обох місцях
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
    // Видаляємо з обох місць
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
    
    // Також оновлюємо в корені
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
