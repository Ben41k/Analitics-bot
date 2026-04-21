FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

# В образе нет `.git`; `prepare` → husky иначе может завершиться с ошибкой.
ENV HUSKY=0

# `postinstall` запускает `prisma generate` — схема должна быть скопирована до `npm ci`.
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
