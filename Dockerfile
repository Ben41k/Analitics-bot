FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
