import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { BrowserContext, Page, errors } from 'playwright';
import { logger } from '../../../core/logger';

chromium.use(stealthPlugin());

/** Навигационный шум, который вычищаем из собранного текста. */
const NAV_PHRASES: readonly string[] = [
  'privacy policy',
  'cookie policy',
  'terms of service',
  'terms of use',
  'log in',
  'sign in',
  'sign up',
  'subscribe',
  'newsletter',
  'accessibility',
  'gdpr',
  'consent',
  'advertisement',
  'all rights reserved',
  'cookies',
  'accept all',
  'принять все',
  'menu',
  'home',
  'search',
];

const MIN_GOOD_PREVIEW_LENGTH = 300;

/** Максимум символов `page.content()` в лог при пустом превью (защита логов). */
const MAX_HTML_SNIPPET_FOR_LOG = 80_000;

/** Подстроки в hostname — такие результаты поиска не открываем. */
const blacklistDomains = ['flashscore', 'livescore'] as const;

/** Маркеры рекламы / неорганики в URL результатов DuckDuckGo. */
const AD_URL_MARKERS = ['ad_domain', 'aclick', 'ad_provider', 'googleadservices'] as const;

/** Максимум символов в теле статьи для ИИ (ARTICLE CONTENT). */
const MAX_ARTICLE_TEXT_LENGTH = 8000;

const CHROME_DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/** Типичные оверлеи (в т.ч. WordPress-попапы) — удаляем перед сбором текста. */
const OVERLAY_ROOT_SELECTORS = ['.wp-popup', '.wp-modal'] as const;

/** Таймаут навигации и на сбор контента со страницы (мс). */
const GOTO_TIMEOUT_MS = 30_000;
const EXTRACT_DEADLINE_MS = 30_000;

const DDG_SPA_REFERER = 'https://www.google.com/';
const DDG_HTML_REFERER = 'https://duckduckgo.com/';

/**
 * Удаление fixed-слоёв с большим z-index — только строка для evaluate (без TS в браузере → нет __name).
 */
const EVAL_STRIP_FIXED_HIGH_Z = `(function(){var nodes=document.querySelectorAll('*');for(var i=0;i<nodes.length;i++){var el=nodes[i];if(!el||el.nodeType!==1)continue;var cs=window.getComputedStyle(el);if(cs.position!=='fixed')continue;var z=parseInt(cs.zIndex||'0',10)||0;if(!isFinite(z)||z<=100)continue;try{el.remove();}catch(e0){}}})()`;

/** Мета из `<head>` для блока METADATA в ответе для ИИ. */
export interface MatchPageMetadata {
  title: string;
  description: string;
  keywords: string;
}

/**
 * Единый текст для анализа ИИ: источник, мета (title, description, keywords), основной текст страницы.
 */
export function buildFullContentForAI(
  url: string,
  metadata: MatchPageMetadata,
  mainArticleText: string,
): string {
  const metaDescription = [
    metadata.title && `Title: ${metadata.title}`,
    metadata.description && `Description: ${metadata.description}`,
    metadata.keywords && `Keywords: ${metadata.keywords}`,
  ]
    .filter(Boolean)
    .join('\n');

  return `
SOURCE: ${url}
METADATA: ${metaDescription || '(none)'}
ARTICLE CONTENT: ${mainArticleText}
`.trim();
}

function isBlacklistedPreviewUrl(href: string, baseUrl: string): boolean {
  try {
    const host = new URL(href, baseUrl).hostname.toLowerCase();
    return blacklistDomains.some((d) => host.includes(d));
  } catch {
    return false;
  }
}

function isAdSearchResultUrl(href: string, baseUrl: string): boolean {
  let full = '';
  try {
    full = new URL(href, baseUrl).href.toLowerCase();
  } catch {
    full = href.toLowerCase();
  }
  return AD_URL_MARKERS.some((m) => full.includes(m));
}

export class FlashscoreProvider {
  private context: BrowserContext | null = null;

  private async humanPauseBeforeNavigation(): Promise<void> {
    await new Promise((r) => setTimeout(r, Math.random() * 2000 + 1000));
  }

  /** Меньше «шумных» запросов (картинки, шрифты) — снижает риск триггеров антибота. */
  private async blockHeavyAssets(page: Page): Promise<void> {
    await page
      .route('**/*.{png,jpg,jpeg,svg,woff,woff2}', (route) => route.abort())
      .catch(() => {});
  }

