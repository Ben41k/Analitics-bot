import type { Context } from 'grammy';

export function summarizeIncoming(ctx: Context): string {
  const u = ctx.update;
  if (u.message?.text) {
    const t = u.message.text;
    return `message text=${JSON.stringify(t.length > 160 ? `${t.slice(0, 160)}…` : t)}`;
  }
  if (u.callback_query?.data) return `callback data=${u.callback_query.data}`;
  if (u.message) return 'message (non-text)';
  if (u.edited_message) return 'edited_message';
  if (u.inline_query) return 'inline_query';
  return `update keys=${Object.keys(u).join(',')}`;
}
