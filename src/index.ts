import "dotenv/config";
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

  if (!config.ENABLE_CRON) {
    logger.warn(
      "ENABLE_CRON=false: no scheduled football sync / scrape / embedding / analyze — DB will not fill from cron",
    );
  } else if (!config.FOOTBALL_DATA_API_TOKEN) {
    logger.warn(
      "FOOTBALL_DATA_API_TOKEN missing: football_sync will fail until you set a token (football-data.org)",
    );
  }

  const bot = config.TELEGRAM_BOT_TOKEN ? createTelegramBot(config.TELEGRAM_BOT_TOKEN) : undefined;
  if (bot) {
    registerTelegramHandlers({ bot, prisma, logger });
    await bot.init();
    logger.info({ username: bot.botInfo.username, id: bot.botInfo.id }, "Telegram bot initialized");
    bot.catch((err) => {
      logger.error(
        {
          err: err.error,
          updateId: err.ctx.update.update_id,
          telegramUserId: err.ctx.from?.id,
        },
        "Telegram middleware error (polling)",
      );
    });
  } else {
    logger.warn("TELEGRAM_BOT_TOKEN not set; Telegram bot disabled");
  }

  const app = buildApp({ config, prisma, logger, bot });

  if (bot) {
    app.addHook("onClose", async () => {
      await bot.stop();
    });
  }

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (err: unknown) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: unknown }).code)
        : "";
    if (code === "EADDRINUSE") {
      logger.error(
        {
          port: config.PORT,
          host: config.HOST,
          hint: "Port already in use (e.g. docker-compose app and npm run dev both use PORT). Stop one process or set a different PORT in .env.",
        },
        "HTTP listen failed: EADDRINUSE",
      );
      process.exit(1);
    }
    throw err;
  }
  logger.info({ port: config.PORT, host: config.HOST }, "HTTP server listening");

  if (bot) {
    if (config.NODE_ENV === "production") {
      const wh = await bot.api.getWebhookInfo();
      if (!wh.url) {
        logger.warn(
          {
            hint: "Production uses webhooks only (long polling is off). Point Telegram webhook to POST https://<public-host>/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET_PATH>, or run locally with NODE_ENV=development for polling.",
          },
          "Telegram: no webhook URL — bot will not receive commands until webhook is set",
        );
      } else {
        logger.info({ url: wh.url }, "Telegram webhook registered");
      }
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
