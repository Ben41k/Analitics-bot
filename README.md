# Analytics_bot (ai-analyst-bot)

Telegram-бот для **спортивной аналитики по футболу**: показывает ближайшие матчи из базы, по нажатию кнопки запрашивает у LLM прогноз исхода (П1 / X / П2) с кратким разбором и сохраняет историю прогнозов для пользователя.

## Возможности

- **Синхронизация матчей** — загрузка расписания топ-лиг через [Football Data API](https://www.football-data.org/), upsert в PostgreSQL.
- **Обогащение контекста** — опционально до **5** ближайших матчей без превью дополняются текстовым превью через **Playwright** (парсинг Flashscore).
- **Прогноз в Telegram** — команда `/matches` и inline-кнопки; анализ через **OpenRouter** (OpenAI-совместимый `/chat/completions`).
- **История** — команда `/history` показывает последние сохранённые прогнозы пользователя.

## Стек

| Область | Технологии |
|--------|------------|
| Runtime | Node.js, TypeScript |
| Бот | [grammY](https://grammy.dev/) (long polling) |
| БД | PostgreSQL, [Prisma](https://www.prisma.io/), расширение **pgvector** (колонка `embedding` в схеме) |
| LLM | [OpenRouter](https://openrouter.ai/) (`axios` → `/chat/completions`) |
| Скрапинг | `axios` (Football Data), [Playwright](https://playwright.dev/) (Chromium) |
| Качество кода | ESLint, Prettier, Vitest, Husky |

## Структура репозитория (кратко)

- `src/core/` — точка входа (`app.ts`), конфиг (`config.ts`), Prisma-клиент, логгер, LLM-клиент.
- `src/core/bot.ts` — команды и callback-обработчики Telegram.
- `src/modules/scraper/` — синхронизация матчей и провайдеры данных.
- `src/modules/analyzer/` — промпт и разбор ответа LLM (JSON: исход, уверенность, текст).
- `src/scripts/sync-matches.ts` — CLI-синхронизация матчей (`npm run scrape`).
- `prisma/` — схема и миграции.

## Требования

1. **Node.js** 20+ (рекомендуется LTS).
2. **PostgreSQL** с поддержкой расширения **vector** (как в миграциях Prisma: `CREATE EXTENSION vector`).
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

Источник правды по валидации — `src/core/config.ts`. Минимально для **запуска процесса** бота нужны корректные `DATABASE_URL` и `BOT_TOKEN`. Для **прогнозов** обязателен `OPENROUTER_API_KEY`. Для **осмысленной синхронизации матчей** через Football Data API нужен `FOOTBALL_DATA_API_KEY` (в коде при отсутствии ключа запросы уходят с пустым токеном и обычно не дают данных).

| Переменная | Обязательность | Описание |
|------------|----------------|----------|
| `DATABASE_URL` | Да | Строка подключения PostgreSQL, например `postgresql://USER:PASSWORD@HOST:5432/DB?schema=public` |
| `BOT_TOKEN` | Да | Токен бота от [@BotFather](https://t.me/BotFather) |
| `OPENROUTER_API_KEY` | Для прогнозов | Ключ [OpenRouter](https://openrouter.ai/keys); без него бот стартует, но кнопка прогноза покажет предупреждение |
| `LLM_BASE_URL` | Нет | По умолчанию `https://openrouter.ai/api/v1` |
| `PRIMARY_REASONING_MODEL` | Нет | Слаг модели для основного анализа, по умолчанию `openai/gpt-4o` |
| `LONG_CONTEXT_MODEL` | Нет | Для длинного превью матча, по умолчанию `openai/gpt-4o-mini` |
| `OPENROUTER_HTTP_REFERER` | Нет | Заголовок для OpenRouter (рейтинг/идентификация) |
| `OPENROUTER_APP_TITLE` | Нет | Заголовок `X-Title` для OpenRouter |
| `NODE_ENV` | Нет | `development` \| `production` \| `test` |
| `LOG_LEVEL` | Нет | `info` \| `error` \| `debug` \| `trace` |
| `SCRAPER_HEADLESS` | Нет | `true` / `false` — headless-режим Chromium |
| `FOOTBALL_DATA_API_KEY` | Для `npm run scrape` | Токен [football-data.org](https://www.football-data.org/) |

Полный шаблон см. в `.env.example`.

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

Запускается отдельно от бота (по расписанию или вручную):

```bash
npm run scrape
```

Рекомендуемый порядок при первом знакомстве с проектом:

1. Настроить `.env` (БД, токен бота, при необходимости Football Data и OpenRouter).
2. `npx prisma migrate deploy` и `npm run prisma:generate`.
3. `npm run scrape` — наполнить таблицу `Match`.
4. `npm run dev` — открыть бота в Telegram и вызвать `/matches`.

## Команды в Telegram

| Команда | Действие |
|---------|----------|
| `/start` | Приветствие и список команд |
| `/help` | Краткая инструкция |
| `/matches` | До 20 ближайших матчей из БД + кнопки для прогноза |
| `/history` | Последние сохранённые прогнозы пользователя |

Прогноз создаётся по нажатию inline-кнопки под матчем (callback `predict:<uuid>`).

## Прочие npm-скрипты

| Скрипт | Назначение |
|--------|------------|
| `npm run lint` | ESLint с автофиксом по `src/**/*.ts` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest |
| `npm run prisma:generate` | `prisma generate` |
| `npm run prisma:migrate` | `prisma migrate dev` (локально) |

## Ограничения и заметки

- Скрапер обогащает превью **порциями по 5** матчей за запуск (`rawContent` пустой или null) — при большом числе новых матчей может потребоваться несколько запусков `npm run scrape`.
- Использование данных сторонних сайтов и API должно соответствовать их условиям использования и законодательству вашей юрисдикции.
- Прогнозы носят **информационный характер** и не являются финансовой или иной профессиональной рекомендацией.

## Лицензия

ISC (см. `package.json`).
