import { Prisma } from '@prisma/client';
import prisma from './database';

/**
 * Флаги дайджеста вынесены в raw-SQL, чтобы не зависеть от устаревшего
 * сгенерированного Prisma Client в IDE (поле digestEnabled в схеме уже есть).
 */
export async function upsertUserDigestFlag(params: {
  id: bigint;
  username: string | null;
  firstName: string;
  digestEnabled: boolean;
}): Promise<void> {
  const { id, username, firstName, digestEnabled } = params;
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "User" (id, username, "firstName", "digestEnabled", "createdAt")
      VALUES (${id}, ${username}, ${firstName}, ${digestEnabled}, NOW())
      ON CONFLICT (id) DO UPDATE SET
        "digestEnabled" = EXCLUDED."digestEnabled",
        username = EXCLUDED.username,
        "firstName" = EXCLUDED."firstName"
    `,
  );
}

export async function getUserDigestFlag(userId: bigint): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ digestEnabled: boolean }>>(
    Prisma.sql`SELECT "digestEnabled" FROM "User" WHERE id = ${userId} LIMIT 1`,
  );
  return rows[0]?.digestEnabled === true;
}

export async function listDigestSubscriberUserIds(): Promise<bigint[]> {
  const rows = await prisma.$queryRaw<Array<{ id: bigint }>>(
    Prisma.sql`SELECT id FROM "User" WHERE "digestEnabled" = true`,
  );
  return rows.map((r) => r.id);
}
