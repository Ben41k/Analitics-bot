# Analytics_bot (ai-analyst-bot)

Telegram-бот для **спортивной аналитики по футболу**: матчи попадают в PostgreSQL через синхронизацию с [Football Data API](https://www.football-data.org/) и опциональное обогащение превью (Playwright), затем **в фоне** прогоняется пайплайн RAG → **Google Gemini** (структурированный JSON, факторы уверенности F1–F10) с записью результата в таблицу `Match`. В чате команда `/matches` показывает уже проанализированные матчи из базы; опционально работает **дайджест** по расписанию для подписчиков `/digest on`.

## Возможности

- **Синхронизация матчей** — загрузка расписания топ-лиг через Football Data API, upsert в PostgreSQL.
- **Обогащение контекста** — опционально до **5** ближайших матчей без превью дополняются текстом через **Playwright** (парсинг Flashscore).
- **RAG и эмбеддинги** — векторная колонка `embedding` (pgvector, 768 измерений под `gemini-embedding-001`), контекст для промпта в `RagService`.
- **Фоновый анализ** — крон `ENABLE_ANALYSIS_CRON` или разовый запуск `npm run analyze`: очередь матчей без `analyzedAt`, оркестратор `MatchAnalyticFlow`.
- **Интерфейс в Telegram** — `/matches` (готовые анализы из БД), `/digest on|off` (подписка на дайджест при включённом `ENABLE_CRON` на сервере).
- **Обход ограничений сети** — опционально свой Bot API: `TELEGRAM_API_ROOT` / `TELEGRAM_API_FALLBACK_ROOT`; для Gemini по умолчанию задаётся прокси `GEMINI_API_BASE_URL` (см. каталог `gemini-proxy/` для собственного Worker).

## Стек

| Область | Технологии |
|--------|------------|
| Runtime | Node.js 20+, TypeScript |
| Бот | [grammY](https://grammy.dev/) (long polling) |
| БД | PostgreSQL, [Prisma](https://www.prisma.io/), расширение **pgvector** |
| LLM | [Google AI / Gemini](https://ai.google.dev/) (`@google/generative-ai`), schema-guided JSON |
| Скрапинг | `axios` (Football Data), [Playwright](https://playwright.dev/) (Chromium) |
| Планировщик | [node-cron](https://www.npmjs.com/package/node-cron) (дайджест и анализ) |
| Качество кода | ESLint, Prettier, Vitest, Husky |

## Структура репозитория (кратко)

- `src/core/` — точка входа (`app.ts`), конфиг (`config.ts`), Prisma, логгер, запуск бота (`bot.ts`).
- `src/modules/telegram/` — регистрация команд и колбэков (`register-handlers.ts`), визуализация уверенности.
- `src/modules/scraper/` — синхронизация матчей и провайдеры данных.
- `src/modules/rag/` — контекст из БД и эмбеддинги (`vector.service.ts`).
- `src/modules/analyzer/` — вызов Gemini и расчёт итоговой уверенности.
- `src/pipeline/` — `MatchAnalyticFlow`: RAG → модель → скор → обновление `Match`.
- `src/tasks/` — крон дайджеста (`digest-cron.task.ts`), крон анализа (`analysis.task.ts`).
- `src/scripts/sync-matches.ts` — CLI синхронизации (`npm run scrape`).
- `src/scripts/run-analysis-once.ts` — однократный прогон анализа (`npm run analyze`).
- `prisma/` — схема и миграции.
- `gemini-proxy/` — пример Cloudflare Worker как HTTP-прослойка к Generative Language API (опционально).

## Требования

1. **Node.js** 20+ (рекомендуется LTS).
2. **PostgreSQL** с расширением **vector** (как в миграциях Prisma: `CREATE EXTENSION vector`).
3. Для скрапера превью — установленный браузер Playwright (**Chromium**).

## Установка

```bash
git clone <url-репозитория>
cd Analytics_bot
npm install
```

Установка браузера для Playwright (нужно для обогащения матчей превью с Flashscore):

```bash
npx playwright install chromium
```

Создайте файл окружения:

```bash
cp .env.example .env
```

Заполните переменные (см. ниже).

Примените миграции и сгенерируйте Prisma Client:

```bash
npx prisma migrate deploy
npm run prisma:generate
```

Для локальной разработки вместо `migrate deploy` можно использовать:

```bash
npm run prisma:migrate
```

## Переменные окружения

Источник правды по валидации — `src/core/config.ts`. Минимально для **процесса бота** нужны корректные `DATABASE_URL` и `BOT_TOKEN`. Для **фонового анализа** и `npm run analyze` — `GOOGLE_AI_API_KEY`. Для **осмысленной синхронизации матчей** — `FOOTBALL_DATA_API_KEY` (без ключа запросы уходят с пустым токеном и обычно не возвращают данные).

Поддерживаются **алиасы** имён (см. `config.ts` и `.env.example`): `TELEGRAM_BOT_TOKEN` → `BOT_TOKEN`, `GEMINI_API_KEY` → `GOOGLE_AI_API_KEY`, `GEMINI_PRIMARY_MODEL` → `GEMINI_MODEL`, `FOOTBALL_DATA_API_TOKEN` → `FOOTBALL_DATA_API_KEY`.

| Переменная | Обязательность | Описание |
|------------|----------------|----------|
| `DATABASE_URL` | Да | PostgreSQL, например `postgresql://USER:PASSWORD@HOST:5432/DB?schema=public` |
| `BOT_TOKEN` | Да | Токен бота от [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_API_ROOT` | Нет | Свой Bot API / зеркало без слэша в конце, если недоступен `api.telegram.org` |
| `TELEGRAM_API_FALLBACK_ROOT` | Нет | Вторая попытка `getMe`/long polling при сбое основного хоста |
| `TELEGRAM_HTTP_TIMEOUT_SECONDS` | Нет | Таймаут HTTP к Telegram, по умолчанию `30` (5–120) |
| `GOOGLE_AI_API_KEY` | Для анализа / крона анализа | Ключ [Google AI Studio](https://aistudio.google.com/app/apikey); без ключа бот стартует, но фоновый анализ не выполняется |
| `GEMINI_MODEL` | Нет | Модель для анализа, по умолчанию `gemini-2.5-flash` (короткие имена `gemini-1.5-flash*` в коде переписываются на 2.5) |
| `GEMINI_EMBEDDING_MODEL` | Нет | Эмбеддинги для RAG, по умолчанию `gemini-embedding-001` (768 измерений) |
| `GEMINI_API_BASE_URL` | Нет | Базовый URL API без хвостового `/`; по умолчанию — Worker-прокси; для прямого Google: `https://generativelanguage.googleapis.com` |
| `NODE_ENV` | Нет | `development` \| `production` \| `test` |
| `LOG_LEVEL` | Нет | `info` \| `error` \| `debug` \| `trace` |
| `SCRAPER_HEADLESS` | Нет | `true` / `false` — headless Chromium |
| `FOOTBALL_DATA_API_KEY` | Для `npm run scrape` | Токен [football-data.org](https://www.football-data.org/) |
| `ENABLE_CRON` | Нет | `true` — включить крон **дайджеста** |
| `CRON_TZ` | Нет | Часовой пояс node-cron, по умолчанию `UTC` |
| `CRON_DIGEST_SCHEDULE` | Нет | Выражение cron (5 полей), напр. `0 9 * * *` |
| `CRON_DIGEST_LOOKAHEAD_HOURS` | Нет | Горизонт матчей для дайджеста (1–168), по умолчанию `48` |
| `CRON_RUN_SCRAPE` | Нет | Перед дайджестом вызывать синхронизацию матчей (тяжело, Playwright) |
| `ENABLE_ANALYSIS_CRON` | Нет | `true` — периодический фоновый анализ матчей без `analyzedAt` |
| `CRON_ANALYSIS_SCHEDULE` | Нет | Расписание анализа (5 полей), по умолчанию `30 */6 * * *` |
| `CRON_ANALYSIS_BATCH` | Нет | Сколько матчей за один запуск (1–200), по умолчанию `8` |
| `CRON_ANALYSIS_RUN_SCRAPE` | Нет | Перед анализом вызывать `syncUpcomingMatches` |

Полный шаблон с комментариями — `.env.example`.

## Способы запуска

### Режим разработки (hot reload через `tsx`)

```bash
npm run dev
```

Алиас: `npm run dev:bot` — то же самое.

### Сборка и production-запуск

```bash
npm run build
npm start
```

Точка входа после сборки: `dist/core/app.js` (см. `package.json` → `"main"`).

### Синхронизация матчей в БД

Отдельно от бота (по расписанию, вручную или из крона):

```bash
npm run scrape
```

### Однократный фоновый анализ (без ожидания крона)

Тот же код, что у `ENABLE_ANALYSIS_CRON`; нужен `GOOGLE_AI_API_KEY`:

```bash
npm run analyze
```

### Рекомендуемый порядок при первом знакомстве

1. Настроить `.env` (БД, токен бота, при необходимости Football Data и `GOOGLE_AI_API_KEY`).
2. `npx prisma migrate deploy` и `npm run prisma:generate`.
3. `npm run scrape` — наполнить таблицу `Match`.
4. `npm run analyze` (или включить `ENABLE_ANALYSIS_CRON`) — заполнить поля анализа у матчей.
5. `npm run dev` — в Telegram: `/matches`.

Для дайджеста на сервере: `ENABLE_CRON=true`, задать `CRON_DIGEST_SCHEDULE` и `CRON_TZ`, пользователям — `/digest on`.

## Команды в Telegram

| Команда | Действие |
|---------|----------|
| `/start` | Приветствие и список команд |
| `/help` | Краткая инструкция (фоновый анализ, `/matches`, дайджест) |
| `/matches` | До 35 последних матчей с заполненным `analyzedAt` — исход, уверенность, краткий разбор из БД |
| `/digest` | Статус подписки; `/digest on` / `/digest off` — рассылка дайджеста при включённом серверном кроне |

Интерактивных кнопок «прогноз по запросу» в текущей версии нет: анализ выполняется в фоне и отображается через `/matches`.

## Прочие npm-скрипты

| Скрипт | Назначение |
|--------|------------|
| `npm run lint` | ESLint с автофиксом по `src/**/*.ts` |
| `npm run typecheck` | `prisma generate` и `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run prisma:generate` | `prisma generate` |
| `npm run prisma:migrate` | `prisma migrate dev` (локально) |

## Ограничения и заметки

- Скрапер обогащает превью **порциями по 5** матчей за запуск (`rawContent` пустой или null) — при большом числе новых матчей может потребоваться несколько запусков `npm run scrape`.
- Использование данных сторонних сайтов и API должно соответствовать их условиям использования и законодательству вашей юрисдикции.
- Прогнозы и аналитика носят **информационный характер** и не являются финансовой или иной профессиональной рекомендацией.

## Лицензия

ISC (см. `package.json`).
