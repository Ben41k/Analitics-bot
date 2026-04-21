import { chromium, BrowserContext, Page } from 'playwright';
import { logger } from '../../../core/logger';

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

/** Типичные оверлеи (в т.ч. WordPress-попапы) — удаляем перед сбором текста. */
const OVERLAY_ROOT_SELECTORS = ['.wp-popup', '.wp-modal'] as const;

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

export class FlashscoreProvider {
  private context: BrowserContext | null = null;

  /**
   * Инициализация контекста.
   * В Docker используем headless: true и отключаем детекцию автоматизации.
   */
  async init() {
    if (this.context) return;

    this.context = await chromium.launchPersistentContext('user_data', {
      headless: false,
      locale: 'en-US',
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--lang=en-US',
        '--disable-features=Translate,TranslateUI',
        '--disable-translate',
      ],
      viewport: { width: 1280, height: 720 },
    });
  }

  /**
   * Escape + удаление типичных полноэкранных оверлеев (fixed, z-index > 100).
   */
  private async handleOverlays(page: Page) {
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.evaluate(() => {
      const nodes = document.querySelectorAll('*');
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        if (!el || el.nodeType !== Node.ELEMENT_NODE) continue;
        const cs = window.getComputedStyle(el as Element);
        if (cs.position !== 'fixed') continue;
        const z = parseInt(cs.zIndex || '0', 10);
        if (!Number.isFinite(z) || z <= 100) continue;
        try {
          (el as Element).remove();
        } catch {
          /* */
        }
      }
    }).catch(() => {});
  }

  /** Удаление известных корневых оверлеев перед извлечением meta / DOM-текста. */
  private async stripKnownOverlayRoots(page: Page) {
    await page.evaluate((selectors) => {
      for (let s = 0; s < selectors.length; s++) {
        const nodes = document.querySelectorAll(selectors[s]);
        for (let i = 0; i < nodes.length; i++) {
          try {
            nodes[i].remove();
          } catch {
            /* */
          }
        }
      }
    }, [...OVERLAY_ROOT_SELECTORS]);
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

  /**
   * Агрессивный «бульдозер»: слабый фильтр (команда / Preview / Match), крупнейший блок;
   * при длине меньше 500 символов — fallback на обрезанный body.innerText (до 5000 символов).
   */
  private async extractBulldozerArticle(page: Page, teamA: string, teamB: string): Promise<string> {
    type AggResult = {
      text: string;
      chosenLen: number;
      hasTeamHome: boolean;
      hasTeamAway: boolean;
      source: 'block' | 'body';
    };

    const result = (await page.evaluate(([home, away]) => {
      const previewRe = /preview/i;
      const matchRe = /\bmatch\b/i;
      const minLen = 20;

      const elements = Array.from(document.querySelectorAll('div, article, section, p'));
      let bestText = '';
      let bestLen = 0;
      let bestHasHome = false;
      let bestHasAway = false;

      for (let i = 0; i < elements.length; i++) {
        const el = elements[i] as HTMLElement;
        const text = (el.innerText || '').trim();
        const len = text.length;
        if (len < minLen) continue;
        const hasHome = home.length > 0 && text.includes(home);
        const hasAway = away.length > 0 && text.includes(away);
        const hasSignal = previewRe.test(text) || matchRe.test(text);
        const useful = hasHome || hasAway || hasSignal;
        if (!useful) continue;
        if (len > bestLen) {
          bestLen = len;
          bestText = text;
          bestHasHome = hasHome;
          bestHasAway = hasAway;
        }
      }

      let outText = bestText;
      let source: 'block' | 'body' = 'block';

      if (bestLen < 500 && document.body) {
        outText = (document.body.innerText || '').substring(0, 5000);
        source = 'body';
      }

      const hasTeamHome = home.length > 0 && outText.includes(home);
      const hasTeamAway = away.length > 0 && outText.includes(away);
      return {
        text: outText,
        chosenLen: outText.length,
        hasTeamHome,
        hasTeamAway,
        source,
      };
    }, [teamA, teamB])) as AggResult;

    console.log(`Нашел блок текста, длина: ${result.chosenLen} символов`);
    const hasAnyTeamName = result.hasTeamHome || result.hasTeamAway;
    console.log(`Содержит ли команды? ${hasAnyTeamName ? 'Да' : 'Нет'}`);
    console.log(`Источник извлечения: ${result.source === 'body' ? 'document.body (fallback)' : 'крупнейший DOM-блок'}`);

    return this.cleanPreviewText(String(result.text ?? ''));
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

  /**
   * Поиск страницы превью и сбор единого блока для ИИ (SOURCE + METADATA + ARTICLE CONTENT).
   */
  async getMatchPreview(homeTeam: string, awayTeam: string): Promise<string> {
    if (!this.context) await this.init();

    const page: Page = await this.context!.newPage();

    try {
      page.setDefaultTimeout(60000);

      const searchQuery = encodeURIComponent(
        `${homeTeam} vs ${awayTeam} match preview -site:flashscore.com`,
      );
      const searchUrl = `https://duckduckgo.com/?q=${searchQuery}`;

      logger.info(`🌐 Поиск через DuckDuckGo: ${homeTeam} - ${awayTeam}`);

      await page.goto(searchUrl, { waitUntil: 'load', timeout: 45000 });
      await this.handleOverlays(page);

      const anchors = page.locator('a[data-testid="result-title-a"]');
      await anchors.first().waitFor({ state: 'visible', timeout: 20000 });
      const n = await anchors.count();
      const hrefs: string[] = [];
      for (let i = 0; i < n; i++) {
        const h = await anchors.nth(i).getAttribute('href');
        if (h) hrefs.push(h);
      }
      const allowed = hrefs.filter((h) => !isBlacklistedPreviewUrl(h, page.url()));
      const targetUrl = allowed[0];

      if (!targetUrl) {
        throw new Error(
          'Нет подходящих ссылок: все результаты отфильтрованы по blacklistDomains или URL некорректны',
        );
      }

      logger.info(`⏳ Переход на превью (первый результат вне blacklist): ${targetUrl}`);

      await page.goto(targetUrl, { waitUntil: 'load', timeout: 45000 }).catch(() => {
        logger.info('⚠️ load не достигнут, продолжаем...');
      });

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
    } catch (error: unknown) {
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
