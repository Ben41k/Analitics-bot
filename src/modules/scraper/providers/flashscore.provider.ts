import { chromium, BrowserContext, Page } from 'playwright';
import { logger } from '../../../core/logger';

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
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-setuid-sandbox'
      ],
      viewport: { width: 1280, height: 720 }
    });
  }

  /**
   * Закрытие всплывающих окон, куки-баннеров и прочего мусора.
   */
  private async handleOverlays(page: Page) {
    const selectors = [
      '#onetrust-accept-btn-handler', 
      '#onetrust-banner-sdk', 
      'button:has-text("Accept")',
      'button:has-text("Принять")',
      '.wizard__closeButton'
    ];

    for (const selector of selectors) {
      try {
        const btn = await page.waitForSelector(selector, { timeout: 3000, state: 'visible' });
        if (btn) {
          await btn.click();
          logger.info(`🧹 Баннер [${selector}] закрыт`);
          await page.waitForTimeout(1000); 
        }
      } catch (e) {
        // Пропускаем, если баннер не появился
      }
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
      
      // Находим ссылку и извлекаем URL (fix TS error 2345)
      const linkElement = await page.waitForSelector('a[data-testid="result-title-a"]');
      const targetUrl = await linkElement.evaluate((el) => (el as HTMLAnchorElement).href);

      if (!targetUrl) throw new Error('URL не найден в результатах поиска');

      logger.info(`⏳ Переход на Flashscore: ${targetUrl}`);
      
      // Используем networkidle для гарантии подгрузки тяжелых скриптов
      await page.goto(targetUrl, { 
        waitUntil: 'networkidle', 
        timeout: 45000 
      }).catch(() => logger.info('⚠️ Networkidle не достигнут, продолжаем по таймауту...'));

      // "Терпеливая" пауза для рендера динамики
      await sleep(3000); 

      // Очистка оверлеев перед чтением
      await this.handleOverlays(page);

      // Ждем появления контента
      logger.info('🔍 Ожидание блоков текста...');
      await page.waitForSelector('.previewContent, .description, .description__text', { 
        timeout: 20000,
        state: 'attached'
      }).catch(() => logger.info('🐌 Контент грузится долго, пробуем извлечь всё, что есть...'));

      const previewText = await page.evaluate(() => {
        // Силовое удаление блокировщиков на уровне DOM
        const blockers = ['#onetrust-consent-sdk', '.ot-sdk-container', '.ot-sdk-backdrop'];
        blockers.forEach(id => document.querySelector(id)?.remove());

        const selectors = [
          '.previewContent', 
          '.matchPreview', 
          '.description__text', 
          '[data-testid="wcl-scores-preview"]'
        ];
        
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el && el.textContent && el.textContent.trim().length > 100) {
            return el.textContent.trim();
          }
        }

        // Фоллбек: поиск по ключевым словам
        const allDivs = Array.from(document.querySelectorAll('div'));
        const previewDiv = allDivs.find(d => 
          (d.innerText?.toLowerCase().includes('preview') || d.innerText?.toLowerCase().includes('превью')) && 
          d.innerText.length > 150
        );

        return previewDiv ? previewDiv.innerText.trim() : '';
      });

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