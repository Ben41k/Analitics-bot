import { chromium, BrowserContext, Page } from 'playwright';

export class FlashscoreProvider {
  private context: BrowserContext | null = null;

  async init() {
    this.context = await chromium.launchPersistentContext('user_data', {
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
      ],
      viewport: { width: 1280, height: 720 }
    });
  }

  async getMatchPreview(homeTeam: string, awayTeam: string): Promise<string> {
    if (!this.context) await this.init();
    
    const page: Page = await this.context!.newPage();
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

    try {
      // 1. Увеличиваем таймаут на всякий случай, но не ждем "полной" загрузки
      page.setDefaultTimeout(60000);

      const searchQuery = encodeURIComponent(`${homeTeam} vs ${awayTeam} flashscore preview`);
      const url = `https://duckduckgo.com/?q=${searchQuery}`;
      
      console.log(`🌐 Ищем: ${homeTeam} vs ${awayTeam}`);
      
      // 2. Ждем только загрузки DOM, а не всех картинок и рекламы
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await sleep(2000);
      
      const firstLink = await page.waitForSelector('a[data-testid="result-title-a"]');
      await firstLink.click();

      console.log('⏳ Загрузка Flashscore...');
      
      // 3. САМОЕ ВАЖНОЕ: Не ждем networkidle! Flashscore может грузить метрику вечно.
      // Ждем появления конкретного элемента с текстом.
      await page.waitForSelector('.previewContent, .description', { timeout: 15000 }).catch(() => {
        console.log('🐌 Страница грузится долго, пробуем читать что есть...');
      });

      const previewText = await page.evaluate(() => {
        // Список селекторов (от точных к общим)
        const selectors = [
          '.previewContent', 
          '.matchPreview', 
          '.description__text', 
          '[data-testid="wcl-scores-preview"]'
        ];
        
        for (const s of selectors) {
          const el = document.querySelector(s);
          if (el && el.textContent && el.textContent.trim().length > 50) {
            return el.textContent.trim();
          }
        }

        // Если селекторы мимо, ищем блок, в котором есть слово "Preview" или "Превью"
        const allDivs = Array.from(document.querySelectorAll('div'));
        const previewDiv = allDivs.find(d => 
          (d.innerText?.includes('Preview') || d.innerText?.includes('Превью')) && 
          d.innerText.length > 100
        );

        return previewDiv ? previewDiv.innerText.trim() : '';
      });

      await page.close();
      return previewText;
    } catch (error: any) {
      console.error(`❌ Ошибка: ${error.message}`);
      // Если вкладка зависла, пытаемся её закрыть, чтобы не плодить ошибки протокола
      if (!page.isClosed()) await page.close();
      return '';
    }
  }

  async close() {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }
  }
}