import type { PrismaClient } from "@prisma/client";

export async function acquireCronLock(params: {
  prisma: PrismaClient;
  jobName: string;
  ownerId: string;
  ttlMs: number;
}): Promise<boolean> {
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + params.ttlMs);

  return params.prisma.$transaction(async (tx) => {
    const updated = await tx.cronJobLock.updateMany({
      where: { jobName: params.jobName, lockedUntil: { lt: now } },
      data: { ownerId: params.ownerId, lockedUntil },
    });
    if (updated.count === 1) {
      return true;
    }

    try {
      await tx.cronJobLock.create({
        data: {
          jobName: params.jobName,
          ownerId: params.ownerId,
          lockedUntil,
        },
      });
      return true;
    } catch {
      return false;
    }
  });
}

export async function releaseCronLock(params: {
  prisma: PrismaClient;
  jobName: string;
  ownerId: string;
}): Promise<void> {
  await params.prisma.cronJobLock.deleteMany({
    where: { jobName: params.jobName, ownerId: params.ownerId },
  });
}
