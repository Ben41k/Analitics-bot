-- text-embedding-004 и прочие эмбеддинги Generative Language API: 768 измерений (раньше было 1536).
UPDATE "Match" SET embedding = NULL WHERE embedding IS NOT NULL;
ALTER TABLE "Match" ALTER COLUMN "embedding" TYPE vector(768);
