import { InlineKeyboard } from "grammy";

export const MENU_CALLBACK = {
  upcoming: "menu:upcoming",
  status: "menu:status",
  help: "menu:help",
} as const;

export function mainMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("Ближайшие матчи", MENU_CALLBACK.upcoming)
    .row()
    .text("Статус данных", MENU_CALLBACK.status)
    .text("Помощь", MENU_CALLBACK.help);
}
