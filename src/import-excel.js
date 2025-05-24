// Изменяем импорт xlsx
import xlsx from 'xlsx';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Category, Request } from './models.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Получаем абсолютный путь к текущему файлу
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

/**
 * Импортирует вопросы и ответы из Excel-файла в указанную категорию
 * @param {string} filePath - путь к Excel-файлу
 * @param {string} categoryId - ID категории или название новой категории
 * @param {boolean} createCategory - создать новую категорию, если true
 */
async function importQuestionsFromExcel(filePath, categoryId, createCategory = false) {
  try {
    // Чтение Excel-файла - используем xlsx.readFile вместо readFile
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Преобразование в JSON
    const data = [];
    let row = 2; // Начинаем со второй строки (пропускаем заголовки)
    
    while (true) {
      const questionCell = worksheet[`A${row}`];
      const answerCell = worksheet[`B${row}`];
      
      if (!questionCell) break; // Если ячейка пуста, значит достигли конца данных
      
      const question = questionCell.v;
      const answer = answerCell ? answerCell.v : '';
      
      if (question) {
        data.push({ question, answer });
      }
      
      row++;
    }
    
    // Получение или создание категории
    let category;
    
    if (createCategory) {
      // Создаем новую категорию
      category = new Category({ name: categoryId });
      await category.save();
      console.log(`Создана новая категория: ${categoryId}`);
    } else {
      // Ищем существующую категорию
      category = await Category.findById(categoryId);
      
      if (!category) {
        // Пробуем найти по имени
        category = await Category.findOne({ name: categoryId });
        
        if (!category) {
          throw new Error(`Категория с ID или именем "${categoryId}" не найдена`);
        }
      }
    }
    
    // Создание запросов
    let createdCount = 0;
    for (const item of data) {
      const request = new Request({
        title: item.question,
        category: category._id,
        answer: item.answer
      });
      
      await request.save();
      createdCount++;
    }
    
    console.log(`Импорт завершен. Добавлено ${createdCount} вопросов в категорию "${category.name}"`);
    
    // Закрываем соединение с базой данных
    await mongoose.connection.close();
    
  } catch (error) {
    console.error('Ошибка при импорте данных:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Проверка аргументов командной строки
const args = process.argv.slice(2);

if (args.length < 2) {
  console.log('Использование: node import-excel.js <путь_к_файлу> <id_категории> [создать_категорию]');
  console.log('Пример: node import-excel.js ./data/questions.xlsx 60f8a9b3e6b3a12345678901');
  console.log('Пример создания новой категории: node import-excel.js ./data/questions.xlsx "Юридические вопросы" true');
  process.exit(1);
}

const filePath = args[0];
const categoryId = args[1];
const createCategory = args[2] === 'true';

importQuestionsFromExcel(filePath, categoryId, createCategory);