import { loadConfig } from "./core/config.js";
import { createLogger } from "./core/logger.js";
import { disconnectPrisma, getPrisma } from "./core/database.js";
import { buildApp } from "./core/app.js";
import { createTelegramBot } from "./core/bot.js";
import { registerTelegramHandlers } from "./modules/telegram/register-handlers.js";
import { registerSchedulers } from "./cron/register-schedulers.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const prisma = getPrisma();

  const bot = config.TELEGRAM_BOT_TOKEN ? createTelegramBot(config.TELEGRAM_BOT_TOKEN) : undefined;
  if (bot) {
    registerTelegramHandlers({ bot, prisma, logger });
  } else {
    logger.warn("TELEGRAM_BOT_TOKEN not set; Telegram bot disabled");
  }

  const app = buildApp({ config, prisma, logger, bot });

  if (bot) {
    app.addHook("onClose", async () => {
      await bot.stop();
    });
  }

  await app.listen({ port: config.PORT, host: config.HOST });
  logger.info({ port: config.PORT, host: config.HOST }, "HTTP server listening");

  if (bot) {
    if (config.NODE_ENV === "production") {
      logger.info("Telegram: configure webhook externally to POST /telegram/webhook/:secret");
    } else {
      void bot.start().catch((err: unknown) => {
        logger.error({ err }, "Telegram long polling failed");
      });
      logger.info("Telegram: long polling start requested (development)");
    }
  }

  if (config.ENABLE_CRON) {
    registerSchedulers({ prisma, config, logger });
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutdown requested");
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