  private async saveDebugScreenshot(page: Page): Promise<void> {
    if (page.isClosed()) return;
    await page.screenshot({ path: 'debug-screenshot.png' }).catch(() => {});
  }

  private async jitterBeforeSearch(page: Page): Promise<void> {
    await page.waitForTimeout(Math.random() * 3000 + 1000);
  }

  private async isDdgBlockedOrErrorPage(page: Page): Promise<boolean> {
    const t = (await page.locator('body').innerText().catch(() => '')) ?? '';
    return (
      /unexpected error/i.test(t) ||
      /Unfortunately, bots use DuckDuckGo/i.test(t) ||
      /made by a human/i.test(t)
    );
  }

  /**
   * Основная выдача duckduckgo.com (SPA).
   * @returns `null` — нужен fallback на html.duckduckgo.com/html/
   */
  private async collectDdgSpaResultHrefs(page: Page, searchUrl: string): Promise<string[] | null> {
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: GOTO_TIMEOUT_MS,
      referer: DDG_SPA_REFERER,
    });
    await this.handleOverlays(page);
    await page.waitForLoadState('networkidle', { timeout: GOTO_TIMEOUT_MS }).catch(() => {});

    if (await this.isDdgBlockedOrErrorPage(page)) {
      logger.warn(
        'DuckDuckGo (SPA): блокировка или Unexpected error — переключаемся на html.duckduckgo.com/html/',
      );
      return null;
    }

    const anchors = page.locator('a[data-testid="result-title-a"]');
    const n = await anchors.count();
    if (n === 0) {
      logger.warn('DuckDuckGo (SPA): нет ссылок результатов — переключаемся на html.duckduckgo.com/html/');
      return null;
    }

    const hrefs: string[] = [];
    for (let i = 0; i < n; i++) {
      const h = await anchors.nth(i).getAttribute('href');
      if (h) hrefs.push(h);
    }
    return hrefs;
  }

  /** Классическая HTML-выдача (меньше JS, другой путь на сервере DDG). */
  private async collectDdgHtmlResultHrefs(page: Page, homeTeam: string, awayTeam: string): Promise<string[]> {
    const q = `${homeTeam} vs ${awayTeam} match preview -site:flashscore.com`;
    const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    logger.info('🌐 Поиск через html.duckduckgo.com/html/');

    await this.jitterBeforeSearch(page);
    await page.goto(htmlUrl, {
      waitUntil: 'domcontentloaded',
      timeout: GOTO_TIMEOUT_MS,
      referer: DDG_HTML_REFERER,
    });
    await this.handleOverlays(page);

    if (await this.isDdgBlockedOrErrorPage(page)) {
      logger.warn('DuckDuckGo HTML: капча или сообщение о боте');
      return [];
    }

    const anchors = page.locator('a.result__a');
    await anchors.first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});

    const n = await anchors.count();
    const hrefs: string[] = [];
    const base = page.url();
    for (let i = 0; i < n; i++) {
      const h = await anchors.nth(i).getAttribute('href');
      if (!h) continue;
      try {
        hrefs.push(new URL(h, base).href);
      } catch {
        hrefs.push(h);
      }
    }
    return hrefs;
  }

  /**
   * Инициализация контекста.
   * В Docker используем headless: true и отключаем детекцию автоматизации.
   */
  async init() {
    if (this.context) {
      const br = this.context.browser();
      if (br && br.isConnected()) return;
      await this.close();
    }

    this.context = await chromium.launchPersistentContext('user_data', {
      headless: true,
      userAgent: CHROME_DESKTOP_UA,
      locale: 'ru-RU',
      timezoneId: 'Europe/Moscow',
      extraHTTPHeaders: {
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--lang=ru-RU',
        // Встроенный перевод Chrome и панель Translate
        '--disable-features=Translate,TranslateUI',
        '--disable-translate',
      ],
      viewport: { width: 1920, height: 1080 },
      screen: { width: 1920, height: 1080 },
    });
  }

  /**
   * Escape + удаление типичных полноэкранных оверлеев (fixed, z-index > 100).
   */
  private async handleOverlays(page: Page) {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.evaluate(EVAL_STRIP_FIXED_HIGH_Z).catch(() => {});
  }

  /** Удаление известных корневых оверлеев перед извлечением meta / DOM-текста. */
  private async stripKnownOverlayRoots(page: Page) {
    const selJson = JSON.stringify([...OVERLAY_ROOT_SELECTORS]);
    await page.evaluate(
      `(function(){var sel=${selJson};for(var s=0;s<sel.length;s++){var nodes=document.querySelectorAll(sel[s]);for(var i=0;i<nodes.length;i++){try{nodes[i].remove();}catch(e1){}}}})()`,
    );
  }

  private cleanPreviewText(raw: string): string {
    let t = (raw || '').replace(/\r\n/g, '\n');
    t = t.replace(/[ \t]+/g, ' ');
    t = t.replace(/\n{3,}/g, '\n\n');
    for (const phrase of NAV_PHRASES) {
      if (!phrase) continue;
      const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      t = t.replace(re, ' ');
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  /** Варианты названия для поиска: полное lower, первые два слова («West Ham»), первое слово. */
  private static teamSearchNeedles(team: string): string[] {
    const t = team.trim().toLowerCase();
    if (t.length < 2) return [];
    const words = t.split(/\s+/).filter(Boolean);
    const needles = new Set<string>();
    needles.add(t);
    if (words.length >= 2) needles.add(`${words[0]} ${words[1]}`);
    if (words.length >= 1) needles.add(words[0]);
    return [...needles].filter((n) => n.length >= 2);
  }

  /**
   * Агрессивный «бульдозер»: гибкие названия команд (lower + короткие формы), Preview/Match;
   * если ничего не найдено — самый крупный блок как «единственный контент»;
   * при длине меньше 500 символов — fallback на body; итог обрезается до MAX_ARTICLE_TEXT_LENGTH.
   * Скрипт в браузере — только строка evaluate (без TS/замыканий).
   */
  private async extractBulldozerArticle(page: Page, teamA: string, teamB: string): Promise<string> {
    type AggResult = {
      text: string;
      chosenLen: number;
      hasTeamHome: boolean;
      hasTeamAway: boolean;
      source: 'block' | 'body' | 'dominant';
    };

    const homeNeedles = FlashscoreProvider.teamSearchNeedles(teamA);
    const awayNeedles = FlashscoreProvider.teamSearchNeedles(teamB);
    const argJson = JSON.stringify({
      homeNeedles,
      awayNeedles,
      maxBody: MAX_ARTICLE_TEXT_LENGTH,
    });

    const bulldozerScript = `(function(){var P=${argJson};var homeNeedles=P.homeNeedles;var awayNeedles=P.awayNeedles;var maxBody=P.maxBody;function matchesNeedles(textLower,needles){for(var i=0;i<needles.length;i++){var n=needles[i];if(n.length>=2&&textLower.indexOf(n)!==-1)return true;}return false;}var previewRe=/preview/i;var matchRe=/\\bmatch\\b/i;var minLen=20;var dominantMinLen=120;var elements=Array.prototype.slice.call(document.querySelectorAll('div, article, section, p'));var bestText='';var bestLen=0;var bestHasHome=false;var bestHasAway=false;var i;var el;var text;var len;var tl;var hasHome;var hasAway;var hasSignal;var useful;for(i=0;i<elements.length;i++){el=elements[i];text=(el.innerText||'').trim();len=text.length;if(len<minLen)continue;tl=text.toLowerCase();hasHome=matchesNeedles(tl,homeNeedles);hasAway=matchesNeedles(tl,awayNeedles);hasSignal=previewRe.test(text)||matchRe.test(text);useful=hasHome||hasAway||hasSignal;if(!useful)continue;if(len>bestLen){bestLen=len;bestText=text;bestHasHome=hasHome;bestHasAway=hasAway;}}var source='block';if(bestLen===0){var domText='';var domLen=0;var j;var domEl;for(j=0;j<elements.length;j++){domEl=elements[j];text=(domEl.innerText||'').trim();len=text.length;if(len<dominantMinLen)continue;if(len>domLen){domLen=len;domText=text;}}if(domLen>0){bestText=domText;bestLen=domLen;tl=domText.toLowerCase();bestHasHome=matchesNeedles(tl,homeNeedles);bestHasAway=matchesNeedles(tl,awayNeedles);source='dominant';}}var outText=bestText;if(bestLen<500&&document.body){outText=(document.body.innerText||'').substring(0,maxBody);source='body';}var outLower=outText.toLowerCase();var hasTeamHome=matchesNeedles(outLower,homeNeedles);var hasTeamAway=matchesNeedles(outLower,awayNeedles);return{text:outText,chosenLen:outText.length,hasTeamHome:hasTeamHome,hasTeamAway:hasTeamAway,source:source};})()`;

    const result = (await page.evaluate(bulldozerScript)) as AggResult;

    console.log(`Нашел блок текста, длина: ${result.chosenLen} символов`);
    const hasAnyTeamName = result.hasTeamHome || result.hasTeamAway;
    console.log(`Содержит ли команды? ${hasAnyTeamName ? 'Да' : 'Нет'}`);
    const srcLabel =
      result.source === 'body'
        ? 'document.body (fallback)'
        : result.source === 'dominant'
          ? 'крупнейший блок без сигнала команд'
          : 'крупнейший DOM-блок';
    console.log(`Источник извлечения: ${srcLabel}`);

    let cleaned = this.cleanPreviewText(String(result.text ?? ''));
    if (cleaned.length > MAX_ARTICLE_TEXT_LENGTH) {
      cleaned = cleaned.slice(0, MAX_ARTICLE_TEXT_LENGTH);
    }
    return cleaned;
  }

  /** Title, description, keywords из `<head>` (og:title / title, description / og:description, keywords). */
  private async collectPageMetadata(page: Page): Promise<MatchPageMetadata> {
    const ogTitle =
      (await page
        .locator('meta[property="og:title"]')
        .first()
        .getAttribute('content')
        .catch(() => null)) ?? '';
    const docTitle = (await page.title().catch(() => '')) ?? '';
    const title = this.cleanPreviewText((ogTitle.trim() || docTitle).trim());

    const metaDesc =
      (await page
        .locator('meta[name="description"]')
        .first()
        .getAttribute('content')
        .catch(() => null)) ?? '';
    const ogDesc =
      (await page
        .locator('meta[property="og:description"]')
        .first()
        .getAttribute('content')
        .catch(() => null)) ?? '';
    const description = this.cleanPreviewText((metaDesc.trim() || ogDesc.trim()));

    const kwRaw =
      (await page
        .locator('meta[name="keywords"]')
        .first()
        .getAttribute('content')
        .catch(() => null)) ?? '';
    const keywords = this.cleanPreviewText(kwRaw);

    return { title, description, keywords };
  }

  private async logPageHtmlWhenPreviewEmpty(page: Page): Promise<void> {
    const html = await page.content().catch(() => '');
    const len = html.length;
    const snippet =
      len > MAX_HTML_SNIPPET_FOR_LOG
        ? `${html.slice(0, MAX_HTML_SNIPPET_FOR_LOG)}\n...[truncated, total ${len} chars]...`
        : html;
    logger.warn(
      `ARTICLE CONTENT короткий или пустой; HTML страницы (${len} символов):\n${snippet}`,
    );
  }

  /** Контекст живой; при обрыве — пересоздание. */
  private async ensureActiveContext(): Promise<BrowserContext> {
    await this.init();
    return this.context!;
  }

  /**
   * Открыть URL статьи; при 403 — пропуск (следующая ссылка в выдаче).
   */
  private async tryOpenArticleUrl(page: Page, url: string): Promise<'ok' | 'skip'> {
    await this.humanPauseBeforeNavigation();
    try {
      const resp = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: GOTO_TIMEOUT_MS,
      });
      if (resp?.status() === 403) {
        logger.warn('403 Forbidden');
        return 'skip';
      }
      return 'ok';
    } catch (e: unknown) {
      if (e instanceof errors.TimeoutError) {
        throw e;
      }
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('403') || /forbidden/i.test(msg)) {
        logger.warn('403 Forbidden');
        return 'skip';
      }
      logger.warn(`⚠️ Ошибка page.goto, пробуем следующую ссылку: ${msg}`);
      return 'skip';
    }
  }

  /** Сбор превью со уже открытой страницы статьи (внутри таймаута 30 с). */
  private async runArticleExtractionPipeline(
    page: Page,
    homeTeam: string,
    awayTeam: string,
  ): Promise<string> {
    await page.waitForTimeout(5000);
    await this.handleOverlays(page);
    await page.waitForTimeout(5000);
    await this.stripKnownOverlayRoots(page);

    const sourceUrl = page.url();

    let metadata = await this.collectPageMetadata(page);
    let mainArticleText = await this.extractBulldozerArticle(page, homeTeam, awayTeam);
    let fullContentForAI = buildFullContentForAI(sourceUrl, metadata, mainArticleText);

    if (mainArticleText.length < MIN_GOOD_PREVIEW_LENGTH) {
      await this.handleOverlays(page);
      await this.stripKnownOverlayRoots(page);
      await page.waitForTimeout(400);
      metadata = await this.collectPageMetadata(page);
      mainArticleText = await this.extractBulldozerArticle(page, homeTeam, awayTeam);
      fullContentForAI = buildFullContentForAI(page.url(), metadata, mainArticleText);
    }

    if (mainArticleText.length < MIN_GOOD_PREVIEW_LENGTH) {
      await this.logPageHtmlWhenPreviewEmpty(page);
    }

    return fullContentForAI;
  }

  /**
   * Поиск страницы превью и сбор единого блока для ИИ (SOURCE + METADATA + ARTICLE CONTENT).
   */
  async getMatchPreview(homeTeam: string, awayTeam: string): Promise<string> {
    const ctx = await this.ensureActiveContext();

    let page: Page;
    try {
      page = await ctx.newPage();
    } catch (e: unknown) {
      logger.warn(`newPage не удался (${String(e)}), пересоздаём контекст`);
      await this.close();
      await this.init();
      page = await this.context!.newPage();
    }

    try {
      page.setDefaultTimeout(GOTO_TIMEOUT_MS + 5000);

      const searchQuery = encodeURIComponent(
        `${homeTeam} vs ${awayTeam} match preview -site:flashscore.com`,
      );
      const searchUrl = `https://duckduckgo.com/?q=${searchQuery}`;

      logger.info(`🌐 Поиск через DuckDuckGo: ${homeTeam} - ${awayTeam}`);

      await this.jitterBeforeSearch(page);
      const spaHrefs = await this.collectDdgSpaResultHrefs(page, searchUrl);
      let hrefs = spaHrefs ?? [];
      if (hrefs.length === 0) {
        hrefs = await this.collectDdgHtmlResultHrefs(page, homeTeam, awayTeam);
      }

      await this.blockHeavyAssets(page);

      const allowed = hrefs.filter(
        (h) =>
          !isBlacklistedPreviewUrl(h, page.url()) && !isAdSearchResultUrl(h, page.url()),
      );

      if (allowed.length === 0) {
        throw new Error(
          'Нет подходящих ссылок: отфильтрованы blacklist, рекламные URL или ссылки некорректны',
        );
      }

      for (const targetUrl of allowed) {
        logger.info(`⏳ Переход на превью: ${targetUrl}`);

        const opened = await this.tryOpenArticleUrl(page, targetUrl);
        if (opened === 'skip') continue;

        let fullContentForAI: string;
        try {
          fullContentForAI = await Promise.race([
            this.runArticleExtractionPipeline(page, homeTeam, awayTeam),
            new Promise<string>((_, reject) => {
              setTimeout(
                () => reject(new Error('EXTRACT_TIMEOUT')),
                EXTRACT_DEADLINE_MS,
              );
            }),
          ]);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg === 'EXTRACT_TIMEOUT') {
            logger.warn('⏱️ За 30 с контент не собран — пробуем следующую ссылку');
            continue;
          }
          throw e;
        }

        const head = fullContentForAI.slice(0, 200).replace(/\s+/g, ' ');
        console.log(
          `Скачанный текст (первые 200 симв.): ${head}${fullContentForAI.length > 200 ? '…' : ''}`,
        );

        if (!page.isClosed()) {
          await page.close();
        }
        return fullContentForAI;
      }

      logger.error('❌ Все органические ссылки недоступны или вернули 403');
      return '';
    } catch (error: unknown) {
      if (error instanceof errors.TimeoutError) {
        await this.saveDebugScreenshot(page);
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`❌ Ошибка провайдера: ${message}`);
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
