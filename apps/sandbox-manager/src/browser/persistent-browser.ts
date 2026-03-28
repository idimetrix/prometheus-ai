import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox:persistent-browser");

/**
 * Serialized cookie from Playwright
 */
interface BrowserCookie {
  domain: string;
  expires: number;
  httpOnly: boolean;
  name: string;
  path: string;
  sameSite: "Lax" | "None" | "Strict";
  secure: boolean;
  value: string;
}

interface ViewportSize {
  height: number;
  width: number;
}

interface AccessibilityNode {
  children?: AccessibilityNode[];
  name: string;
  role: string;
  value?: string;
}

/**
 * PersistentBrowser manages a long-lived Chromium instance per sandbox.
 *
 * Unlike ephemeral browser tool calls that spawn a new browser per interaction,
 * PersistentBrowser maintains state (cookies, auth, navigation history) across
 * multiple agent interactions within a session.
 */
export class PersistentBrowser {
  private browser: unknown = null;
  private context: unknown = null;
  private page: unknown = null;
  private readonly sandboxId: string;
  private readonly sessionId: string;
  private readonly viewport: ViewportSize = { width: 1280, height: 720 };
  private currentUrl = "";
  private isActive = false;

  constructor(sandboxId: string, sessionId: string, viewport?: ViewportSize) {
    this.sandboxId = sandboxId;
    this.sessionId = sessionId;
    if (viewport) {
      this.viewport = viewport;
    }
  }

  /**
   * Launch the browser with persistent context.
   * Optionally restore cookies from a previous session.
   */
  async launch(cookies?: BrowserCookie[]): Promise<void> {
    try {
      const { chromium } = await import("playwright");

      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      // biome-ignore lint/suspicious/noExplicitAny: Playwright dynamic import types
      const browserAny = this.browser as any;
      this.context = await browserAny.newContext({
        viewport: this.viewport,
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      });

      if (cookies && cookies.length > 0) {
        // biome-ignore lint/suspicious/noExplicitAny: Playwright dynamic import types
        await (this.context as any).addCookies(cookies);
        logger.info(
          { cookieCount: cookies.length, sandboxId: this.sandboxId },
          "Restored cookies for persistent browser"
        );
      }

      // biome-ignore lint/suspicious/noExplicitAny: Playwright dynamic import types
      const ctxAny = this.context as any;
      this.page = await ctxAny.newPage();
      this.isActive = true;

      logger.info(
        { sandboxId: this.sandboxId, sessionId: this.sessionId },
        "Persistent browser launched"
      );
    } catch (error) {
      logger.error(
        { error, sandboxId: this.sandboxId },
        "Failed to launch persistent browser"
      );
      throw error;
    }
  }

  /**
   * Navigate to a URL and wait for the page to load.
   */
  async navigate(url: string): Promise<{ title: string; url: string }> {
    const pg = this.getPage();

    await pg.goto(url, {
      timeout: 30_000,
      waitUntil: "domcontentloaded",
    });

    this.currentUrl = pg.url() as string;
    const title = (await pg.title()) as string;

    logger.info(
      { url: this.currentUrl, sandboxId: this.sandboxId },
      "Navigated"
    );
    return { url: this.currentUrl, title };
  }

  /**
   * Take a screenshot of the current page.
   */
  async screenshot(fullPage = false): Promise<Buffer> {
    const pg = this.getPage();
    return (await pg.screenshot({ fullPage })) as Buffer;
  }

  /**
   * Get the accessibility tree (structured DOM snapshot) for LLM consumption.
   * This is more stable and semantic than raw CSS selectors.
   */
  async getAccessibilityTree(): Promise<AccessibilityNode | null> {
    const pg = this.getPage();

    try {
      const snapshot = await pg.accessibility?.snapshot();
      return (snapshot as AccessibilityNode) ?? null;
    } catch {
      logger.warn("Accessibility snapshot not available, returning null");
      return null;
    }
  }

  /**
   * Click an element by selector.
   */
  async click(selector: string): Promise<void> {
    const pg = this.getPage();
    await pg.click(selector, { timeout: 10_000 });
  }

  /**
   * Fill a form field.
   */
  async fill(selector: string, value: string): Promise<void> {
    const pg = this.getPage();
    await pg.fill(selector, value, { timeout: 10_000 });
  }

  /**
   * Extract text content from the page.
   */
  async extractText(): Promise<string> {
    this.ensureActive();
    // biome-ignore lint/suspicious/noExplicitAny: Playwright page type
    const pg = this.page as any;
    return (await pg.evaluate("document.body.innerText")) as string;
  }

  /**
   * Get all cookies for session persistence.
   */
  async getCookies(): Promise<BrowserCookie[]> {
    if (!this.context) {
      return [];
    }
    // biome-ignore lint/suspicious/noExplicitAny: Playwright context type
    const ctx = this.context as any;
    return (await ctx.cookies()) as BrowserCookie[];
  }

  /**
   * Get current page URL.
   */
  getCurrentUrl(): string {
    if (!this.page) {
      return this.currentUrl;
    }
    // biome-ignore lint/suspicious/noExplicitAny: Playwright page type
    const pg = this.page as any;
    return pg.url() as string;
  }

  /**
   * Check if browser is active.
   */
  getIsActive(): boolean {
    return this.isActive;
  }

  /**
   * Close the browser and release resources.
   */
  async close(): Promise<BrowserCookie[]> {
    const cookies = await this.getCookies();

    try {
      if (this.page) {
        // biome-ignore lint/suspicious/noExplicitAny: Playwright page type
        await (this.page as any).close();
      }
      if (this.context) {
        // biome-ignore lint/suspicious/noExplicitAny: Playwright context type
        await (this.context as any).close();
      }
      if (this.browser) {
        // biome-ignore lint/suspicious/noExplicitAny: Playwright browser type
        await (this.browser as any).close();
      }
    } catch (error) {
      logger.warn({ error }, "Error closing persistent browser");
    }

    this.page = null;
    this.context = null;
    this.browser = null;
    this.isActive = false;

    logger.info(
      { sandboxId: this.sandboxId, sessionId: this.sessionId },
      "Persistent browser closed"
    );

    return cookies;
  }

  // biome-ignore lint/suspicious/noExplicitAny: Playwright dynamically imported — types unavailable
  private getPage(): any {
    if (!(this.isActive && this.page)) {
      throw new Error("Browser is not active. Call launch() first.");
    }
    return this.page;
  }

  private ensureActive(): void {
    if (!(this.isActive && this.page)) {
      throw new Error("Browser is not active. Call launch() first.");
    }
  }
}
