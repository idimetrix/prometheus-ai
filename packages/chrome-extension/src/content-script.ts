/**
 * Prometheus Chrome Extension - Content Script
 *
 * Injected into web pages to capture:
 * - Console errors and warnings
 * - Network request failures
 * - Page metadata and structure
 * - Performance metrics
 *
 * Sends captured data to the extension popup/background
 * for use as debugging context in Prometheus tasks.
 */

interface CapturedError {
  column?: number;
  line?: number;
  message: string;
  source?: string;
  timestamp: number;
  type: "error" | "warning" | "unhandled_rejection";
}

interface CapturedNetworkError {
  method: string;
  status: number;
  statusText: string;
  timestamp: number;
  url: string;
}

interface PageDiagnostics {
  /** Accessibility issues detected */
  a11yIssues: string[];
  /** Console errors captured since page load */
  consoleErrors: CapturedError[];
  /** Failed network requests */
  networkErrors: CapturedNetworkError[];
  /** Page metadata */
  page: {
    charset: string;
    description: string;
    doctype: string;
    title: string;
    url: string;
    viewport: string;
  };
  /** Performance metrics */
  performance: {
    domContentLoaded: number;
    domElements: number;
    firstContentfulPaint: number;
    loadTime: number;
    memoryUsedMB: number;
  };
}

// ---------------------------------------------------------------------------
//  Collectors
// ---------------------------------------------------------------------------

const consoleErrors: CapturedError[] = [];
const networkErrors: CapturedNetworkError[] = [];

const MAX_ERRORS = 50;

// Capture console errors
const originalError = console.error;
console.error = (...args: unknown[]) => {
  if (consoleErrors.length < MAX_ERRORS) {
    consoleErrors.push({
      type: "error",
      message: args.map(String).join(" "),
      timestamp: Date.now(),
    });
  }
  originalError.apply(console, args);
};

// Capture console warnings
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (consoleErrors.length < MAX_ERRORS) {
    consoleErrors.push({
      type: "warning",
      message: args.map(String).join(" "),
      timestamp: Date.now(),
    });
  }
  originalWarn.apply(console, args);
};

// Capture unhandled errors
window.addEventListener("error", (event) => {
  if (consoleErrors.length < MAX_ERRORS) {
    consoleErrors.push({
      type: "error",
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      timestamp: Date.now(),
    });
  }
});

// Capture unhandled promise rejections
window.addEventListener("unhandledrejection", (event) => {
  if (consoleErrors.length < MAX_ERRORS) {
    consoleErrors.push({
      type: "unhandled_rejection",
      message: String(event.reason),
      timestamp: Date.now(),
    });
  }
});

// Intercept fetch to capture network errors
const originalFetch = window.fetch;

function extractFetchUrl(args: Parameters<typeof fetch>): string {
  if (typeof args[0] === "string") {
    return args[0];
  }
  if (args[0] instanceof Request) {
    return args[0].url;
  }
  return String(args[0]);
}

function extractFetchMethod(args: Parameters<typeof fetch>): string {
  return (typeof args[1] === "object" ? args[1]?.method : undefined) ?? "GET";
}

function recordNetworkError(
  args: Parameters<typeof fetch>,
  status: number,
  statusText: string
) {
  if (networkErrors.length < MAX_ERRORS) {
    networkErrors.push({
      url: extractFetchUrl(args),
      method: extractFetchMethod(args),
      status,
      statusText,
      timestamp: Date.now(),
    });
  }
}

window.fetch = async (...args: Parameters<typeof fetch>) => {
  try {
    const response = await originalFetch(...args);
    if (!response.ok) {
      recordNetworkError(args, response.status, response.statusText);
    }
    return response;
  } catch (error) {
    const statusText = error instanceof Error ? error.message : "Network error";
    recordNetworkError(args, 0, statusText);
    throw error;
  }
};

// ---------------------------------------------------------------------------
//  Diagnostics collection
// ---------------------------------------------------------------------------

function collectDiagnostics(): PageDiagnostics {
  const meta = (name: string): string => {
    const el = document.querySelector(
      `meta[name="${name}"], meta[property="${name}"]`
    );
    return el?.getAttribute("content") ?? "";
  };

  // Performance metrics
  const perfEntries = performance.getEntriesByType(
    "navigation"
  ) as PerformanceNavigationTiming[];
  const navEntry = perfEntries[0];
  const paintEntries = performance.getEntriesByType("paint");
  const fcp = paintEntries.find((e) => e.name === "first-contentful-paint");

  // biome-ignore lint/suspicious/noExplicitAny: Performance memory API
  const perfMemory = (performance as any).memory;
  const memoryMB = perfMemory ? perfMemory.usedJSHeapSize / 1024 / 1024 : 0;

  // Basic a11y checks
  const a11yIssues: string[] = [];
  const imagesWithoutAlt = document.querySelectorAll("img:not([alt])");
  if (imagesWithoutAlt.length > 0) {
    a11yIssues.push(
      `${imagesWithoutAlt.length} image(s) missing alt attribute`
    );
  }
  const inputsWithoutLabel = document.querySelectorAll(
    "input:not([aria-label]):not([aria-labelledby])"
  );
  if (inputsWithoutLabel.length > 0) {
    a11yIssues.push(
      `${inputsWithoutLabel.length} input(s) missing accessible label`
    );
  }
  const buttonsWithoutText = document.querySelectorAll("button:empty");
  if (buttonsWithoutText.length > 0) {
    a11yIssues.push(`${buttonsWithoutText.length} button(s) with no text`);
  }

  return {
    page: {
      url: window.location.href,
      title: document.title,
      description: meta("description") || meta("og:description"),
      viewport: meta("viewport"),
      doctype: document.doctype?.name ?? "html",
      charset: document.characterSet,
    },
    consoleErrors: [...consoleErrors],
    networkErrors: [...networkErrors],
    performance: {
      loadTime: navEntry?.loadEventEnd ?? 0,
      domContentLoaded: navEntry?.domContentLoadedEventEnd ?? 0,
      firstContentfulPaint: fcp?.startTime ?? 0,
      domElements: document.querySelectorAll("*").length,
      memoryUsedMB: Math.round(memoryMB * 100) / 100,
    },
    a11yIssues,
  };
}

// ---------------------------------------------------------------------------
//  Message handler
// ---------------------------------------------------------------------------

// Listen for messages from the popup/background script
window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }
  if (event.data?.type === "PROMETHEUS_GET_DIAGNOSTICS") {
    const diagnostics = collectDiagnostics();
    window.postMessage({ type: "PROMETHEUS_DIAGNOSTICS", diagnostics }, "*");
  }
});

// Also support chrome.runtime messages if available
const chromeRuntime = (globalThis as Record<string, unknown>).chrome as
  | {
      runtime?: {
        onMessage?: {
          addListener: (
            cb: (
              msg: unknown,
              sender: unknown,
              sendResponse: (resp: unknown) => void
            ) => void
          ) => void;
        };
      };
    }
  | undefined;

if (chromeRuntime?.runtime?.onMessage) {
  chromeRuntime.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: unknown,
      sendResponse: (resp: unknown) => void
    ) => {
      const msg = message as { type?: string };
      if (msg?.type === "GET_DIAGNOSTICS") {
        sendResponse(collectDiagnostics());
      }
    }
  );
}
