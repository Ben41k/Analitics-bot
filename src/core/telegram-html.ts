export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function outcomeLabel(outcome: '1' | 'X' | '2', homeTeam: string, awayTeam: string): string {
  if (outcome === '1') return `П1 — ${homeTeam}`;
  if (outcome === '2') return `П2 — ${awayTeam}`;
  return 'X — ничья';
}

export function truncateTelegramHtml(html: string, max = 3900): string {
  if (html.length <= max) return html;
  return `${html.slice(0, max - 20)}… <i>(обрезано)</i>`;
}
