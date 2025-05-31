import { Bot, InlineKeyboard, Keyboard } from 'grammy';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Category, Request, Lawyer, LawyerApplication, SupportApplication, UserQuestion, UserActionLog } from './models.js';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Получаем абсолютный путь к текущему файлу
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Подключение к MongoDB с увеличенным таймаутом
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000, // Увеличиваем таймаут до 30 секунд
  socketTimeoutMS: 45000, // Увеличиваем таймаут сокета
})
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Создание единого бота
const bot = new Bot(process.env.BOT_TOKEN);

// Проверка прав администратора
const isAdmin = (ctx) => {
  const adminIds = process.env.ADMIN_IDS.split(',').map(id => id.trim());
  return adminIds.includes(ctx.from.id.toString());
};

// Состояния пользователей для обработки диалогов
const userStates = {};

// Создаем клавиатуру с кнопкой "В начало"
const mainKeyboard = new Keyboard()
  .text("🏠 В начало")
  .resized();

// Базовая команда /start для всех пользователей
bot.command('start', async (ctx) => {
  try {
    await logUserAction(ctx, 'command', { command: 'start' });

    // Отправляем только текстовое приветствие
    await ctx.reply('👋 Добро пожаловать в Юридический Бот! Здесь вы найдете ответы на популярные юридические вопросы и контакты проверенных юристов по всей России. Выберите интересующее направление👇', {
      reply_markup: mainKeyboard
    });

    await showMainMenu(ctx);
  } catch (error) {
    console.error('Подробная ошибка в команде start:', error.message, error.stack);
    ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

// Обработка нажатия на кнопку "В начало"
bot.hears('🏠 В начало', async (ctx) => {
  try {
    // Логируем нажатие на кнопку
    await logUserAction(ctx, 'button_text_click', { button: '🏠 В начало' });
    await showMainMenu(ctx);
  } catch (error) {
    console.error('Error handling main button:', error);
    ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

// Команда для просмотра статистики (только для админов)
bot.command('stats', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('Доступ запрещен');
  }

  try {
    // Получаем статистику за последние 24 часа
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    // Считаем только пользователей с username (как в списке)
    const usersWithUsername = await UserActionLog.aggregate([
      { $match: { username: { $ne: null, $ne: '' } } },
      { $group: { _id: '$username' } },
      { $count: 'count' }
    ]);
    const totalUsers = usersWithUsername[0]?.count || 0;

    const totalActions = await UserActionLog.countDocuments();
    const recentActions = await UserActionLog.countDocuments({ timestamp: { $gte: oneDayAgo } });

    // Получаем топ-5 самых популярных действий
    const popularActions = await UserActionLog.aggregate([
      { $match: { timestamp: { $gte: oneDayAgo } } },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    let statsMessage = `<b>📊 Статистика бота</b>\n\n`;
    statsMessage += `👥 Всего пользователей: ${totalUsers}\n`;
    statsMessage += `🔢 Всего действий: ${totalActions}\n`;
    statsMessage += `📈 Действий за 24 часа: ${recentActions}\n\n`;

    statsMessage += `🔝 Популярные действия за 24 часа:\n`;
    popularActions.forEach((item, index) => {
      statsMessage += `${index + 1}. ${item._id}: ${item.count} раз\n`;
    });

    // Добавляем кнопку "Показать пользователей"
    const keyboard = new InlineKeyboard().row({ text: 'Показать пользователей', callback_data: 'show_users:0' });

    await ctx.reply(statsMessage, { parse_mode: 'HTML', reply_markup: keyboard });
  } catch (error) {
    console.error('Error showing stats:', error);
    ctx.reply('Произошла ошибка при получении статистики');
  }
});

// Команда для экспорта логов (только для админов)
bot.command('export_logs', async (ctx) => {
  if (!isAdmin(ctx)) {
    return ctx.reply('Доступ запрещен');
  }
  
  try {
    // Получаем логи за последние 7 дней
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const logs = await UserActionLog.find({ timestamp: { $gte: sevenDaysAgo } })
      .sort({ timestamp: -1 })
      .limit(1000); // Ограничиваем количество записей
    
    if (logs.length === 0) {
      return ctx.reply('Логи не найдены');
    }
    
    // Создаем CSV строку
    let csv = 'UserId,Username,Action,ActionData,Timestamp\n';
    
    logs.forEach(log => {
      const actionDataStr = JSON.stringify(log.actionData).replace(/"/g, '""');
      csv += `${log.userId},${log.username},${log.action},"${actionDataStr}",${log.timestamp}\n`;
    });
    
    // Создаем временный файл
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    
    const tempFilePath = path.default.join(os.default.tmpdir(), `bot_logs_${new Date().toISOString().slice(0, 10)}.csv`);
    await fs.default.writeFile(tempFilePath, csv, 'utf8');
    
    // Отправляем файл
    await ctx.replyWithDocument({
      source: tempFilePath
    });
    
    // Удаляем временный файл после отправки
    await fs.default.unlink(tempFilePath);
  } catch (error) {
    console.error('Error exporting logs:', error);
    ctx.reply('Произошла ошибка при экспорте логов');
  }
});

async function logUserAction(ctx, action, actionData = {}) {
  try {
    const userId = ctx.from.id.toString();
    const username = ctx.from.username || '';
    const firstName = ctx.from.first_name || '';
    const lastName = ctx.from.last_name || '';

    const log = new UserActionLog({
      userId,
      username,
      action,
      actionData: {
        ...actionData,
        userFullName: `${firstName} ${lastName}`.trim()
      }
    });

    await log.save();
  } catch (error) {
    console.error('Error logging user action:', error);
  }
}

// Функция для отображения главного меню
async function showMainMenu(ctx) {
  try {
    // Получаем категории из базы данных
    const categories = await Category.find({});

    // Создаем клавиатуру
    const keyboard = new InlineKeyboard();

    // Добавляем категории
    for (const category of categories) {
      keyboard.row({ text: category.name, callback_data: `category:${category._id.toString()}` });
    }

    // Добавляем кнопку "Для юристов"
    keyboard.row({ text: '👨‍⚖️ Для юристов', callback_data: 'for_lawyers' });

    // Добавляем кнопку "Связаться с поддержкой"
    keyboard.row({ text: '✉️ Связаться с поддержкой', callback_data: 'contact_support' });

    // Если пользователь админ, добавляем кнопку для создания категории
    if (isAdmin(ctx)) {
      keyboard.row({ text: '➕ Добавить категорию', callback_data: 'add_category' });
    }

    await ctx.reply('Выберите категорию права:', {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error showing main menu:', error);
    ctx.reply('Произошла ошибка при загрузке категорий. Попробуйте позже.');
  }
}

// Обработка callback запросов
bot.on('callback_query:data', async (ctx) => {
  try {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id.toString();

    // Логируем нажатие на кнопку
    await logUserAction(ctx, 'button_click', { button: data });

    // Обработка поиска вопросов
    if (data.startsWith('search:')) {
      const categoryId = data.split(':')[1];

      userStates[userId] = {
        action: 'waiting_search_query',
        categoryId
      };

      await ctx.reply('Введите ключевые слова для поиска вопросов в этой категории:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка нажатия на кнопку "Задать свой вопрос"
    if (data.startsWith('ask_question:')) {
      const categoryId = data.split(':')[1];
      const category = await Category.findById(categoryId);

      if (!category) {
        await ctx.reply('Категория не найдена');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_user_question',
        categoryId
      };

      await ctx.reply('✍️ Напишите ваш вопрос в свободной форме. Мы подберём юриста и перешлём ваш запрос: \n\n🟡 Пример: \n«Мой работодатель не подписывает приказ об увольнении и не платит отпускные. Что делать?» \n\nПосле отправки ваш вопрос получит юрист по данному направлению и свяжется с вами в течении дня.');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка добавления категории
    if (data === 'add_category') {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      userStates[userId] = { action: 'waiting_category_name' };
      await ctx.reply('Введите название новой категории:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка добавления запроса
    if (data === 'add_request' || data.startsWith('add_request:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const categoryId = data.startsWith('add_request:') ? data.split(':')[1] : userStates[userId].categoryId;

      userStates[userId] = {
        action: 'waiting_request_title',
        categoryId: categoryId
      };
      await ctx.reply('Введите название нового вопроса:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка добавления юриста
    if (data === 'add_lawyer' || data.startsWith('add_lawyer:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const requestId = data.startsWith('add_lawyer:') ? data.split(':')[1] : userStates[userId].requestId;

      userStates[userId] = {
        action: 'waiting_lawyer_name',
        requestId: requestId
      };
      await ctx.reply('Введите имя юриста:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка добавления ответа к вопросу
    if (data.startsWith('add_request_answer:') || data.startsWith('edit_request_answer:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const requestId = data.split(':')[1];
      const request = await Request.findById(requestId);

      if (!request) {
        await ctx.reply('Вопрос не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_request_answer',
        requestId
      };

      const currentAnswer = request.answer || '';
      const actionText = data.startsWith('add_request_answer:') ? 'Добавление' : 'Редактирование';

      await ctx.reply(`${actionText} ответа для вопроса:\n"${request.title}"\n\n${currentAnswer ? 'Текущий ответ:\n' + currentAnswer + '\n\n' : ''}Введите новый ответ:`);
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка нажатия на кнопку "Для юристов"
    if (data === 'for_lawyers') {
      const keyboard = new InlineKeyboard()
        .row({ text: '📝 Оставить заявку', callback_data: 'submit_lawyer_application' })
        .row({ text: '⬅️ Назад', callback_data: 'back_to_main' });

      await ctx.reply('⚖️ Хотите получать тёплые заявки без рекламы и конкурентов?\n\nНаш бот показывает вас:\n\n✔️ Только по вашей специализации \n\n✔️ Только тем, кто уже выбрал проблему\n\n💰 Стоимость — от 390 руб/мес\n📈 Конверсия в клиента — до 25%\n\n📩 Оставьте заявку — мы свяжемся и подключим вас первыми', {
        reply_markup: keyboard
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка нажатия на кнопку "Связаться с поддержкой"
    if (data === 'contact_support') {
      const keyboard = new InlineKeyboard()
        .row({ text: '📝 Оставить заявку', callback_data: 'submit_support_application' })
        .row({ text: '⬅️ Назад', callback_data: 'back_to_main' });

      await ctx.reply('🔧 Связаться с поддержкой\nЕсли у вас возникли технические вопросы или проблемы с ботом — нажмите сюда. Наша команда оперативно поможет вам.', {
        reply_markup: keyboard
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка нажатия на кнопку "Оставить заявку" в поддержку
    if (data === 'submit_support_application') {
      userStates[userId] = {
        action: 'waiting_support_application_name'
      };

      await ctx.reply('Пожалуйста, введите ваше ФИО:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка нажатия на кнопку "Оставить заявку"
    if (data === 'submit_lawyer_application') {
      userStates[userId] = {
        action: 'waiting_lawyer_application_name'
      };

      await ctx.reply('Пожалуйста, введите ваше ФИО:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка возврата в главное меню
    if (data === 'back_to_main') {
      await showMainMenu(ctx);
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка возврата к категории
    if (data.startsWith('back_to_category:')) {
      const categoryId = data.split(':')[1];
      await showRequestsForCategory(ctx, categoryId);
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка выбора категории
    if (data.startsWith('category:')) {
      const categoryId = data.split(':')[1];
      await showRequestsForCategory(ctx, categoryId, 1, '');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка пагинации категорий
    if (data.startsWith('category_page:')) {
      const parts = data.split(':');
      const categoryId = parts[1];
      const page = parseInt(parts[2]);
      const searchQuery = parts.length > 3 ? parts[3] : '';
      await showRequestsForCategory(ctx, categoryId, page, searchQuery);
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка нажатия на номер страницы (ничего не делаем)
    if (data === 'noop') {
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка выбора запроса
    if (data.startsWith('request:')) {
      const requestId = data.split(':')[1];
      await showLawyersForRequest(ctx, requestId);
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка редактирования категории
    if (data.startsWith('edit_category:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const categoryId = data.split(':')[1];
      userStates[userId] = {
        action: 'waiting_category_edit_name',
        categoryId
      };

      await ctx.reply('Введите новое название категории:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка удаления категории
    if (data.startsWith('delete_category:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const categoryId = data.split(':')[1];

      // Создаем клавиатуру для подтверждения
      const confirmKeyboard = new InlineKeyboard()
        .row({ text: '✅ Да, удалить', callback_data: `confirm_delete_category:${categoryId}` })
        .row({ text: '❌ Отмена', callback_data: 'back_to_main' });

      await ctx.reply('⚠️ Вы уверены, что хотите удалить эту категорию? Все связанные вопросы и юристы также будут удалены!', {
        reply_markup: confirmKeyboard
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Подтверждение удаления категории
    if (data.startsWith('confirm_delete_category:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const categoryId = data.split(':')[1];

      try {
        // Находим все запросы в этой категории
        const requests = await Request.find({ category: categoryId });

        // Для каждого запроса удаляем связанных юристов
        for (const request of requests) {
          await Lawyer.deleteMany({ request: request._id });
        }

        // Удаляем все запросы в категории
        await Request.deleteMany({ category: categoryId });

        // Удаляем саму категорию
        await Category.findByIdAndDelete(categoryId);

        await ctx.reply('✅ Категория и все связанные данные успешно удалены');
        await showMainMenu(ctx);
      } catch (error) {
        console.error('Error deleting category:', error);
        await ctx.reply('❌ Произошла ошибка при удалении категории');
      }

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка редактирования запроса
    if (data.startsWith('edit_request:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const requestId = data.split(':')[1];
      const request = await Request.findById(requestId);

      if (!request) {
        await ctx.reply('Вопрос не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_request_edit_title',
        requestId,
        categoryId: request.category
      };

      await ctx.reply('Введите новое название вопроса:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка удаления запроса
    if (data.startsWith('delete_request:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const requestId = data.split(':')[1];
      const request = await Request.findById(requestId);

      if (!request) {
        await ctx.reply('Вопрос не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      // Создаем клавиатуру для подтверждения
      const confirmKeyboard = new InlineKeyboard()
        .row({ text: '✅ Да, удалить', callback_data: `confirm_delete_request:${requestId}` })
        .row({ text: '❌ Отмена', callback_data: `back_to_category:${request.category}` });

      await ctx.reply('⚠️ Вы уверены, что хотите удалить этот вопрос? Все связанные юристы также будут удалены!', {
        reply_markup: confirmKeyboard
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Подтверждение удаления запроса
    if (data.startsWith('confirm_delete_request:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const requestId = data.split(':')[1];

      try {
        const request = await Request.findById(requestId);
        if (!request) {
          await ctx.reply('Вопрос не найден');
          await ctx.answerCallbackQuery();
          return;
        }

        const categoryId = request.category;

        // Удаляем всех юристов, связанных с запросом
        await Lawyer.deleteMany({ request: requestId });

        // Удаляем сам запрос
        await Request.findByIdAndDelete(requestId);

        await ctx.reply('✅ Вопрос и все связанные данные успешно удалены');
        await showRequestsForCategory(ctx, categoryId);
      } catch (error) {
        console.error('Error deleting request:', error);
        await ctx.reply('❌ Произошла ошибка при удалении вопроса');
      }

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка редактирования юриста
    if (data.startsWith('edit_lawyer:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_lawyer_edit_name',
        lawyerId,
        requestId: lawyer.request
      };

      await ctx.reply('Введите новое имя юриста:');
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка удаления юриста
    if (data.startsWith('delete_lawyer:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      // Создаем клавиатуру для подтверждения
      const confirmKeyboard = new InlineKeyboard()
        .row({ text: '✅ Да, удалить', callback_data: `confirm_delete_lawyer:${lawyerId}` })
        .row({ text: '❌ Отмена', callback_data: `request:${lawyer.request}` });

      await ctx.reply('⚠️ Вы уверены, что хотите удалить этого юриста?', {
        reply_markup: confirmKeyboard
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Подтверждение удаления юриста
    if (data.startsWith('confirm_delete_lawyer:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];

      try {
        const lawyer = await Lawyer.findById(lawyerId);
        if (!lawyer) {
          await ctx.reply('Юрист не найден');
          await ctx.answerCallbackQuery();
          return;
        }

        const requestId = lawyer.request;

        // Удаляем юриста
        await Lawyer.findByIdAndDelete(lawyerId);

        await ctx.reply('✅ Юрист успешно удален');
        await showLawyersForRequest(ctx, requestId);
      } catch (error) {
        console.error('Error deleting lawyer:', error);
        await ctx.reply('❌ Произошла ошибка при удалении юриста');
      }

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка просмотра информации о юристе
    if (data.startsWith('lawyer_info:')) {
      const lawyerId = data.split(':')[1];
      await showLawyerInfo(ctx, lawyerId);
      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка редактирования имени юриста
    if (data.startsWith('edit_lawyer_name:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_lawyer_edit_name',
        lawyerId,
        requestId: lawyer.request
      };

      // Отправляем текущее имя юриста для редактирования
      await ctx.reply(`Текущее имя: ${lawyer.name}\n\nВведите новое имя юриста:`, {
        reply_markup: {
          force_reply: true,
          input_field_placeholder: lawyer.name
        }
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка редактирования контакта юриста
    if (data.startsWith('edit_lawyer_contact:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_lawyer_edit_contact_only',
        lawyerId,
        requestId: lawyer.request
      };

      // Отправляем текущий контакт юриста для редактирования
      await ctx.reply(`Текущий контакт: ${lawyer.contact}\n\nВведите новый контакт юриста:`, {
        reply_markup: {
          force_reply: true,
          input_field_placeholder: lawyer.contact
        }
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка редактирования ссылки юриста
    if (data.startsWith('edit_lawyer_link:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_lawyer_edit_link_only',
        lawyerId,
        requestId: lawyer.request
      };

      // Отправляем текущую ссылку юриста для редактирования
      await ctx.reply(`Текущая ссылка: ${lawyer.link || '-'}\n\nВведите новую ссылку юриста (или отправьте "-" для пропуска):`, {
        reply_markup: {
          force_reply: true,
          input_field_placeholder: lawyer.link || '-'
        }
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка редактирования описания юриста
    if (data.startsWith('edit_lawyer_description:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      userStates[userId] = {
        action: 'waiting_lawyer_edit_description_only',
        lawyerId,
        requestId: lawyer.request
      };

      // Отправляем текущее описание юриста для редактирования
      await ctx.reply(`Текущее описание: ${lawyer.description || '-'}\n\nВведите новое описание юриста (или отправьте "-" для пропуска):`, {
        reply_markup: {
          force_reply: true,
          input_field_placeholder: lawyer.description || 'Введите описание'
        }
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка удаления юриста
    if (data.startsWith('delete_lawyer:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      // Создаем клавиатуру для подтверждения
      const confirmKeyboard = new InlineKeyboard()
        .row({ text: '✅ Да, удалить', callback_data: `confirm_delete_lawyer:${lawyerId}` })
        .row({ text: '❌ Отмена', callback_data: `request:${lawyer.request}` });

      await ctx.reply('⚠️ Вы уверены, что хотите удалить этого юриста?', {
        reply_markup: confirmKeyboard
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Подтверждение удаления юриста
    if (data.startsWith('confirm_delete_lawyer:')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];

      try {
        const lawyer = await Lawyer.findById(lawyerId);
        if (!lawyer) {
          await ctx.reply('Юрист не найден');
          await ctx.answerCallbackQuery();
          return;
        }

        const requestId = lawyer.request;

        // Удаляем юриста
        await Lawyer.findByIdAndDelete(lawyerId);

        await ctx.reply('✅ Юрист успешно удален');
        await showLawyersForRequest(ctx, requestId);
      } catch (error) {
        console.error('Error deleting lawyer:', error);
        await ctx.reply('❌ Произошла ошибка при удалении юриста');
      }

      await ctx.answerCallbackQuery();
      return;
    }

    // Обработка просмотра пользователей
    if (data.startsWith('show_users')) {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }
      // Пагинация: show_users:0, show_users:30, ...
      const parts = data.split(':');
      const offset = parseInt(parts[1] || '0', 10);
      const limit = 30;
      // Получаем уникальные username, не пустые
      const users = await UserActionLog.aggregate([
        { $match: { username: { $ne: null, $ne: '' } } },
        { $group: { _id: '$username' } },
        { $sort: { _id: 1 } },
        { $skip: offset },
        { $limit: limit + 1 }
      ]);
      const hasNext = users.length > limit;
      const usersToShow = users.slice(0, limit);
      let msg = '<b>Список пользователей (@):</b>\n\n';
      if (usersToShow.length === 0) {
        msg += 'Нет пользователей с username.';
      } else {
        msg += usersToShow.map(u => '@' + u._id).join('\n');
      }
      const keyboard = new InlineKeyboard();
      if (hasNext) {
        keyboard.row({ text: 'Далее', callback_data: `show_users:${offset + limit}` });
      }
      keyboard.row({ text: '⬅️ Закрыть', callback_data: 'close_users_list' });
      await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: keyboard });
      await ctx.answerCallbackQuery();
      return;
    }
    // Обработка закрытия окна пользователей
    if (data === 'close_users_list') {
      await ctx.deleteMessage();
      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error handling callback query:', error);
    await ctx.answerCallbackQuery('Произошла ошибка');
    ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

// Функция для отображения юристов по запросу
async function showLawyersForRequest(ctx, requestId) {
  try {
    const userId = ctx.from.id.toString();
    userStates[userId] = { requestId };

    // Загружаем запрос с информацией о категории
    const request = await Request.findById(requestId).populate('category');

    if (!request) {
      await ctx.reply('Вопрос не найден');
      return;
    }

    const lawyers = await Lawyer.find({ request: requestId });

    // Создаем клавиатуру
    const keyboard = new InlineKeyboard();

    // Добавляем юристов
    for (const lawyer of lawyers) {
      keyboard.row({ text: lawyer.name, callback_data: `lawyer_info:${lawyer._id.toString()}` });
    }

    // Если пользователь админ, добавляем кнопки управления
    if (isAdmin(ctx)) {
      keyboard.row({ text: '➕ Добавить юриста', callback_data: `add_lawyer:${requestId}` });

      // Добавляем кнопку для добавления/редактирования ответа
      if (request.answer) {
        keyboard.row({ text: '✏️ Редактировать ответ', callback_data: `edit_request_answer:${requestId}` });
      } else {
        keyboard.row({ text: '➕ Добавить ответ', callback_data: `add_request_answer:${requestId}` });
      }

      keyboard.row(
        { text: '✏️ Редактировать', callback_data: `edit_request:${requestId}` },
        { text: '🗑️ Удалить', callback_data: `delete_request:${requestId}` }
      );
    }

    // Добавляем кнопку возврата
    keyboard.row({
      text: '⬅️ Назад',
      callback_data: `back_to_category:${request.category._id.toString()}`
    });

    // Формируем сообщение
    let message = `📂 <b>Категория:</b> ${request.category.name}\n\n`;
    message += `📋 <b>${request.title}</b>\n\n`;

    // Добавляем ответ, если он есть
    if (request.answer) {
      message += `<b>Ответ:</b>\n${request.answer}\n\n`;
    }

    message += `<b>Доступные юристы:</b>`;

    if (lawyers.length === 0) {
      message += '\nНет доступных юристов';
    }

    await ctx.reply(message, {
      reply_markup: keyboard,
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('Error showing lawyers for request:', error);
    ctx.reply('Произошла ошибка при загрузке юристов. Попробуйте позже.');
  }
}

// Функция для отображения информации о конкретном юристе
async function showLawyerInfo(ctx, lawyerId) {
  try {
    const lawyer = await Lawyer.findById(lawyerId).populate({
      path: 'request',
      populate: { path: 'category' }
    });

    if (!lawyer) {
      return ctx.reply('Юрист не найден');
    }

    let message = `👨‍⚖️ ${lawyer.name}\n`;
    message += `📞 ${lawyer.contact}\n`;

    if (lawyer.link) {
      message += `🔗 ${lawyer.link}\n`;
    }

    if (lawyer.description) {
      message += `\n📝 Описание:\n${lawyer.description}`;
    }

    const keyboard = new InlineKeyboard();

    if (isAdmin(ctx)) {
      keyboard.row(
        { text: '✏️ Имя', callback_data: `edit_lawyer_name:${lawyer._id}` },
        { text: '✏️ Контакт', callback_data: `edit_lawyer_contact:${lawyer._id}` }
      );
      keyboard.row(
        { text: '✏️ Ссылка', callback_data: `edit_lawyer_link:${lawyer._id}` },
        { text: '✏️ Описание', callback_data: `edit_lawyer_description:${lawyer._id}` }
      );
      keyboard.row({ text: '🗑️ Удалить', callback_data: `delete_lawyer:${lawyer._id}` });
    }

    keyboard.row({
      text: '⬅️ Назад к списку юристов',
      callback_data: `request:${lawyer.request._id.toString()}`
    });

    await ctx.reply(message, {
      reply_markup: keyboard
    });
  } catch (error) {
    console.error('Error showing lawyer info:', error);
    ctx.reply('Произошла ошибка при загрузке информации о юристе. Попробуйте позже.');
  }
}

// Функция для отображения запросов в категории с пагинацией и поиском
async function showRequestsForCategory(ctx, categoryId, page = 1, searchQuery = '') {
  try {
    const userId = ctx.from.id.toString();
    userStates[userId] = { categoryId };

    const category = await Category.findById(categoryId);
    if (!category) {
      return ctx.reply('Категория не найдена');
    }

    // Получаем запросы для категории
    let requestsQuery = { category: categoryId };

    // Если есть поисковый запрос, добавляем фильтр по заголовку
    if (searchQuery) {
      requestsQuery.title = { $regex: searchQuery, $options: 'i' };
    }

    // Получаем все запросы для категории с учетом поискового запроса
    const requests = await Request.find(requestsQuery);

    // Настройки пагинации
    const itemsPerPage = 10; // Количество вопросов на странице
    const totalPages = Math.ceil(requests.length / itemsPerPage);

    // Проверяем корректность номера страницы
    if (page < 1) page = 1;
    if (page > totalPages && totalPages > 0) page = totalPages;

    // Получаем вопросы для текущей страницы
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, requests.length);
    const currentPageRequests = requests.slice(startIndex, endIndex);

    // Создаем клавиатуру
    const keyboard = new InlineKeyboard();

    // Добавляем кнопку "Задать свой вопрос"
    keyboard.row({ text: '❓ Задать свой вопрос', callback_data: `ask_question:${categoryId}` });

    // Добавляем кнопку поиска
    keyboard.row({ text: '🔍 Поиск', callback_data: `search:${categoryId}` });

    // Добавляем вопросы текущей страницы
    for (const request of currentPageRequests) {
      keyboard.row({ text: request.title, callback_data: `request:${request._id.toString()}` });
    }

    // Добавляем кнопки навигации
    const navigationRow = [];

    // Кнопка "Предыдущая страница"
    if (page > 1) {
      navigationRow.push({ text: '⬅️ Назад', callback_data: `category_page:${categoryId}:${page - 1}:${searchQuery}` });
    }

    // Информация о текущей странице
    navigationRow.push({ text: `${page}/${totalPages || 1}`, callback_data: 'noop' });

    // Кнопка "Следующая страница"
    if (page < totalPages) {
      navigationRow.push({ text: 'Вперед ➡️', callback_data: `category_page:${categoryId}:${page + 1}:${searchQuery}` });
    }

    // Добавляем строку навигации
    if (navigationRow.length > 0) {
      keyboard.row(...navigationRow);
    }

    if (isAdmin(ctx)) {
      keyboard.row({ text: '➕ Добавить вопрос', callback_data: `add_request:${categoryId}` });

      // Добавляем кнопки редактирования и удаления категории для админов
      keyboard.row(
        { text: '✏️ Редактировать категорию', callback_data: `edit_category:${categoryId}` },
        { text: '🗑️ Удалить категорию', callback_data: `delete_category:${categoryId}` }
      );
    }

    keyboard.row({ text: '⬅️ Назад к категориям', callback_data: 'back_to_main' });

    // Формируем заголовок сообщения
    let messageText = `Категория: ${category.name}`;

    // Если был поисковый запрос, добавляем информацию о нем
    if (searchQuery) {
      messageText += `\n\nРезультаты поиска по запросу: "${searchQuery}"`;
      if (requests.length === 0) {
        messageText += '\n\nНичего не найдено. Попробуйте другой запрос.';
      } else {
        messageText += `\nНайдено вопросов: ${requests.length}`;
      }
    }

    messageText += '\n\nВыберите вопрос:';

    await ctx.reply(messageText, { reply_markup: keyboard });
  } catch (error) {
    console.error('Error showing requests:', error);
    ctx.reply('Произошла ошибка при загрузке вопросов. Попробуйте позже.');
  }
}

// Обработка текстовых сообщений для диалогов
bot.on('message:text', async (ctx) => {
  try {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text;

    // Если текст - это кнопка "В начало", то обработка уже произведена в bot.hears
    if (text === '🏠 В начало') return;

    // Обработка поискового запроса
    if (userStates[userId] && userStates[userId].action === 'waiting_search_query') {
      const searchQuery = text.trim();
      const categoryId = userStates[userId].categoryId;

      // Очищаем состояние
      delete userStates[userId];

      // Показываем результаты поиска
      await showRequestsForCategory(ctx, categoryId, 1, searchQuery);
      return;
    }

    // Обработка пользовательского вопроса
    if (userStates[userId] && userStates[userId].action === 'waiting_user_question') {
      const question = text.trim();
      const categoryId = userStates[userId].categoryId;

      try {
        const category = await Category.findById(categoryId);
        if (!category) {
          await ctx.reply('Категория не найдена. Пожалуйста, начните заново.');
          delete userStates[userId];
          return;
        }

        // // Сохраняем вопрос в базу данных
        // const userQuestion = new UserQuestion({
        //   userId: userId,
        //   username: ctx.from.username || `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim(),
        //   category: categoryId,
        //   question: question
        // });

        // await userQuestion.save();

        // Отправляем вопрос на канал
        const channelId = process.env.ASK_APPLICATIONS_CHANNEL;

        // Формируем сообщение для канала
        const channelMessage = `📝 <b>Новый вопрос</b>\n\n` +
          `👤 <b>От:</b> ${ctx.from.username ? '@' + ctx.from.username : `${ctx.from.first_name} ${ctx.from.last_name || ''}`.trim()}\n` +
          `📂 <b>Категория:</b> ${category.name}\n\n` +
          `❓ <b>Вопрос:</b>\n${question}`;

        // Отправляем сообщение на канал
        await bot.api.sendMessage(channelId, channelMessage, { parse_mode: 'HTML' });

        // Отправляем подтверждение пользователю
        await ctx.reply('Ваш вопрос принят! \nМы подберём подходящего юриста и свяжемся в ближайшее время. Пока вы ждёте — ознакомьтесь с частыми проблемами на похожие темы👇');

        // Показываем пользователю вопросы из этой категории
        await showRequestsForCategory(ctx, categoryId);

        // Очищаем состояние пользователя
        delete userStates[userId];
      } catch (error) {
        console.error('Error processing user question:', error);
        await ctx.reply('Произошла ошибка при обработке вашего вопроса. Пожалуйста, попробуйте позже.');
      }

      return;
    }

    // Если нет состояния, игнорируем сообщение
    if (!userStates[userId]) return;

    const state = userStates[userId];

    // Обработка ввода поискового запроса
    if (state.action === 'waiting_search_query') {
      const categoryId = state.categoryId;
      const searchQuery = text.trim();

      // Очищаем состояние
      delete userStates[userId];

      // Показываем результаты поиска
      await showRequestsForCategory(ctx, categoryId, 1, searchQuery);
      return;
    }

    // Обработка добавления категории
    if (state.action === 'waiting_category_name') {
      const categoryName = text.trim();

      if (!categoryName) {
        return ctx.reply('Название категории не может быть пустым. Попробуйте еще раз:');
      }

      try {
        const newCategory = new Category({
          name: state.categoryName || categoryName,
          description: ''
        });

        await newCategory.save();
        delete userStates[userId];

        ctx.reply(`Категория "${categoryName}" успешно добавлена!`);
        return showMainMenu(ctx);
      } catch (error) {
        console.error('Error saving category:', error);
        return ctx.reply('Произошла ошибка при сохранении категории. Попробуйте позже.');
      }
    }

    // Обработка редактирования имени категории
    if (state.action === 'waiting_category_edit_name') {
      const newName = text.trim();

      if (!newName) {
        return ctx.reply('Название категории не может быть пустым. Попробуйте еще раз:');
      }

      try {
        await Category.findByIdAndUpdate(state.categoryId, { name: newName });
        delete userStates[userId];

        ctx.reply(`✅ Категория успешно переименована в "${newName}"`);
        return showMainMenu(ctx);
      } catch (error) {
        console.error('Error updating category:', error);
        return ctx.reply('❌ Произошла ошибка при обновлении категории. Попробуйте позже.');
      }
    }

    // Обработка названия запроса
    if (state.action === 'waiting_request_title') {
      const requestTitle = text.trim();

      if (!requestTitle) {
        return ctx.reply('Название вопроса не может быть пустым. Попробуйте еще раз:');
      }

      try {
        const newRequest = new Request({
          category: state.categoryId,
          title: requestTitle,
          description: ''
        });

        await newRequest.save();
        delete userStates[userId];

        ctx.reply(`Вопрос "${requestTitle}" успешно добавлен!`);
        return showRequestsForCategory(ctx, state.categoryId);
      } catch (error) {
        console.error('Error saving request:', error);
        return ctx.reply('Произошла ошибка при сохранении вопроса. Попробуйте позже.');
      }
    }

    // Обработка редактирования названия запроса
    if (state.action === 'waiting_request_edit_title') {
      const newTitle = text.trim();

      if (!newTitle) {
        return ctx.reply('Название вопроса не может быть пустым. Попробуйте еще раз:');
      }

      try {
        await Request.findByIdAndUpdate(state.requestId, { title: newTitle });
        delete userStates[userId];

        ctx.reply(`✅ Вопрос успешно переименован в "${newTitle}"`);
        return showRequestsForCategory(ctx, state.categoryId);
      } catch (error) {
        console.error('Error updating request:', error);
        return ctx.reply('❌ Произошла ошибка при обновлении вопроса. Попробуйте позже.');
      }
    }

    // Обработка имени юриста
    if (state.action === 'waiting_lawyer_name') {
      const lawyerName = text.trim();

      if (!lawyerName) {
        return ctx.reply('Имя юриста не может быть пустым. Попробуйте еще раз:');
      }

      userStates[userId] = {
        action: 'waiting_lawyer_contact',
        requestId: state.requestId,
        lawyerName
      };

      return ctx.reply('Введите контактные данные юриста:');
    }

    // Обработка контакта юриста
    if (state.action === 'waiting_lawyer_contact') {
      const contact = text.trim();

      if (!contact) {
        return ctx.reply('Контактные данные не могут быть пустыми. Попробуйте еще раз:');
      }

      userStates[userId] = {
        action: 'waiting_lawyer_link',
        requestId: state.requestId,
        lawyerName: state.lawyerName,
        contact
      };

      return ctx.reply('Введите ссылку на юриста (или отправьте "-" для пропуска):');
    }

    // Обработка ссылки юриста
    if (state.action === 'waiting_lawyer_link') {
      let link = text.trim();

      if (link === '-') {
        link = '';
      }

      userStates[userId] = {
        action: 'waiting_lawyer_description',
        requestId: state.requestId,
        lawyerName: state.lawyerName,
        contact: state.contact,
        link
      };

      return ctx.reply('Введите описание юриста (чем занимается, специализация и т.д.) или отправьте "-" для пропуска:');
    }

    // Обработка описания юриста
    if (state.action === 'waiting_lawyer_description') {
      let description = text.trim();

      if (description === '-') {
        description = '';
      }

      try {
        const newLawyer = new Lawyer({
          request: state.requestId,
          name: state.lawyerName,
          contact: state.contact,
          link: state.link,
          description
        });

        await newLawyer.save();
        delete userStates[userId];

        ctx.reply(`Юрист "${state.lawyerName}" успешно добавлен!`);
        return showLawyersForRequest(ctx, state.requestId);
      } catch (error) {
        console.error('Error saving lawyer:', error);
        return ctx.reply('Произошла ошибка при сохранении информации о юристе. Попробуйте позже.');
      }
    }

    // Обработка редактирования имени юриста
    if (state.action === 'waiting_lawyer_edit_name') {
      const newName = text.trim();

      if (!newName) {
        return ctx.reply('Имя юриста не может быть пустым. Попробуйте еще раз:');
      }

      try {
        const lawyer = await Lawyer.findById(state.lawyerId);
        if (!lawyer) {
          delete userStates[userId];
          return ctx.reply('Юрист не найден');
        }

        await Lawyer.findByIdAndUpdate(state.lawyerId, { name: newName });
        delete userStates[userId];

        ctx.reply(`✅ Имя юриста успешно изменено на "${newName}"`);
        return showLawyerInfo(ctx, state.lawyerId);
      } catch (error) {
        console.error('Error updating lawyer name:', error);
        return ctx.reply('❌ Произошла ошибка при обновлении имени юриста. Попробуйте позже.');
      }
    }

    // Обработка редактирования только контакта юриста
    if (state.action === 'waiting_lawyer_edit_contact_only') {
      const newContact = text.trim();

      if (!newContact) {
        return ctx.reply('Контактные данные не могут быть пустыми. Попробуйте еще раз:');
      }

      try {
        const lawyer = await Lawyer.findById(state.lawyerId);
        if (!lawyer) {
          delete userStates[userId];
          return ctx.reply('Юрист не найден');
        }

        await Lawyer.findByIdAndUpdate(state.lawyerId, { contact: newContact });
        delete userStates[userId];

        ctx.reply(`✅ Контакт юриста успешно изменен на "${newContact}"`);
        return showLawyerInfo(ctx, state.lawyerId);
      } catch (error) {
        console.error('Error updating lawyer contact:', error);
        return ctx.reply('❌ Произошла ошибка при обновлении контакта юриста. Попробуйте позже.');
      }
    }

    // Обработка редактирования только ссылки юриста
    if (state.action === 'waiting_lawyer_edit_link_only') {
      let newLink = text.trim();

      if (newLink === '-') {
        newLink = '';
      }

      try {
        const lawyer = await Lawyer.findById(state.lawyerId);
        if (!lawyer) {
          delete userStates[userId];
          return ctx.reply('Юрист не найден');
        }

        await Lawyer.findByIdAndUpdate(state.lawyerId, { link: newLink });
        delete userStates[userId];

        ctx.reply(`✅ Ссылка юриста успешно ${newLink ? 'изменена' : 'удалена'}`);
        return showLawyerInfo(ctx, state.lawyerId);
      } catch (error) {
        console.error('Error updating lawyer link:', error);
        return ctx.reply('❌ Произошла ошибка при обновлении ссылки юриста. Попробуйте позже.');
      }
    }

    // Обработка редактирования только описания юриста
    if (state.action === 'waiting_lawyer_edit_description_only') {
      let newDescription = text.trim();

      if (newDescription === '-') {
        newDescription = '';
      }

      try {
        const lawyer = await Lawyer.findById(state.lawyerId);
        if (!lawyer) {
          delete userStates[userId];
          return ctx.reply('Юрист не найден');
        }

        await Lawyer.findByIdAndUpdate(state.lawyerId, { description: newDescription });
        delete userStates[userId];

        ctx.reply(`✅ Описание юриста успешно ${newDescription ? 'изменено' : 'удалено'}`);
        return showLawyerInfo(ctx, state.lawyerId);
      } catch (error) {
        console.error('Error updating lawyer description:', error);
        return ctx.reply('❌ Произошла ошибка при обновлении описания юриста. Попробуйте позже.');
      }
    }

    // Обработка редактирования контакта юриста
    if (state.action === 'waiting_lawyer_edit_contact') {
      const newContact = text.trim();

      if (!newContact) {
        return ctx.reply('Контактные данные не могут быть пустыми. Попробуйте еще раз:');
      }

      userStates[userId] = {
        action: 'waiting_lawyer_edit_link',
        lawyerId: state.lawyerId,
        requestId: state.requestId,
        newName: state.newName,
        newContact
      };

      return ctx.reply('Введите новую ссылку на юриста (или отправьте "-" для пропуска):');
    }

    // Обработка редактирования ссылки юриста
    if (state.action === 'waiting_lawyer_edit_link') {
      let newLink = text.trim();

      if (newLink === '-') {
        newLink = '';
      }

      userStates[userId] = {
        action: 'waiting_lawyer_edit_description',
        lawyerId: state.lawyerId,
        requestId: state.requestId,
        newName: state.newName,
        newContact: state.newContact,
        newLink
      };

      return ctx.reply('Введите новое описание юриста (или отправьте "-" для пропуска):');
    }

    // Обработка редактирования описания юриста
    if (state.action === 'waiting_lawyer_edit_description') {
      let newDescription = text.trim();

      if (newDescription === '-') {
        newDescription = '';
      }

      try {
        await Lawyer.findByIdAndUpdate(state.lawyerId, {
          name: state.newName,
          contact: state.newContact,
          link: state.newLink,
          description: newDescription
        });

        delete userStates[userId];

        ctx.reply(`✅ Информация о юристе "${state.newName}" успешно обновлена!`);
        return showLawyerInfo(ctx, state.lawyerId);
      } catch (error) {
        console.error('Error updating lawyer:', error);
        return ctx.reply('❌ Произошла ошибка при обновлении информации о юристе. Попробуйте позже.');
      }
    }

    // Обработка ввода ответа на вопрос
    if (state.action === 'waiting_request_answer') {
      if (!isAdmin(ctx)) {
        await ctx.reply('Доступ запрещен');
        return;
      }

      try {
        const request = await Request.findById(state.requestId);

        if (!request) {
          await ctx.reply('Вопрос не найден');
          delete userStates[userId];
          return;
        }

        // Обновляем ответ
        request.answer = text;
        await request.save();

        await ctx.reply('✅ Ответ успешно сохранен');

        // Показываем обновленную информацию о вопросе
        await showLawyersForRequest(ctx, state.requestId);

        // Очищаем состояние
        delete userStates[userId];
      } catch (error) {
        console.error('Error saving request answer:', error);
        await ctx.reply('❌ Произошла ошибка при сохранении ответа');
      }

      return;
    }

    // Обработка заявки от юриста - имя
    if (state.action === 'waiting_lawyer_application_name') {
      userStates[userId] = {
        action: 'waiting_lawyer_application_channel',
        name: text
      };

      await ctx.reply('Спасибо! Теперь введите ссылку на ваш Telegram канал (если нет, введите "-"):');
      return;
    }

    // Обработка ввода ссылки на канал для заявки юриста
    if (state.action === 'waiting_lawyer_application_channel') {
      userStates[userId] = {
        action: 'waiting_lawyer_application_phone',
        name: state.name,
        telegramChannel: text === '-' ? '' : text
      };

      await ctx.reply('Отлично! Теперь введите ваш номер телефона для связи:');
      return;
    }

    // Обработка ввода номера телефона для заявки юриста
    if (state.action === 'waiting_lawyer_application_phone') {
      try {
        // Уведомляем пользователя
        await ctx.reply('✅ Ваша заявка успешно отправлена! Мы свяжемся с вами в ближайшее время.');

        // Отправляем уведомление в канал для заявок
        const notificationChannel = process.env.LAWYER_APPLICATIONS_CHANNEL;
        if (notificationChannel) {
          try {
            await bot.api.sendMessage(notificationChannel,
              `📩 Новая заявка от юриста!\n\n` +
              `👨‍⚖️ ФИО: ${state.name}\n` +
              `📱 Телефон: ${text}\n` +
              `🔗 Telegram: ${state.telegramChannel || 'Не указан'}\n\n`
            );
          } catch (error) {
            console.error('Error sending notification to channel:', error);
          }
        }

        // Сохраняем заявку в базе данных
        const lawyerApplication = new LawyerApplication({
          name: state.name,
          telegramChannel: state.telegramChannel,
          phone: text
        });

        await lawyerApplication.save();

        // Очищаем состояние пользователя
        delete userStates[userId];

      } catch (error) {
        console.error('Error processing lawyer application:', error);
        await ctx.reply('❌ Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже.');
      }
      return;
    }

    // Обработка заявки в поддержку - имя
    if (state.action === 'waiting_support_application_name') {
      userStates[userId] = {
        action: 'waiting_support_application_channel',
        name: text
      };

      await ctx.reply('Спасибо! Теперь введите ссылку на ваш Telegram канал (если нет, введите "-"):');
      return;
    }

    // Обработка ввода ссылки на канал для заявки в поддержку
    if (state.action === 'waiting_support_application_channel') {
      userStates[userId] = {
        action: 'waiting_support_application_phone',
        name: state.name,
        telegramChannel: text === '-' ? '' : text
      };

      await ctx.reply('Отлично! Теперь введите ваш номер телефона для связи:');
      return;
    }

    // Обработка ввода номера телефона для заявки в поддержку
    if (state.action === 'waiting_support_application_phone') {
      userStates[userId] = {
        action: 'waiting_support_application_question',
        name: state.name,
        telegramChannel: state.telegramChannel,
        phone: text
      };

      await ctx.reply('Отлично! Теперь опишите ваш вопрос:');
      return;
    }

    // Обработка ввода вопроса для заявки в поддержку
    if (state.action === 'waiting_support_application_question') {
      try {
        // Уведомляем пользователя
        await ctx.reply('✅ Ваша заявка успешно отправлена! Мы свяжемся с вами в ближайшее время.');

        // Отправляем уведомление в канал для заявок поддержки
        const notificationChannel = process.env.SUPPORT_APPLICATIONS_CHANNEL;
        if (notificationChannel) {
          try {
            await bot.api.sendMessage(notificationChannel,
              `📩 Новая заявка в поддержку!\n\n` +
              `👤 ФИО: ${state.name}\n` +
              `📱 Телефон: ${state.phone}\n` +
              `🔗 Telegram: ${state.telegramChannel || 'Не указан'}\n` +
              `❓ Вопрос: ${text}\n\n`
            );
          } catch (error) {
            console.error('Error sending notification to channel:', error);
          }
        }

        // Очищаем состояние пользователя
        delete userStates[userId];

      } catch (error) {
        console.error('Error processing support application:', error);
        await ctx.reply('❌ Произошла ошибка при отправке заявки. Пожалуйста, попробуйте позже.');
      }
      return;
    }

    // Обработка удаления юриста
    if (state.action === 'waiting_lawyer_delete') {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];
      const lawyer = await Lawyer.findById(lawyerId);

      if (!lawyer) {
        await ctx.reply('Юрист не найден');
        await ctx.answerCallbackQuery();
        return;
      }

      // Создаем клавиатуру для подтверждения
      const confirmKeyboard = new InlineKeyboard()
        .row({ text: '✅ Да, удалить', callback_data: `confirm_delete_lawyer:${lawyerId}` })
        .row({ text: '❌ Отмена', callback_data: `request:${lawyer.request}` });

      await ctx.reply('⚠️ Вы уверены, что хотите удалить этого юриста?', {
        reply_markup: confirmKeyboard
      });

      await ctx.answerCallbackQuery();
      return;
    }

    // Подтверждение удаления юриста
    if (state.action === 'confirm_delete_lawyer') {
      if (!isAdmin(ctx)) {
        await ctx.answerCallbackQuery('Доступ запрещен');
        return;
      }

      const lawyerId = data.split(':')[1];

      try {
        const lawyer = await Lawyer.findById(lawyerId);
        if (!lawyer) {
          await ctx.reply('Юрист не найден');
          await ctx.answerCallbackQuery();
          return;
        }

        const requestId = lawyer.request;

        // Удаляем юриста
        await Lawyer.findByIdAndDelete(lawyerId);

        await ctx.reply('✅ Юрист успешно удален');
        await showLawyersForRequest(ctx, requestId);
      } catch (error) {
        console.error('Error deleting lawyer:', error);
        await ctx.reply('❌ Произошла ошибка при удалении юриста');
      }

      await ctx.answerCallbackQuery();
      return;
    }

    await ctx.answerCallbackQuery();
  } catch (error) {
    console.error('Error handling text message:', error);
    ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
});

// Добавьте этот код перед запуском бота
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Ошибка при обработке обновления ${ctx.update.update_id}:`);
  console.error(err.error);

  // Пытаемся отправить сообщение пользователю об ошибке, если возможно
  try {
    if (ctx.chat) {
      ctx.reply('Произошла ошибка при обработке запроса. Пожалуйста, попробуйте еще раз.');
    }
  } catch (e) {
    console.error('Не удалось отправить сообщение об ошибке:', e);
  }
});

// Запуск бота
bot.start();