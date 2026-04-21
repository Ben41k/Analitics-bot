import { chromium, BrowserContext, Frame, Page } from 'playwright';
import { logger } from '../../../core/logger';

/** Контекст страницы или iframe (куки часто в отдельном frame). */
type OverlayContext = Page | Frame;

function ownerPage(ctx: OverlayContext): Page {
  return 'goto' in ctx && typeof (ctx as Page).goto === 'function'
    ? (ctx as Page)
    : (ctx as Frame).page();
}

/**
 * Код для page.evaluate — только обычная строка (не TS callback), иначе tsx/esbuild
 * подставляет __name в браузере → ReferenceError: __name is not defined.
 */
const STRIP_OVERLAYS_IN_PAGE = `
(function () {
  var doc = document.documentElement;
  var body = document.body;
  if (body) {
    body.style.removeProperty('overflow');
    body.style.removeProperty('position');
    body.classList.remove('overflow-hidden', 'modal-open', 'translated-ltr', 'translated-rtl', 'skiptranslate');
  }
  doc.style.removeProperty('overflow');

  var vendorRoots = [
    '#onetrust-consent-sdk', '#onetrust-banner-sdk', '.onetrust-pc-dark-filter',
    '.ot-sdk-container', '.ot-sdk-backdrop', '#CybotCookiebotDialog', '#sp-cc-wrapper',
    '.fc-consent-root', '.qc-cmp-ui-container', '.qc-cmp2-container', '.modal-backdrop',
    '.modal-backdrop.show', '#didomi-host', '#didomi-popup', '.didomi-notice-banner',
    '#sp_message_container', '#truste-consent-track', '#usercentrics-root',
    '#cookiescript_injected', '#ncmp__tool', '.ncmp__overlay',
    '[data-nosnippet="google-one-tap"]', '#google-one-tap-container', '.google-one-tap-modal',
    '#google_translate_element', '.goog-te-banner-frame', '.goog-te-menu-frame', '#goog-gt-tt',
    '.skiptranslate', '[class*="goog-te-"]', '[id*="google_translate"]'
  ];
  var v, j, nodes, el, cs, pos, z, r, vw, vh, area, bigEnough, bag, textProbe, hint, textRe, all, i, ki, ifr, src, hidden, he, hcs, h, txt;
  for (v = 0; v < vendorRoots.length; v++) {
    nodes = document.querySelectorAll(vendorRoots[v]);
    for (j = 0; j < nodes.length; j++) { try { nodes[j].remove(); } catch (e1) {} }
  }

  ifr = document.querySelectorAll('iframe');
  for (ki = 0; ki < ifr.length; ki++) {
    src = (ifr[ki].getAttribute('src') || '') + ' ' + (ifr[ki].getAttribute('class') || '') + ' ' + (ifr[ki].id || '');
    if (/translate\\.google|goog-te|gtoolbar|consent\\.cookie|privacy-mgmt/i.test(src)) {
      try { ifr[ki].remove(); } catch (e2) {}
    }
  }

  hint = /consent|cookie|gdpr|privacy|cmp|modal|dialog|backdrop|overlay|banner|didomi|onetrust|sp_message|truste|usercentrics|quantcast|qc-cmp|fc-consent|syndicated|interstitial|newsletter|one-tap|sign.?up|goog|translate|skiptranslate/i;
  textRe = /cookie|consent|gdpr|privacy|файлы cookie|мы используем|accept all|принять/i;

  all = document.querySelectorAll('body *');
  for (i = 0; i < all.length; i++) {
    el = all[i];
    if (!el || el.nodeType !== 1) continue;
    cs = getComputedStyle(el);
    pos = cs.position;
    if (pos !== 'fixed' && pos !== 'sticky') continue;
    z = parseInt(cs.zIndex || '0', 10) || 0;
    r = el.getBoundingClientRect();
    vw = window.innerWidth;
    vh = window.innerHeight;
    area = Math.max(0, r.width) * Math.max(0, r.height);
    bigEnough = area >= vw * vh * 0.2 || (r.width >= vw * 0.7 && r.height >= vh * 0.35);
    if (!bigEnough && z < 5000) continue;
    bag = (el.id || '') + ' ' + (el.className || '') + ' ' + (el.getAttribute('data-testid') || '') +
      ' ' + (el.getAttribute('role') || '') + ' ' + (el.getAttribute('aria-label') || '');
    textProbe = ((el.textContent || '').slice(0, 500));
    if (!(hint.test(bag) || textRe.test(textProbe))) continue;
    try { el.remove(); } catch (e3) {}
  }

  all = document.querySelectorAll('body *');
  for (i = 0; i < all.length; i++) {
    el = all[i];
    if (!el || el.nodeType !== 1) continue;
    cs = getComputedStyle(el);
    if (cs.position !== 'fixed') continue;
    r = el.getBoundingClientRect();
    vw = window.innerWidth;
    vh = window.innerHeight;
    if (r.top < vh * 0.5) continue;
    if (r.width < vw * 0.72) continue;
    if (r.height < 28 || r.height > 520) continue;
    txt = (el.textContent || '').slice(0, 500);
    if (/cookie|consent|privacy|gdpr|принять|accept|agree|файлы/i.test(txt)) {
      try { el.remove(); } catch (e4) {}
    }
  }

  hidden = document.querySelectorAll('[aria-hidden="true"]');
  for (h = 0; h < hidden.length; h++) {
    he = hidden[h];
    if (!he || he.nodeType !== 1) continue;
    hcs = getComputedStyle(he);
    if (hcs.position === 'fixed' && parseInt(hcs.zIndex || '0', 10) > 1000) {
      try { he.remove(); } catch (e5) {}
    }
  }
})()
`;

