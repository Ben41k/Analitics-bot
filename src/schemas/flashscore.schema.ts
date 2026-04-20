import { z } from "zod";

export const flashscorePageContentSchema = z.object({
  text: z.string().min(1),
  sourceUrl: z.string().url(),
});

export type FlashscorePageContent = z.infer<typeof flashscorePageContentSchema>;
