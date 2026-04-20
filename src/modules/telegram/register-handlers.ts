import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../core/logger.js";
import { registerStartHandler } from "./handlers/start.handler.js";

export function registerTelegramHandlers(params: {
  bot: Bot;
  prisma: PrismaClient;
  logger: Logger;
}): void {
  registerStartHandler(params.bot, params.prisma, params.logger);
}
