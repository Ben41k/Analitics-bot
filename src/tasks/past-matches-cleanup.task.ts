import type { PrismaClient } from '@prisma/client';
import { logger } from '../core/logger';

/**
 * Удаляет матчи, у которых календарная дата (в указанной IANA-зоне) строго раньше,
 * чем сегодняшняя календарная дата в той же зоне.
 * Поле `date` в БД трактуется как момент времени в UTC (как отдаёт API / Prisma).
 */
export async function deleteMatchesPastCalendarDay(
  prisma: PrismaClient,
  params: { timeZone: string },
): Promise<number> {
  const tz = params.timeZone;
  const rows = await prisma.$queryRaw<{ cnt: bigint }[]>`
    WITH del AS (
      DELETE FROM "Match"
      WHERE (
        (("date"::timestamp AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date
      ) < (
        (CURRENT_TIMESTAMP AT TIME ZONE ${tz})::date
      )
      RETURNING id
    )
    SELECT COUNT(*)::bigint AS cnt FROM del
  `;
  const deleted = Number(rows[0]?.cnt ?? 0);
  if (deleted > 0) {
    logger.info(
      { stage: 'past_matches_cleanup', deletedCount: deleted, timeZone: tz },
      'Удалены матчи с календарной датой раньше сегодняшней',
    );
  }
  return deleted;
}
