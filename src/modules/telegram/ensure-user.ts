import type { Context } from 'grammy';
import prisma from '../../core/database';

export async function ensureUser(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;
  await prisma.user.upsert({
    where: { id: BigInt(from.id) },
    create: {
      id: BigInt(from.id),
      username: from.username ?? null,
      firstName: from.first_name ?? 'User',
    },
    update: {
      username: from.username ?? null,
      firstName: from.first_name ?? 'User',
    },
  });
}
