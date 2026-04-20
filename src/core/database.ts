import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  prisma ??= new PrismaClient();
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }
}