/** Клик по кнопке Accept/Принять в основном документе (до strip, чтобы успеть нажать). */
const CLICK_CONSENT_TEXT_IN_PAGE = `
(function () {
  var pattern = /^(Accept All cookies|Accept All|Accept all cookies|Accept all|Accept|I agree|Allow All|Allow all|Allow|OK|Got it|Agree|Continue|Essential only|Принять все|Принять|Согласен|Хорошо|Понятно)$/i;
  var nodes = document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"], a[role="button"]');
  var i, el, t, st;
  for (i = 0; i < nodes.length; i++) {
    el = nodes[i];
    t = (el.innerText || el.textContent || el.value || '').trim().replace(/\\s+/g, ' ');
    if (!t || t.length > 120) continue;
    if (!pattern.test(t)) continue;
    st = window.getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity) === 0) continue;
    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      el.click();
      return 'clicked';
    } catch (e) {}
  }
  return '';
})()
`;

/** OneTrust часто рендерит кнопку внутри shadow root. */
const ONETRUST_SHADOW_CLICK_IN_PAGE = `
(function () {
  function clickInShadow(root) {
    if (!root || !root.shadowRoot) return false;
    var sr = root.shadowRoot;
    var btn = sr.getElementById && sr.getElementById('onetrust-accept-btn-handler');
    if (!btn) btn = sr.querySelector('#onetrust-accept-btn-handler, button[title*="Accept"], button.onetrust-accept-btn-handler');
    if (btn) {
      try { btn.click(); return true; } catch (e) {}
    }
    return false;
  }
  var a = document.getElementById('onetrust-consent-sdk');
  if (clickInShadow(a)) return 'shadow-sdk';
  var b = document.getElementById('onetrust-banner-sdk');
  if (clickInShadow(b)) return 'shadow-banner';
  var btn = document.getElementById('onetrust-accept-btn-handler');
  if (btn) {
    try { btn.click(); return 'flat'; } catch (e2) {}
  }
  return '';
})()
`;

/** Мгновенно скрыть крупные CMP-блоки (до кликов и strip), чтобы освободить экран. */
const HIDE_OT_FC_CONSENT_IN_PAGE = `
(function () {
  var sels = ['.ot-sdk-container', '.fc-consent-root'];
  var k, i, nodes, el;
  for (k = 0; k < sels.length; k++) {
    nodes = document.querySelectorAll(sels[k]);
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (!el) continue;
      try {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      } catch (e) {}
    }
  }
})()
`;

/**
 * Универсальные селекторы превью (Flashscore, Sports Mole и др.).
 * Храним массивом — split по запятой ломает селекторы с запятыми внутри.
 */
const PREVIEW_CONTENT_SELECTORS: readonly string[] = [
  '.preview-text-content',
  '[data-testid="wcl-scores-preview"]',
  '.description',
  '.previewContent',
  '.matchPreview',
  '.article-body',
  '#content_area',
  '[class*="wcl-preview"]',
  '[class*="main-content"]',
  '.description__text',
];

const PREVIEW_CONTENT_SELECTOR = PREVIEW_CONTENT_SELECTORS.join(', ');

/**
 * Аварийный «текстовый дамп»: самый крупный блок div/section/article/p без навигационного мусора.
 * Только строка для page.evaluate (без TS-колбэков → нет __name в esbuild/tsx).
 */
