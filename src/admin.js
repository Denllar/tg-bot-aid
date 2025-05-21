import { Bot } from 'grammy';
import { Category } from './models.js';
import dotenv from 'dotenv';

dotenv.config();

const adminBot = new Bot(process.env.BOT_TOKEN);

// Проверка прав администратора
adminBot.use(async (ctx, next) => {
  const adminIds = process.env.ADMIN_IDS.split(',').map(id => id.trim());
  if (adminIds.includes(ctx.from.id.toString())) {
    await next();
  } else {
    ctx.reply('Доступ запрещен');
  }
});

// Команда для добавления категории
adminBot.command('add_category', async (ctx) => {
  const args = ctx.message.text.split(' ').slice(1);
  const name = args[0];
  const description = args.slice(1).join(' ') || '';
  
  if (!name) {
    return ctx.reply('Использование: /add_category <название> [описание]');
  }

  try {
    const newCategory = new Category({ name, description });
    await newCategory.save();
    ctx.reply(`Категория "${name}" успешно добавлена!`);
  } catch (error) {
    console.error('Error adding category:', error);
    ctx.reply('Произошла ошибка при добавлении категории');
  }
});

export default adminBot;