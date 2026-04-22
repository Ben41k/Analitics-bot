---
description: Правила работы с Claude/Gemini, генерации эмбеддингов и поиска в pgvector.
globs: src/modules/{analyzer,rag}/**/*
---

# 🧠 AI & RAG STRATEGY

## 🚀 LLM CORE STRATEGY
- **Model roles (Gemini):** Идентификаторы моделей задаются через env/config:
  - `GEMINI_PRIMARY_MODEL` — короткий контекст (по умолчанию `gemini-1.5-flash`).
  - `GEMINI_LONG_CONTEXT_MODEL` — длинное превью матча (по умолчанию `gemini-1.5-pro`).
- **Configuration:** Идентификаторы моделей задаются через env/config, чтобы обновлять модель без изменения кода.
- **Prompts:** Все системные инструкции и промпты должны храниться в `src/modules/analyzer/prompts/`.

## 📊 DATABASE & VECTORS (pgvector)
- **Vector Engine:** PostgreSQL + Prisma + pgvector.
- **Querying:** Поскольку Prisma не всегда поддерживает нативно операторы векторов, используй `Prisma.$queryRaw` для поиска по сходству.
- **Operator:** Для поиска по косинусному сходству используй оператор `<=>`.
    - *Пример:* `ORDER BY embedding <=> $1::vector`.
- **Safety:** При использовании `Prisma.$queryRaw` применяй параметризованные запросы, не допускай интерполяцию пользовательского ввода в SQL-строку.

## 🛠 ЛОГИКА АНАЛИЗА
- **Pipeline:** Анализ должен идти по цепочке: `Данные -> Эмбеддинг -> RAG (поиск контекста) -> LLM (обработка) -> Финальный результат`.
- **Validation:** Результат генерации LLM также желательно проверять через Zod (если формат ответа JSON).
- **Fallbacks:** Для LLM-вызовов определяй retry/backoff и поведение при деградации (fallback на запасную модель/упрощенный режим ответа).