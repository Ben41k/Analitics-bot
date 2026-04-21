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

const EXTRACT_PREVIEW_IN_PAGE = `
(function () {
  var selectors = [
    '.previewContent', '.matchPreview', '.description__text',
    '[data-testid="wcl-scores-preview"]'
  ];
  var s, el, t;
  for (s = 0; s < selectors.length; s++) {
    el = document.querySelector(selectors[s]);
    if (el && el.textContent && el.textContent.trim().length > 100) {
      return el.textContent.trim();
    }
  }
  var divs = document.querySelectorAll('div');
  for (var d = 0; d < divs.length; d++) {
    var node = divs[d];
    var inner = (node.innerText || '').toLowerCase();
    if ((inner.indexOf('preview') >= 0 || inner.indexOf('превью') >= 0) && (node.innerText || '').length > 150) {
      return (node.innerText || '').trim();
    }
  }
  return '';
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
      
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

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
        waitUntil: 'networkidle', 
        timeout: 45000 
      }).catch(() => logger.info('⚠️ Networkidle не достигнут, продолжаем по таймауту...'));

      // "Терпеливая" пауза для рендера динамики
      await sleep(3000); 

      // Очистка оверлеев перед чтением (несколько проходов — баннеры всплывают с задержкой)
      await this.handleOverlays(page);

      // Ждем появления контента
      logger.info('🔍 Ожидание блоков текста...');
      await page.waitForSelector('.previewContent, .description, .description__text', { 
        timeout: 20000,
        state: 'attached'
      }).catch(() => logger.info('🐌 Контент грузится долго, пробуем извлечь всё, что есть...'));

      await this.handleOverlays(page, 2);

      const previewText = (await page.evaluate(EXTRACT_PREVIEW_IN_PAGE)) as string;

      return previewText;
    } catch (error: any) {
      logger.error(`❌ Ошибка провайдера: ${error.message}`);
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