const TEXT_DUMP_FALLBACK_IN_PAGE = `
(function () {
  var tags = ['div', 'section', 'article', 'p'];
  var nav = [
    'privacy policy', 'cookie policy', 'terms of service', 'terms of use',
    'log in', 'sign in', 'sign up', 'subscribe', 'newsletter', 'accessibility',
    'gdpr', 'consent', 'advertisement', 'all rights reserved'
  ];
  function isNav(t) {
    var l = (t || '').toLowerCase();
    var k;
    for (k = 0; k < nav.length; k++) {
      if (l.indexOf(nav[k]) !== -1) return true;
    }
    return false;
  }
  var bestLen = 0;
  var bestText = '';
  var ti, nodes, j, node, txt, len;
  for (ti = 0; ti < tags.length; ti++) {
    nodes = document.getElementsByTagName(tags[ti]);
    for (j = 0; j < nodes.length; j++) {
      node = nodes[j];
      txt = (node.innerText || node.textContent || '').trim();
      len = txt.length;
      if (len <= 400) continue;
      if (isNav(txt)) continue;
      if (len > bestLen) {
        bestLen = len;
        bestText = txt;
      }
    }
  }
  if (bestText.length > 100) return bestText;
  var body = (document.body && (document.body.innerText || document.body.textContent)) || '';
  return (body || '').replace(/\\s+/g, ' ').trim();
})()
`;

/** Узел с текстом Preview → following-sibling (часто блок превью рядом с заголовком). */
const PREVIEW_XPATH_FOLLOWING_SIBLING =
  'xpath=//*[contains(text(), "Preview") or contains(text(), "PREVIEW")]/following-sibling::*';

/** Минимальная длина вырезанного текста, после которой считаем превью «догруженным». */
const MIN_PREVIEW_TEXT_LENGTH = 100;

/** Максимум символов `page.content()` в лог при пустом превью (защита логов). */
const MAX_HTML_SNIPPET_FOR_LOG = 80_000;

/** Скриншот отладки (относительно cwd процесса, обычно корень репозитория при `npm run`). */
const DEBUG_SCREENSHOT_PATH = 'debug.png';

/** Лимит innerHTML в console.log (полный HTML может завесить терминал). */
const MAX_INNER_HTML_CONSOLE = 15_000;

/** Уникальные class-токены, в которых встречается подстрока preview (регистронезависимо). */
const LIST_PREVIEW_RELATED_CLASS_TOKENS_IN_PAGE = `
(function () {
  var seen = Object.create(null);
  var out = [];
  var all = document.querySelectorAll('*');
  var i, j, el, tok;
  var max = Math.min(all.length, 12000);
  for (i = 0; i < max; i++) {
    el = all[i];
    if (!el || !el.classList) continue;
    for (j = 0; j < el.classList.length; j++) {
      tok = el.classList[j];
      if (!tok || !/preview/i.test(tok)) continue;
      if (seen[tok]) continue;
      seen[tok] = 1;
      out.push(tok);
    }
  }
  return out;
})()
`;

/** Эвристика: пустая страница или типичная заглушка / антибот Flashscore. */
const DETECT_FLASHSCORE_STUB_IN_PAGE = `
(function () {
  var t = (document.body && document.body.innerText) ? document.body.innerText.trim() : '';
  var html = (document.documentElement && document.documentElement.innerHTML)
    ? document.documentElement.innerHTML.slice(0, 80000) : '';
  var c = t + '\\n' + html;
  if (t.length < 140) {
    return { stub: true, reason: 'short_body', len: t.length, sample: t.slice(0, 600) };
  }
  if (/cloudflare|cf-ray|captcha|access denied|\\b403\\b|forbidden|robot|automated traffic|bot detected|are you a human|не робот|подтвердите|checking your browser|just a moment|enable javascript|cookies must be enabled|sorry.*blocked|unusual traffic/i.test(c)) {
    return { stub: true, reason: 'anti_bot_or_block', sample: t.slice(0, 600) };
  }
  return { stub: false };
})()
`;

export class FlashscoreProvider {
  private context: BrowserContext | null = null;

