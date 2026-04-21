import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "../../core/logger.js";
import { registerTelegramUpdateLogging } from "./bot-logging.js";
import { registerInteractionHandlers } from "./handlers/interaction.handler.js";
import { registerStartHandler } from "./handlers/start.handler.js";

export function registerTelegramHandlers(params: {
  bot: Bot;
  prisma: PrismaClient;
  logger: Logger;
}): void {
  registerTelegramUpdateLogging(params.bot, params.logger);
  registerStartHandler(params.bot, params.prisma, params.logger);
  registerInteractionHandlers(params.bot, params.prisma, params.logger);
}
