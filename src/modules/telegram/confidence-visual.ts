/**
 * Поля для бейджа. Пересечение с Record<string, unknown> убирает правило «weak type»
 * (все свойства optional → у Prisma-объекта «нет общих свойств» с типом аргумента).
 */
export type MatchConfidenceSnapshot = {
  analyzedAt?: Date | null;
  analysisFinalConfidence?: number | null;
  confidenceStatus?: string | null;
} & Record<string, unknown>;

/** Короткая строка для списка /matches и дайджеста (HTML). */
export function formatMatchConfidenceBadgeHtml(m: MatchConfidenceSnapshot): string {
  if (!m.analyzedAt || m.analysisFinalConfidence == null) {
    return '<i>нет анализа</i>';
  }
  const fc = m.analysisFinalConfidence;
  const high = m.confidenceStatus === 'High Confidence';
  if (high) {
    return `🟢 <b>${fc}%</b> · высокая`;
  }
  if (fc >= 50) {
    return `🟡 <b>${fc}%</b> · средняя`;
  }
  return `🔴 <b>${fc}%</b> · низкая`;
}
