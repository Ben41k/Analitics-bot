import { PrismaClient } from '@prisma/client';

// Инициализируем клиент Prisma
// Он берет настройки (DATABASE_URL) из твоего файла .env автоматически
const prisma = new PrismaClient({
  log: ['error', 'warn'], // Будем видеть в консоли только важные сообщения
});

export default prisma;