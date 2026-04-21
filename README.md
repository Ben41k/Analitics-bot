# Analytics Bot

Backend-сервис для сбора данных о футбольных матчах, семантического поиска (pgvector + RAG) и LLM-аналитики с интерфейсом Telegram-бота на **Grammy** и HTTP API на **Fastify**.

## Возможности

- **Синхронизация матчей** через [Football-Data.org](https://www.football-data.org/) — расписание и метаданные матчей по выбранным турнирам.
- **Скрапинг текстового контента** со страниц Flashscore через **Playwright** (Chromium), привязка к матчам по URL.
- **Эмбеддинги и векторное хранение** — PostgreSQL с расширением **pgvector**, RAG-параметр `RAG_TOP_K`.
- **Анализ матчей** через OpenAI-совместимый API (чат + эмбеддинги): настраиваемые базовый URL, ключ и модели.
- **Telegram-бот**: команды `/start`, `/upcoming` (ближайшие запланированные матчи из БД).
- **Планировщик задач** (`node-cron`): синхронизация Football-Data, скрапинг Flashscore, эмбеддинги, анализ, ретеншн — включается только при `ENABLE_CRON=true`.
- **Health-check**: `GET /health` проверяет доступность PostgreSQL.

## Стек

| Компонент        | Технология                          |
|-----------------|-------------------------------------|
| Язык            | TypeScript (ESM), Node.js **≥ 20**  |
| HTTP            | Fastify + Zod (`fastify-type-provider-zod`) |
| База данных     | PostgreSQL 16 + **pgvector** (Prisma) |
| Бот             | Grammy                              |
| Скрапинг        | Playwright (Chromium)               |
| Логи            | Pino                                |

## Архитектура пайплайна

Основной поток данных (упрощённо):

1. **Football sync** — загрузка матчей из Football-Data в таблицу `Match`.
2. **Flashscore scrape** — для матчей с URL заполняется `rawContent`.
3. **Embedding** — векторизация текста и запись в колонку `embedding` (тип `vector(1536)` по умолчанию).
4. **Analyze** — RAG + LLM, результат в поле `analysis` (JSON).
5. **Retention** — архивация/очистка по `RETENTION_DAYS`.

Расписание cron задаётся в `src/cron/register-schedulers.ts` (интервалы можно менять в коде).

## Требования

- **Node.js** версии 20 или выше.
- **PostgreSQL** с расширением **pgvector** (в репозитории используется образ `pgvector/pgvector:pg16` через Docker).

## Быстрый старт (локально)

### 1. Клонирование и зависимости

```bash
npm ci
```

После установки выполняется `postinstall`: `prisma generate`.

### 2. База данных

Поднять только PostgreSQL из Compose (порт **5433** на хосте):

```bash
docker compose up -d postgres
```

Либо свой инстанс PostgreSQL + pgvector; строку подключения указать в `DATABASE_URL`.

### 3. Переменные окружения

Скопировать пример и заполнить значения:

Windows (PowerShell/cmd):

```bash
copy .env.example .env
```

Linux / macOS:

```bash
cp .env.example .env
```

Обязательно задать минимум **`DATABASE_URL`**. Остальное зависит от сценария (см. раздел «Переменные окружения»).

### 4. Миграции

```bash
npm run db:migrate
```

Альтернатива для разработки без миграций: `npm run db:push` (осторожно в продакшене).

### 5. Запуск в режиме разработки

```bash
npm run dev
```

Сервер слушает адрес из `HOST` и порт `PORT` (по умолчанию `0.0.0.0:3000`).

- **Разработка** (`NODE_ENV=development`): при наличии `TELEGRAM_BOT_TOKEN` бот использует **long polling**.
- **Продакшен** (`NODE_ENV=production`): нужно настроить **вебхук** Telegram на URL вида  
  `POST https://<ваш-хост>/telegram/webhook/<TELEGRAM_WEBHOOK_SECRET_PATH>`  
  (секрет в пути должен совпадать с переменной окружения).

Проверка готовности:

```bash
curl http://localhost:3000/health
```

Ожидается JSON с `"ok": true`, если БД доступна.

## Запуск через Docker Compose (приложение + БД)

Файл `docker-compose.yml` поднимает `postgres` и сервис `app` (сборка из `Dockerfile`). Перед запуском подготовьте `.env` в корне проекта.

```bash
docker compose up --build
```

Команда приложения: миграции (`prisma migrate deploy`) и затем `node dist/index.js`. Внутри сети Compose для `DATABASE_URL` используйте хост `postgres` и порт **5432** (см. комментарии в `.env.example`).

## Скрипты npm

| Скрипт          | Назначение                          |
|-----------------|-------------------------------------|
| `npm run dev`   | Разработка с перезапуском (`tsx watch`) |
| `npm run build` | Сборка TypeScript → `dist/`        |
| `npm start`     | Запуск собранного `dist/index.js`  |
| `npm run lint`  | ESLint                              |
| `npm run format`| Prettier                            |
| `npm run typecheck` | Проверка типов без emit        |
| `npm test`      | Vitest                              |
| `npm run db:migrate` | Prisma migrate deploy        |
| `npm run db:push`    | Prisma db push (dev)         |
| `npm run db:seed`    | Сид из `prisma/seed.ts`      |

## Переменные окружения

Полный список с комментариями — в **`.env.example`**. Кратко:

| Переменная | Описание |
|------------|----------|
| `NODE_ENV` | `development` \| `test` \| `production` |
| `HOST`, `PORT` | Адрес HTTP-сервера |
| `LOG_LEVEL` | Уровень логов Pino |
| `DATABASE_URL` | Строка подключения PostgreSQL (обязательно) |
| `FOOTBALL_DATA_API_TOKEN` | Токен Football-Data.org (для синхронизации матчей) |
| `FOOTBALL_DATA_COMPETITION_IDS` | ID турниров через запятую (например Premier League `2021`) |
| `OPENAI_API_BASE_URL`, `OPENAI_API_KEY` | OpenAI-совместимый API для чата и эмбеддингов |
| `PRIMARY_REASONING_MODEL`, `LONG_CONTEXT_MODEL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Модели и размерность векторов |
| `TELEGRAM_BOT_TOKEN` | Токен бота от @BotFather (без токена бот не стартует) |
| `TELEGRAM_WEBHOOK_SECRET_PATH` | Секретный сегмент пути для вебхука (минимум 8 символов) |
| `ENABLE_CRON` | `true` / `false` — включить фоновые задачи по расписанию |
| `CRON_TZ` | Часовой пояс для cron |
| `SCRAPER_*`, `FOOTBALL_SYNC_*`, `RETENTION_DAYS`, `TASK_TIMEOUT_*`, `RAG_TOP_K` | Лимиты пайплайна и таймауты |

Без **`FOOTBALL_DATA_API_TOKEN`** синхронизация матчей из API не выполнится; без **`OPENAI_API_KEY`** не будут работать эмбеддинги и LLM-анализ; без **`TELEGRAM_BOT_TOKEN`** HTTP-сервер поднимется, но Telegram отключится (в логах будет предупреждение).

## Playwright и скрапинг

Скрапинг использует установленный через npm **Playwright** и браузер Chromium. При первом запуске на чистой машине может понадобиться:

```bash
npx playwright install chromium
```

Docker-образ основан на официальном **Playwright** (`mcr.microsoft.com/playwright`), браузеры уже входят в образ.

## Структура репозитория (обзор)

- `src/index.ts` — точка входа: конфиг, Prisma, Fastify, Telegram, cron.
- `src/core/` — конфигурация, логгер, приложение, БД.
- `src/modules/` — Football-Data, скрапер Flashscore, RAG, анализатор, Telegram.
- `src/tasks/` — задачи для cron (sync, scrape, embedding, analyze, retention).
- `src/cron/` — регистрация расписаний.
- `prisma/` — схема, миграции, сид.

## Лицензия

Проект помечен как `private` в `package.json`; уточняйте условия использования у владельца репозитория.
