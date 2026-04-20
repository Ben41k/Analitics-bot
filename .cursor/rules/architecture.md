---
description: Глобальные правила архитектуры, контейнеризации, планировщика задач (Cron), автоматизации Git-хуков (Husky) и Observability.
globs: src/**/*.ts, Dockerfile, docker-compose.yml, .husky/**/*, package.json
---

# 🏗 BACKEND ARCHITECTURE & STANDARDS (AI-ANALYST BOT)

Ты — ведущий бэкенд-архитектор. Проект — автоматизированная аналитическая платформа.

## 🚀 ТЕХНОЛОГИЧЕСКИЙ СТЕК
- **Runtime:** Node.js (TypeScript) + Fastify (`fastify-type-provider-zod`)
- **Bot:** grammY (Webhooks в prod)
- **Database:** PostgreSQL + **pgvector** (ORM: Prisma)
- **Infrastructure:** Docker + Docker Compose
- **Automation:** `node-cron` + **Husky** (Git Hooks)
- **Validation:** Zod

## 🛠 ПРАВИЛА РАЗРАБОТКИ & ТИПИЗАЦИЯ
- **Zod First:** Сначала создается Zod-схема, затем бизнес-логика. Типы извлекаются через `z.infer<typeof schema>`.
- **Type Safety:** `any` запрещен в бизнес-логике. Исключения — только на внешних границах (SDK/Legacy) с обязательным `unknown`, комментарием причины и последующим сужением типа.
- **Containerization:** Разработка и запуск инфраструктуры (БД, Redis) — только через Docker.

## 🛡 QUALITY GATE & GIT HOOKS (Husky)
- **Pre-commit:** Перед каждым коммитом ОБЯЗАТЕЛЬНО выполнение:
    1. `lint-staged` — проверка стиля и автофикс измененных файлов.
    2. `tsc --noEmit` — проверка целостности типов по всему проекту.
- **Testing Baseline:** - Unit-тесты для чистых функций и сервисов.
    - Integration/Smoke тесты для `pipeline/` и критических `cron-tasks`.

## ⏱ SCHEDULED TASKS (Cron)
- **Logic Isolation:** В `*.task.ts` только триггер. Сама логика — в `pipeline/` или `service.ts`.
- **Execution Safety:** - Обязательный `timeout` на уровне задачи.
    - Запрет параллельных дублей (одна задача — один активный инстанс).
    - Логирование жизненного цикла: старт, успех, ошибка (с контекстом).

## 📂 СТРУКТУРА ПРОЕКТА (src/)
- `core/`: Инициализация Fastify, Prisma, Bot API и глобальных плагинов.
- `modules/`: Изолированные блоки (scraper, analyzer, rag, telegram).
- `pipeline/`: Оркестраторы процессов (соединение нескольких модулей).
- `schemas/`: Централизованные Zod-схемы.
- `tasks/`: Описание cron-задач (`*.task.ts`).

## 👁 OBSERVABILITY & LOGGING
- **Structured Logs:** Только JSON-формат (pino).
- **Traceability:** Каждая операция в Pipeline/Cron должна иметь `jobId` или `requestId`.
- **Context:** Ошибки логируются с входными данными (исключая sensitive data) и стеком вызовов.

## 📏 NAMING CONVENTION
- `*.schema.ts` (Zod), `*.service.ts` (Logic), `*.provider.ts` (External API/Scraper), `*.handler.ts` (Bot), `*.task.ts` (Cron).