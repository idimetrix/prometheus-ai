import { createLogger } from "@prometheus/logger";
import { PlaywrightRunner } from "../playwright-runner";

const logger = createLogger("sandbox:browser-use-engine");

export interface PageLink {
  href: string;
  text: string;
}

export interface PageForm {
  action: string;
  fields: Array<{ name: string; type: string }>;
  id: string;
}

export interface PageState {
  content: string;
  forms: PageForm[];
  links: PageLink[];
  screenshot?: { base64: string; height: number; width: number };
  title: string;
  url: string;
}

/**
 * Typed wrapper for Playwright page interactions.
 * We use unknown + type assertions instead of any.
 */
interface PlaywrightPage {
  click: (selector: string, opts?: { timeout: number }) => Promise<void>;
  close: () => Promise<void>;
  content: () => Promise<string>;
  evaluate: (fn: string) => Promise<unknown>;
  fill: (
    selector: string,
    value: string,
    opts?: { timeout: number }
  ) => Promise<void>;
  goto: (
    url: string,
    opts: { timeout: number; waitUntil: string }
  ) => Promise<void>;
  screenshot: (opts: { fullPage: boolean }) => Promise<Buffer>;
  setViewportSize: (size: { height: number; width: number }) => Promise<void>;
  title: () => Promise<string>;
  url: () => string;
}

interface PlaywrightBrowser {
  newPage: () => Promise<PlaywrightPage>;
}

const DEFAULT_TIMEOUT = 30_000;

/**
 * BrowserUseEngine wraps Playwright for LLM-driven browser automation.
 * Provides high-level methods for navigation, interaction, extraction,
 * and screenshot capture.
 */
export class BrowserUseEngine {
  private readonly runner: PlaywrightRunner;
  private browser: PlaywrightBrowser | null = null;
  private page: PlaywrightPage | null = null;

  constructor(runner?: PlaywrightRunner) {
    this.runner = runner ?? new PlaywrightRunner();
  }

  async initialize(): Promise<void> {
    await this.runner.initialize();
    // Access the internal browser to create a persistent page
    const browserRef = (this.runner as unknown as { browser: unknown }).browser;
    if (browserRef) {
      this.browser = browserRef as PlaywrightBrowser;
      this.page = await this.browser.newPage();
      await this.page.setViewportSize({ width: 1280, height: 720 });
      logger.info("BrowserUseEngine initialized with persistent page");
    }
  }

  /**
   * Navigate to a URL and return the page state.
   */
  async navigate(url: string): Promise<PageState> {
    const page = this.ensurePage();
    await page.goto(url, {
      timeout: DEFAULT_TIMEOUT,
      waitUntil: "networkidle",
    });
    logger.debug({ url }, "Navigated to URL");
    return this.getPageState();
  }

  /**
   * Click an element by CSS selector and return updated page state.
   */
  async click(selector: string): Promise<PageState> {
    const page = this.ensurePage();
    await page.click(selector, { timeout: DEFAULT_TIMEOUT });
    logger.debug({ selector }, "Clicked element");
    return this.getPageState();
  }

  /**
   * Fill a form field by CSS selector.
   */
  async fill(selector: string, value: string): Promise<PageState> {
    const page = this.ensurePage();
    await page.fill(selector, value, { timeout: DEFAULT_TIMEOUT });
    logger.debug({ selector }, "Filled form field");
    return this.getPageState();
  }

  /**
   * Extract text from the page based on a natural language instruction.
   * Uses page content and the instruction to locate relevant text.
   */
  async extract(instruction: string): Promise<string> {
    const page = this.ensurePage();
    const content = await page.content();

    // Extract visible text content from the page
    const textContent = (await page.evaluate(`
      (() => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null
        );
        const texts = [];
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent?.trim();
          if (text && text.length > 0) {
            texts.push(text);
          }
        }
        return texts.join('\\n');
      })()
    `)) as string;

    logger.debug(
      { instruction, contentLength: textContent.length },
      "Extracted page text"
    );

    // For now, return the full visible text content.
    // In a production system, this would be sent to an LLM to filter
    // based on the instruction.
    const _ = instruction;
    return typeof textContent === "string"
      ? textContent
      : String(content).slice(0, 10_000);
  }

  /**
   * Take a screenshot of the current page.
   */
  async screenshot(): Promise<{
    base64: string;
    height: number;
    width: number;
  }> {
    const page = this.ensurePage();
    const buffer = await page.screenshot({ fullPage: false });
    return {
      base64: buffer.toString("base64"),
      width: 1280,
      height: 720,
    };
  }

  /**
   * Get the current page state including URL, title, text content,
   * links, and forms.
   */
  async getPageState(): Promise<PageState> {
    const page = this.ensurePage();

    const url = page.url();
    const title = await page.title();

    // Extract visible text
    const content = (await page.evaluate(`
      (() => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null
        );
        const texts = [];
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent?.trim();
          if (text && text.length > 0) {
            texts.push(text);
          }
        }
        return texts.join('\\n').slice(0, 50000);
      })()
    `)) as string;

    // Extract links
    const rawLinks = (await page.evaluate(`
      (() => {
        return Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({
          href: a.href,
          text: (a.textContent || '').trim().slice(0, 100)
        }));
      })()
    `)) as unknown;
    const links = Array.isArray(rawLinks) ? (rawLinks as PageLink[]) : [];

    // Extract forms
    const rawForms = (await page.evaluate(`
      (() => {
        return Array.from(document.querySelectorAll('form')).slice(0, 10).map((form, i) => ({
          id: form.id || 'form-' + i,
          action: form.action || '',
          fields: Array.from(form.querySelectorAll('input, select, textarea')).slice(0, 20).map(el => ({
            name: el.name || el.id || '',
            type: el.type || el.tagName.toLowerCase()
          }))
        }));
      })()
    `)) as unknown;
    const forms = Array.isArray(rawForms) ? (rawForms as PageForm[]) : [];

    return { url, title, content: String(content), links, forms };
  }

  async shutdown(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
    await this.runner.shutdown();
    this.browser = null;
    logger.info("BrowserUseEngine shut down");
  }

  private ensurePage(): PlaywrightPage {
    if (!this.page) {
      throw new Error(
        "BrowserUseEngine not initialized. Call initialize() first."
      );
    }
    return this.page;
  }
}
