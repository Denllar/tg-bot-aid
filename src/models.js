import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String }
});

const requestSchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Category',
    required: true
  },
  answer: { type: String, default: '' } // Добавляем поле для ответа
});

// Модель юриста
const lawyerSchema = new mongoose.Schema({
  request: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Request',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  contact: {
    type: String,
    required: true
  },
  link: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  }
});

// Схема для заявок от юристов
const lawyerApplicationSchema = new mongoose.Schema({
  name: { type: String, required: true }, // ФИО юриста
  telegramChannel: { type: String }, // Ссылка на телеграм канал
  phone: { type: String, required: true }, // Номер телефона
  createdAt: { type: Date, default: Date.now }
});

export const LawyerApplication = mongoose.model('LawyerApplication', lawyerApplicationSchema);
export const Category = mongoose.model('Category', categorySchema);
export const Request = mongoose.model('Request', requestSchema);
export const Lawyer = mongoose.model('Lawyer', lawyerSchema);