import { Bot } from "grammy";

export function createTelegramBot(token: string): Bot {
  return new Bot(token);
}
