import { chromium, type Browser, type Page } from "playwright";
import { flashscorePageContentSchema } from "../../../schemas/flashscore.schema.js";
import type { AppConfig } from "../../../core/config.js";
import type { Logger } from "../../../core/logger.js";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export class FlashscoreProvider {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async fetchPageText(params: {
    url: string;
    jobId: string;
    signal?: AbortSignal;
  }): Promise<ReturnType<typeof flashscorePageContentSchema.parse>> {
    const log = this.logger.child({ jobId: params.jobId, provider: "FlashscoreProvider" });
    log.info({ url: params.url }, "Flashscore scrape started");

    let browser: Browser | undefined;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      });

      const context = await browser.newContext({
        userAgent: DEFAULT_UA,
        locale: "en-GB",
        viewport: { width: 1280, height: 800 },
      });

      const page = await context.newPage();
      page.setDefaultNavigationTimeout(this.config.SCRAPER_NAVIGATION_TIMEOUT_MS);
      page.setDefaultTimeout(this.config.SCRAPER_NAVIGATION_TIMEOUT_MS);

      await page.goto(params.url, { waitUntil: "domcontentloaded" });

      await this.dismissCookieBanners(page, log);

      const mainText = await page
        .locator("main")
        .first()
        .innerText({ timeout: 15_000 })
        .catch(async () => {
          return page
            .locator("#detail")
            .innerText({ timeout: 10_000 })
            .catch(() => "");
        });

      const text =
        mainText.trim().length > 0 ? mainText.trim() : (await page.innerText("body")).trim();

      const parsed = flashscorePageContentSchema.safeParse({
        text,
        sourceUrl: params.url,
      });

      if (!parsed.success) {
        log.warn(
          { issues: parsed.error.flatten() },
          "Flashscore page content failed Zod validation",
        );
        throw new Error("Flashscore page content failed Zod validation");
      }

      log.info({ chars: parsed.data.text.length }, "Flashscore scrape finished");
      return parsed.data;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  private async dismissCookieBanners(page: Page, log: Logger): Promise<void> {
    const candidates = [
      "#onetrust-accept-btn-handler",
      'button:has-text("Accept")',
      'button:has-text("I agree")',
      'button:has-text("AGREE")',
    ];

    for (const sel of candidates) {
      try {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
          await loc.click({ timeout: 2000 });
          await new Promise((r) => setTimeout(r, 500));
          log.info({ selector: sel }, "Dismissed cookie/consent banner");
          return;
        }
      } catch {
        // continue trying other selectors
      }
    }
  }
}