  /**
   * Инициализация контекста. 
   * В Docker используем headless: true и отключаем детекцию автоматизации.
   */
  async init() {
    if (this.context) return;
    
    this.context = await chromium.launchPersistentContext('user_data', {
      headless: false, // Обязательно для Docker
      locale: 'en-US',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--lang=en-US',
        // Chromium: перевод страниц (не путать с виджетом Google Translate на сайте)
        '--disable-features=Translate,TranslateUI',
        '--disable-translate',
      ],
      viewport: { width: 1280, height: 720 },
    });
  }

  /**
   * Закрытие всплывающих окон, куки-баннеров и полноэкранных оверлеев (включая iframe CMP).
   */
  private async handleOverlays(page: Page, rounds = 5) {
    for (let r = 0; r < rounds; r++) {
      await page.evaluate(HIDE_OT_FC_CONSENT_IN_PAGE).catch(() => {});
      await this.dismissOverlaysOnce(page);
      await page.waitForTimeout(400);
    }
  }

  /** Один проход: Escape, клики в DOM (в т.ч. Shadow DOM), затем вырезание слоёв, Playwright-клики, все frame. */
  private async dismissOverlaysOnce(page: Page) {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(200);

    await page.evaluate(CLICK_CONSENT_TEXT_IN_PAGE).catch(() => {});
    await page.evaluate(ONETRUST_SHADOW_CLICK_IN_PAGE).catch(() => {});

    await this.stripBlockingDom(page);
    await this.clickConsentInContext(page);

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        await frame.press('body', 'Escape').catch(() => {});
        await frame.evaluate(CLICK_CONSENT_TEXT_IN_PAGE).catch(() => {});
        await frame.evaluate(ONETRUST_SHADOW_CLICK_IN_PAGE).catch(() => {});
        await this.stripBlockingDom(frame);
        await this.clickConsentInContext(frame);
      } catch {
        /* frame мог уже отцепиться */
      }
    }

    await this.stripBlockingDom(page);
  }

  /** Снять блокировку скролла и вырезать типичные CMP / широкие fixed-слои. */
  private async stripBlockingDom(ctx: OverlayContext) {
    await ctx.evaluate(STRIP_OVERLAYS_IN_PAGE);
  }

  /** Клики по типовым кнопкам согласия и закрытия (только видимые). */
  private async clickConsentInContext(ctx: OverlayContext) {
    try {
      const primary = ctx
        .getByRole('button', {
          name: /^(Accept all cookies|Accept all|Accept|Allow all|Allow|I agree|OK|Got it|Принять все|Принять|Согласен)$/i,
        })
        .first();
      if (await primary.isVisible({ timeout: 2500 }).catch(() => false)) {
        await primary.click({ timeout: 4000, force: true });
        await ownerPage(ctx).waitForTimeout(450);
      }
    } catch {
      /* */
    }

    const clickSelectors = [
      '#onetrust-accept-btn-handler',
      '#onetrust-reject-all-handler',
      '.onetrust-close-btn-handler',
      '#didomi-notice-agree-button',
      'button#didomi-notice-agree-button',
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      '#CybotCookiebotDialogBodyButtonAccept',
      '.qc-cmp-button:not(.qc-cmp-secondary-button)',
      '[data-testid="cookie-accept-all"]',
      '[data-testid="uc-accept-all-button"]',
      'button.sp_choice_type_11',
      '.wizard__closeButton',
      '[data-testid*="close"]',
      'button[aria-label="Close"]',
      'button[aria-label="Закрыть"]',
      '.modal__close',
    ];

    for (const selector of clickSelectors) {
      try {
        const loc = ctx.locator(selector).first();
        if (!(await loc.isVisible({ timeout: 1200 }).catch(() => false))) continue;
        await loc.click({ timeout: 3000, force: true });
        await ownerPage(ctx).waitForTimeout(400);
      } catch {
        /* */
      }
    }

    const labelPatterns =
      /^(Accept all cookies|Accept all|Accept|I agree|Agree all|Agree|OK|Got it|Allow all|Allow|Continue|Принять все|Принять|Согласен|Понятно|Хорошо|Закрыть)$/i;

    try {
      const dialog = ctx.locator('[role="dialog"], [aria-modal="true"]').first();
      if (await dialog.isVisible({ timeout: 500 }).catch(() => false)) {
        const btn = dialog.getByRole('button', { name: labelPatterns }).first();
        if (await btn.isVisible({ timeout: 600 }).catch(() => false)) {
          await btn.click({ timeout: 1500, force: true });
          await ownerPage(ctx).waitForTimeout(350);
        }
      }
    } catch {
      /* */
    }

    try {
      const loose = ctx
        .getByRole('button', {
          name: /^(Accept|Allow all|I agree|Consent|Agree|Принять|Согласен)$/i,
        })
        .first();
      if (await loose.isVisible({ timeout: 400 }).catch(() => false)) {
        await loose.click({ timeout: 1200, force: true });
        await ownerPage(ctx).waitForTimeout(350);
      }
    } catch {
      /* */
    }

    try {
      const cookieBtn = ctx
        .locator(
          '[id*="cookie"], [id*="Cookie"], [id*="consent"], [id*="Consent"], [class*="cookie"], [class*="Cookie"], [class*="consent"]',
        )
        .locator('button')
        .filter({ hasText: /accept|allow|agree|принять|соглас|ok/i })
        .first();
      if (await cookieBtn.isVisible({ timeout: 350 }).catch(() => false)) {
        await cookieBtn.click({ timeout: 1200, force: true });
        await ownerPage(ctx).waitForTimeout(350);
      }
    } catch {
      /* */
    }
  }

  private static escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Тело predicate для waitForFunction (строка = тело функции в странице, см. Playwright pageFunction string).
   * Сигнал: есть узел по селектору ИЛИ в body.innerText видны обе команды.
   */
  private buildWaitForPreviewSignalScript(homeTeam: string, awayTeam: string): string {
    const selectorsJson = JSON.stringify([...PREVIEW_CONTENT_SELECTORS]);
    return `
var selectors = ${selectorsJson};
var home = ${JSON.stringify(homeTeam)};
var away = ${JSON.stringify(awayTeam)};
var i;
for (i = 0; i < selectors.length; i++) {
  try {
    if (document.querySelector(selectors[i])) return true;
  } catch (e) {}
}
var t = (document.body && document.body.innerText) || '';
var hl = home.trim().toLowerCase();
var al = away.trim().toLowerCase();
if (hl.length < 2 || al.length < 2) return false;
var tl = t.toLowerCase();
return tl.indexOf(hl) !== -1 && tl.indexOf(al) !== -1;
`;
  }

  /** Проверка «ключевых данных матча»: обе команды уже есть в innerText body. */
  private buildBodyHasBothTeamsScript(homeTeam: string, awayTeam: string): string {
    return `
(function () {
  var home = ${JSON.stringify(homeTeam)};
  var away = ${JSON.stringify(awayTeam)};
  var t = ((document.body && document.body.innerText) || '').toLowerCase();
  var hl = home.trim().toLowerCase();
  var al = away.trim().toLowerCase();
  if (hl.length < 2 || al.length < 2) return false;
  return t.indexOf(hl) !== -1 && t.indexOf(al) !== -1;
})()
`;
  }

  private async waitForPreviewDomReady(
    page: Page,
    timeoutMs: number,
    homeTeam: string,
    awayTeam: string,
  ): Promise<void> {
    await page.waitForFunction(this.buildWaitForPreviewSignalScript(homeTeam, awayTeam), undefined, {
      timeout: timeoutMs,
    });
  }

  private async readBodyInnerText(page: Page): Promise<string> {
    const raw = await page.evaluate(
      `(() => String((document.body && document.body.innerText) || ''))()`,
    );
    return String(raw).trim();
  }

  /** Сбор текста по известным CSS-селекторам превью (Playwright-локаторы, не в браузерной evaluate). */
  private async collectPreviewFromSelectors(page: Page): Promise<string> {
    let best = '';
    for (const sel of PREVIEW_CONTENT_SELECTORS) {
      try {
        const loc = page.locator(sel);
        const n = await loc.count();
        if (n === 0) continue;
        const txt = (await loc.first().innerText().catch(() => '')).trim();
        if (txt.length > best.length) best = txt;
      } catch {
        /* */
      }
    }
    return best;
  }

  /** Аварийный дамп, если селекторы и regex не дали достаточной длины. */
  private async extractTextDumpFallback(page: Page): Promise<string> {
    const raw = await page.evaluate(TEXT_DUMP_FALLBACK_IN_PAGE);
    return String(raw ?? '').trim();
  }

  /**
   * Вырезает блок превью из полного innerText body: сначала по именам команд, иначе по заголовку Preview.
   */
  private slicePreviewFromBody(full: string, homeTeam: string, awayTeam: string): string {
    const t = (full || '').replace(/\r\n/g, '\n');
    if (!t.trim()) return '';
    const h = FlashscoreProvider.escapeRe(homeTeam.trim());
    const a = FlashscoreProvider.escapeRe(awayTeam.trim());
    if (h.length >= 2 && a.length >= 2) {
      const combined = new RegExp(`${h}[\\s\\S]{0,500}?${a}|${a}[\\s\\S]{0,500}?${h}`, 'i');
      const m = t.match(combined);
      if (m && m[0].length >= 100) {
        const i0 = Math.max(0, t.indexOf(m[0]) - 300);
        return t.slice(i0, Math.min(t.length, i0 + 16000)).trim();
      }
    }
    const block = t.match(
      /(?:^|\n)[ \t]*[^\n]{0,120}(?:Preview|Превью)[^\n]*\n([\s\S]{100,16000}?)(?=\n[ \t]*(?:H2H|Lineups|Line-up|Summary|Odds|Betting|Изменения|Ставки)\b|\n{4,}|$)/i,
    );
    if (block?.[1]) return block[1].trim();
    const idx = t.search(/preview|превью/i);
    if (idx >= 0) return t.slice(idx, Math.min(t.length, idx + 16000)).trim();
    return '';
  }

  /**
   * Если на странице есть вкладка/кнопка «Preview», открываем её (часто контент грузится только после клика).
   */
  private async clickPreviewTabIfPresent(page: Page): Promise<void> {
    const clickSelectors = [
      'role=tab[name=/^preview$/i]',
      'role=tab[name="Preview"]',
      'role=button[name=/^preview$/i]',
      'text=/^Preview$/',
    ];
    for (const sel of clickSelectors) {
      try {
        const loc = page.locator(sel).first();
        if (!(await loc.isVisible({ timeout: 2200 }).catch(() => false))) continue;
        await page.click(sel, { timeout: 6000 });
        logger.info(`Вкладка/кнопка Preview: клик через page.click(${JSON.stringify(sel)})`);
        await page.waitForTimeout(900);
        return;
      } catch {
        /* пробуем следующий селектор */
      }
    }
  }

  private async logPreviewRelatedClassTokens(page: Page): Promise<void> {
    try {
      const tokens = (await page.evaluate(LIST_PREVIEW_RELATED_CLASS_TOKENS_IN_PAGE)) as string[];
      console.log('[flashscore] class tokens containing "preview":', tokens);
    } catch (e: unknown) {
      console.log('[flashscore] не удалось собрать классы preview:', String(e));
    }
  }

  /**
   * Проверка на пустую страницу или заглушку при детекте бота (перед парсингом контента).
   */
  private async assertPageIsNotFlashscoreStub(page: Page): Promise<void> {
    const res = (await page.evaluate(DETECT_FLASHSCORE_STUB_IN_PAGE)) as {
      stub: boolean;
      reason?: string;
      len?: number;
      sample?: string;
    };
    if (!res || !res.stub) return;
    const detail = JSON.stringify(
      { reason: res.reason, len: res.len, sample: res.sample },
      null,
      0,
    );
    throw new Error(`Flashscore вернул заглушку или блокировку (${detail})`);
  }

  /**
   * Лёгкий скролл для lazy-load. Если в DOM уже есть обе команды — прекращаем сразу (без бесконечного скролла).
   */
  private async nudgeScrollForLazyLoad(
    page: Page,
    passes = 3,
    homeTeam?: string,
    awayTeam?: string,
  ): Promise<void> {
    for (let i = 0; i < passes; i++) {
      if (homeTeam && awayTeam) {
        const hasKey = (await page
          .evaluate(this.buildBodyHasBothTeamsScript(homeTeam, awayTeam))
          .catch(() => false)) as boolean;
        if (hasKey === true) return;
      }
      await page.mouse.wheel(0, 550);
      await page.waitForTimeout(320);
      await page.mouse.wheel(0, -180);
      await page.waitForTimeout(180);
    }
  }

  /**
   * Сбор превью: селекторы → body + regex; XPath; при длине < порога — текстовый дамп в странице.
   */
  private async extractPreviewFromAllContexts(
    page: Page,
    homeTeam: string,
    awayTeam: string,
  ): Promise<string> {
    await page.evaluate(`(() => { window.scrollBy(0, 500); })()`).catch(() => {});

    const fromSelectors = (await this.collectPreviewFromSelectors(page)).trim();
    const full = await this.readBodyInnerText(page);
    let best = this.slicePreviewFromBody(full, homeTeam, awayTeam);
    if (fromSelectors.length > best.length) best = fromSelectors;

    if (best.length < MIN_PREVIEW_TEXT_LENGTH) {
      let xpathBlob = '';
      try {
        const loc = page.locator(PREVIEW_XPATH_FOLLOWING_SIBLING);
        const n = await loc.count();
        for (let i = 0; i < Math.min(n, 50); i++) {
          xpathBlob += `${(await loc.nth(i).innerText().catch(() => '')).trim()}\n`;
        }
      } catch {
        /* */
      }
      const fromXpath = this.slicePreviewFromBody(xpathBlob, homeTeam, awayTeam);
      if (fromXpath.length > best.length) best = fromXpath;
    }

    if (best.length < MIN_PREVIEW_TEXT_LENGTH) {
      const dumped = await this.extractTextDumpFallback(page);
      if (dumped.length > best.length) best = dumped;
    }

    return best.trim();
  }

  /**
   * Ожидание готовности: вкладка Preview → waitForFunction (селектор ИЛИ обе команды в body) → короткий poll.
   */
  private async waitForContentReady(
    page: Page,
    timeoutMs: number,
    homeTeam: string,
    awayTeam: string,
  ): Promise<void> {
    await this.clickPreviewTabIfPresent(page);

    await this.waitForPreviewDomReady(page, timeoutMs, homeTeam, awayTeam);

    const pollUntil = Date.now() + Math.min(timeoutMs, 45_000);
    while (Date.now() < pollUntil) {
      try {
        await page.evaluate(`(() => { window.scrollBy(0, 500); })()`).catch(() => {});
        const full = await this.readBodyInnerText(page);
        const text = this.slicePreviewFromBody(full, homeTeam, awayTeam);
        if (text.length > MIN_PREVIEW_TEXT_LENGTH) return;

        const hasTeams = (await page
          .evaluate(this.buildBodyHasBothTeamsScript(homeTeam, awayTeam))
          .catch(() => false)) as boolean;
        if (hasTeams === true) return;
      } catch {
        /* */
      }
      await this.nudgeScrollForLazyLoad(page, 1, homeTeam, awayTeam);
      await page.waitForTimeout(450);
    }

    try {
      const full = await this.readBodyInnerText(page);
      const text = this.slicePreviewFromBody(full, homeTeam, awayTeam);
      if (text.length > MIN_PREVIEW_TEXT_LENGTH) return;
      const hasTeams = (await page
        .evaluate(this.buildBodyHasBothTeamsScript(homeTeam, awayTeam))
        .catch(() => false)) as boolean;
      if (hasTeams === true) return;
    } catch {
      /* */
    }

    await this.logPreviewRelatedClassTokens(page);
    throw new Error('Контент превью не готов: innerText не превысил порог за отведённое время');
  }

  /**
   * Глубокая отладка: скриншот после оверлеев и перед чтением DOM + console по каждому селектору превью.
   */
  private async debugCaptureBeforeExtract(page: Page): Promise<void> {
    try {
      await page.screenshot({ path: DEBUG_SCREENSHOT_PATH });
      logger.info(`Отладка: скриншот сохранён ${DEBUG_SCREENSHOT_PATH} (cwd: ${process.cwd()})`);
    } catch (e: unknown) {
      logger.warn(`Отладка: не удалось сохранить ${DEBUG_SCREENSHOT_PATH}: ${String(e)}`);
    }

    for (const selector of PREVIEW_CONTENT_SELECTORS) {
      console.log(`[flashscore debug] selector: ${JSON.stringify(selector)}`);
      const loc = page.locator(selector);
      const count = await loc.count();
      console.log('Elements found:', count);
      const visible = await page.isVisible(selector).catch(() => false);
      console.log('Is visible:', visible);
      if (count > 0) {
        const rawHtml = await loc.first().innerHTML().catch((err: unknown) => `(innerHTML error: ${String(err)})`);
        const html =
          typeof rawHtml === 'string' && rawHtml.length > MAX_INNER_HTML_CONSOLE
            ? `${rawHtml.slice(0, MAX_INNER_HTML_CONSOLE)}...[truncated ${rawHtml.length - MAX_INNER_HTML_CONSOLE} chars]`
            : rawHtml;
        console.log(html);
      } else {
        console.log('(innerHTML: нет узлов, count === 0)');
      }
    }
  }

  private async logPageHtmlWhenPreviewEmpty(page: Page): Promise<void> {
    const html = await page.content().catch(() => '');
    const len = html.length;
    const snippet =
      len > MAX_HTML_SNIPPET_FOR_LOG
        ? `${html.slice(0, MAX_HTML_SNIPPET_FOR_LOG)}\n...[truncated, total ${len} chars]...`
        : html;
    logger.warn(
      `Превью пустое или слишком короткое; HTML страницы (${len} символов):\n${snippet}`,
    );
  }

  /**
   * Основной метод получения превью матча.
   */
  async getMatchPreview(homeTeam: string, awayTeam: string): Promise<string> {
    if (!this.context) await this.init();
    
    const page: Page = await this.context!.newPage();
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

    try {
      page.setDefaultTimeout(60000);

      const searchQuery = encodeURIComponent(`${homeTeam} vs ${awayTeam} flashscore preview`);
      const searchUrl = `https://duckduckgo.com/?q=${searchQuery}`;
      
      logger.info(`🌐 Поиск через DuckDuckGo: ${homeTeam} - ${awayTeam}`);
      
      await page.goto(searchUrl, { waitUntil: 'load', timeout: 45000 });

      await this.handleOverlays(page, 2);

      const anchors = page.locator('a[data-testid="result-title-a"]');
      await anchors.first().waitFor({ state: 'visible', timeout: 20000 });
      const n = await anchors.count();
      const hrefs: string[] = [];
      for (let i = 0; i < n; i++) {
        const h = await anchors.nth(i).getAttribute('href');
        if (h) hrefs.push(h);
      }
      const flashHref = hrefs.find(
        (h) =>
          /flashscore\.(com|co\.uk|ru|ua|kz|org|jp)\b/i.test(h) || /\/\/www\.flashscore\./i.test(h),
      );
      const targetUrl = flashHref ?? hrefs[0];

      if (!targetUrl) throw new Error('URL не найден в результатах поиска');

      if (flashHref) {
        logger.info(`⏳ Переход на Flashscore: ${targetUrl}`);
      } else {
        logger.info(`⏳ Первый результат поиска (не flashscore в топе): ${targetUrl}`);
      }
      
      // Используем networkidle для гарантии подгрузки тяжелых скриптов
      await page.goto(targetUrl, {
        waitUntil: 'load',
        timeout: 45000,
      }).catch(() => logger.info('⚠️ load не достигнут на Flashscore, продолжаем по таймауту...'));

      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {
        logger.info('⚠️ networkidle не достигнут, продолжаем (долгий рендер Flashscore)...');
      });

      // Доп. пауза для зон вроде detail_right_zone
      await sleep(2000);

      // Очистка оверлеев перед чтением (несколько проходов — баннеры всплывают с задержкой)
      await this.handleOverlays(page);

      logger.info(
        '🔍 Ожидание готовности контента (waitForFunction: селекторы или обе команды в body → poll)...',
      );
      await this.waitForContentReady(page, 75_000, homeTeam, awayTeam);

      await this.handleOverlays(page, 2);

      await this.nudgeScrollForLazyLoad(page, 4, homeTeam, awayTeam);
      await this.handleOverlays(page, 1);

      await this.assertPageIsNotFlashscoreStub(page);

      await this.debugCaptureBeforeExtract(page);

      let previewText = await this.extractPreviewFromAllContexts(page, homeTeam, awayTeam);
      previewText = (previewText || '').trim();

      if (!previewText) {
        const allText = await this.readBodyInnerText(page);
        const head = (allText || '').slice(0, 2000);
        logger.warn(`Flashscore: пустой extract, дамп body.innerText (первые 2000 симв.): ${head}`);
        const hasPreview = /preview|превью/i.test(allText || '');
        const hn = homeTeam.trim();
        const an = awayTeam.trim();
        const hasTeams =
          hn.length >= 2 &&
          an.length >= 2 &&
          (allText || '').toLowerCase().includes(hn.toLowerCase()) &&
          (allText || '').toLowerCase().includes(an.toLowerCase());
        logger.info(
          `Flashscore дамп-анализ: есть Preview/Превью=${hasPreview}, видны обе команды=${hasTeams}`,
        );
      }

      if (previewText.length < MIN_PREVIEW_TEXT_LENGTH) {
        await this.logPageHtmlWhenPreviewEmpty(page);
      }

      return previewText;
    } catch (error: any) {
      logger.error(`❌ Ошибка провайдера: ${error.message}`);
      const msg = typeof error?.message === 'string' ? error.message : '';
      if (
        msg.includes('Блоки превью не появились') ||
        msg.includes('Текст превью не стал достаточно длинным') ||
        msg.includes('Контент превью не готов') ||
        msg.includes('Flashscore вернул заглушку')
      ) {
        throw error;
      }
      return '';
    } finally {
      if (!page.isClosed()) {
        await page.close();
      }
    }
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}