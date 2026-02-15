const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/format-recipe', async (req, res) => {
  const { text } = req.body;
  
  console.log('📝 Отримано текст:', text);
  
  try {
    const formatted = formatRecipePerfect(text);
    res.json({ cleaned_recipe: formatted });
  } catch (error) {
    console.error('Помилка:', error.message);
    const localFormat = formatRecipePerfect(text);
    res.json({ cleaned_recipe: localFormat });
  }
});

function formatRecipePerfect(text) {
  // 1. ОЧИЩАЄМО ТЕКСТ
  let cleanText = text
    .replace(/\s+/g, ' ')                 // зайві пробіли в один
    .replace(/опис$/i, '')                // видаляємо "опис" в кінці
    .replace(/опис\s+/i, ' ')             // видаляємо "опис" з пробілами
    .replace(/(\d+)\s*г\s*([а-яіїєґ']+)/gi, '$1 г $2') // нормалізуємо "200 г муки"
    .trim();
  
  // 2. ЗБИРАЄМО ІНГРЕДІЄНТИ
  const ingredients = [];
  const instructions = [];
  
  // Шукаємо всі інгредієнти (числа + одиниці + назви)
  const words = cleanText.split(' ');
  let i = 0;
  
  while (i < words.length) {
    const word = words[i];
    
    // Якщо це число
    if (word.match(/^\d+$/)) {
      let ingredient = word;
      i++;
      
      // Додаємо одиницю виміру (г, кг, мл, шт, хв...)
      if (i < words.length && words[i].match(/^(г|кг|мл|л|шт|хв|яйця?|ложк|склян|чайна|столова|штук|хвилин)/i)) {
        ingredient += ' ' + words[i];
        i++;
        
        // Додаємо назву продукту
        if (i < words.length && words[i].match(/^[а-яіїєґ']+$/i)) {
          ingredient += ' ' + words[i];
          i++;
        }
      }
      
      ingredients.push(ingredient);
    } else {
      i++;
    }
  }
  
  // 3. ЗБИРАЄМО ІНСТРУКЦІЇ
  let instructionText = cleanText;
  
  // Видаляємо всі знайдені інгредієнти з тексту
  ingredients.forEach(ing => {
    instructionText = instructionText.replace(ing, '');
  });
  
  // Очищаємо текст інструкцій
  instructionText = instructionText
    .replace(/\s+/g, ' ')
    .trim();
  
  // Розбиваємо на окремі дії
  if (instructionText) {
    // Розділяємо по ключових словах
    let parts = instructionText.split(/(?=зміша|виклас|піджар|вар|пекти|смаж|ріж|чист|дода|нали|посип|зби|заміс|налип|засун|почек)/i);
    
    parts.forEach(part => {
      const cleanPart = part.trim();
      if (cleanPart && cleanPart.length > 2) {
        // Додаємо крапку в кінці якщо немає
        let finalPart = cleanPart;
        if (!finalPart.match(/[.!?]$/)) {
          finalPart += '.';
        }
        // Робимо першу букву великою
        finalPart = finalPart.charAt(0).toUpperCase() + finalPart.slice(1);
        instructions.push(finalPart);
      }
    });
  }
  
  // 4. ФОРМАТУЄМО РЕЗУЛЬТАТ БЕЗ ЗАЙВИХ ПРОБІЛІВ
  let result = '';

result += '<h3>Інгредієнти</h3>';
result += '<ul>';

uniqueIngredients.forEach(ing => {
  result += `<li>${ing}</li>`;
});

result += '</ul>';

result += '<h3>Приготування</h3>';
result += '<ol>';

instructions.forEach((inst, index) => {
  result += `<li>${inst}</li>`;
});

result += '</ol>';

return result;
}

const PORT = 4504;
app.listen(PORT, () => {
  console.log('🤖 AI-проксі запущено на http://localhost:4504');
  console.log('📝 Ідеальне форматування рецептів готове!');
});