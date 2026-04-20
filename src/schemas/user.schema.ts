import { z } from "zod";

export const telegramUserSchema = z.object({
  telegramId: z.number().int().positive(),
  username: z.string().min(1).max(64).optional(),
  firstName: z.string().max(128).optional(),
});

export type TelegramUser = z.infer<typeof telegramUserSchema>;
