/**
 * Единые плейсхолдеры для поля Match.rawContent (скрапер → БД → RAG / анализ).
 */

/** Пустой ответ скрапера, нет ссылок, ошибка извлечения — можно снова пробовать обогатить. */
export const NO_PREVIEW_PLACEHOLDER = 'No preview available';

/**
 * Текст был, но не прошёл проверку имён команд — повторять бессмысленно.
 * Не входит в очередь enrichMatchesWithPreview.
 */
export const PREVIEW_REJECTED_PLACEHOLDER =
  'Preview: rejected — team names not found in scraped text';

export function isUsableMatchRawContent(raw: string | null | undefined): boolean {
  if (raw == null) return false;
  const s = raw.trim();
  if (s.length === 0) return false;
  if (s === NO_PREVIEW_PLACEHOLDER) return false;
  if (s === PREVIEW_REJECTED_PLACEHOLDER) return false;
  return true;
}
