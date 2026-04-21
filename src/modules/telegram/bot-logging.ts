import type { Bot, Context } from "grammy";
import type { Logger } from "../../core/logger.js";

function updateKind(update: Context["update"]): string {
  const keys: (keyof Context["update"])[] = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "callback_query",
    "inline_query",
    "my_chat_member",
    "chat_join_request",
  ];
  for (const k of keys) {
    if (update[k] != null) {
      return k;
    }
  }
  return "other";
}

/** Внешний слой: лог входящих апдейтов и длительность обработки. Регистрировать первым. */
export function registerTelegramUpdateLogging(bot: Bot, logger: Logger): void {
  bot.use(async (ctx, next) => {
    const text =
      ctx.message?.text != null
        ? ctx.message.text.length > 120
          ? `${ctx.message.text.slice(0, 120)}…`
          : ctx.message.text
        : undefined;

    logger.info(
      {
        updateId: ctx.update.update_id,
        kind: updateKind(ctx.update),
        telegramUserId: ctx.from?.id,
        chatId: ctx.chat?.id,
        text,
        callbackData: ctx.callbackQuery?.data,
      },
      "Telegram update",
    );

    const t0 = Date.now();
    try {
      await next();
    } finally {
      logger.debug({ updateId: ctx.update.update_id, ms: Date.now() - t0 }, "Telegram update done");
    }
  });
}
