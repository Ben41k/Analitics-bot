import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { webhookCallback } from "grammy";
import type { Bot } from "grammy";
import type { PrismaClient } from "@prisma/client";
import type { AppConfig } from "./config.js";
import type { Logger } from "./logger.js";

export function buildApp(params: {
  config: AppConfig;
  prisma: PrismaClient;
  logger: Logger;
  bot?: Bot;
}): FastifyInstance {
  const app = Fastify({
    logger: false,
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  // fastify-type-provider-zod serializer is typed against fastify's internal generics; safe at runtime.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- serializer compiler is provided by fastify-type-provider-zod
  app.setSerializerCompiler(serializerCompiler);

  app.addHook("onRequest", (req, _reply, done) => {
    params.logger.info(
      { requestId: req.id, method: req.method, url: req.url },
      "Incoming HTTP request",
    );
    done();
  });

  app.get("/health", async () => {
    await params.prisma.$queryRaw`SELECT 1`;
    return { ok: true as const };
  });

  const bot = params.bot;
  if (bot) {
    app.post("/telegram/webhook/:secret", async (req, reply) => {
      const secret = (req.params as { secret?: string }).secret;
      if (!secret || secret !== params.config.TELEGRAM_WEBHOOK_SECRET_PATH) {
        return reply.code(403).send({ ok: false as const });
      }

      const handle = webhookCallback(bot, "fastify");
      try {
        await handle(req, reply);
      } catch (err: unknown) {
        params.logger.error({ err }, "Telegram webhook handler failed");
        if (!reply.sent) {
          return reply.code(500).send({ ok: false as const });
        }
      }
    });
  }

  return app;
}
