import pino from 'pino';
import { Transform } from 'node:stream';
import { config } from './config';

const baseFields = {
  env: config.NODE_ENV,
  service: 'ai-analyst-bot',
};

const PINO_STD_KEYS = new Set(['level', 'time', 'msg', 'v', 'pid', 'hostname', 'name']);

function levelLabel(level: number | undefined): string {
  if (level === 60) return 'FATAL';
  if (level === 50) return 'ERROR';
  if (level === 40) return 'WARN';
  if (level === 30) return 'INFO';
  if (level === 20) return 'DEBUG';
  if (level === 10) return 'TRACE';
  return String(level ?? '');
}

/**
 * Свой «pretty» для development: без pino-pretty/chalk — на Windows/Git Bash они часто дают
 * кракозябры вместо кириллицы при том же UTF-8, с которым console.log работает нормально.
 */
function createDevPrettyDestination(): Transform {
  const t = new Transform({
    transform(chunk, _enc, callback) {
      const raw = chunk.toString('utf8');
      const lines = raw.split('\n').filter((line: string) => line.length > 0);
      let out = '';
      for (const line of lines) {
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(line) as Record<string, unknown>;
        } catch {
          out += line + '\n';
          continue;
        }
        const time = row.time as number | undefined;
        const ts =
          time !== undefined
            ? `${new Date(time).toISOString().slice(11, 19)} UTC`
            : '';
        const msg = typeof row.msg === 'string' ? row.msg : '';
        const lvl = levelLabel(row.level as number | undefined);
        out += `[${ts}] ${lvl}: ${msg}`;
        const extras: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (PINO_STD_KEYS.has(k)) continue;
          extras[k] = v;
        }
        if (Object.keys(extras).length > 0) {
          out += '\n' + JSON.stringify(extras, null, 4).replace(/^/gm, '    ');
        }
        out += '\n';
      }
      callback(null, out);
    },
  });
  t.pipe(process.stdout, { end: false });
  return t;
}

/**
 * Конфигурация логгера Pino
 * В production выводит чистый JSON для систем сбора логов.
 * В development — форматирование в том же процессе без pino-pretty (корректная кириллица в ConEmu/Git Bash).
 */
export const logger =
  config.NODE_ENV === 'development'
    ? pino(
        {
          level: config.LOG_LEVEL || 'info',
          base: baseFields,
        },
        createDevPrettyDestination(),
      )
    : pino({
        level: config.LOG_LEVEL || 'info',
        base: baseFields,
      });
