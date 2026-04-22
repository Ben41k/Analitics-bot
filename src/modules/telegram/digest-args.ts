import { z } from 'zod';

const digestSubcommandSchema = z.enum(['on', 'off']);

export type DigestParseResult =
  | { kind: 'status' }
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'invalid'; message: string };

/**
 * Разбор текста сообщения `/digest …` (grammy передаёт полный текст; учитываем /digest@botname).
 */
export function parseDigestCommandArgs(messageText: string | undefined): DigestParseResult {
  if (!messageText?.trim()) {
    return { kind: 'status' };
  }

  const parts = messageText.trim().split(/\s+/).filter(Boolean);
  const args = parts.slice(1).map((p) => p.toLowerCase());

  if (args.length === 0) {
    return { kind: 'status' };
  }

  if (args.length > 1) {
    return {
      kind: 'invalid',
      message: 'Укажи не больше одного аргумента: on или off.',
    };
  }

  const sub = digestSubcommandSchema.safeParse(args[0]);
  if (!sub.success) {
    return {
      kind: 'invalid',
      message:
        'Неизвестный аргумент. Используй: <code>/digest on</code> или <code>/digest off</code>. Без аргумента — статус подписки.',
    };
  }

  return sub.data === 'on' ? { kind: 'on' } : { kind: 'off' };
}
