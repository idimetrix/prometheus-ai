/**
 * Accessibility test suite for Prometheus web application.
 *
 * Implements axe-core-style checks as static HTML analysis utilities.
 * These tests validate common accessibility patterns without requiring
 * a browser environment.
 */
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Top-level regex constants
// ---------------------------------------------------------------------------

const INLINE_COLOR_STYLE_RE =
  /style="[^"]*color:\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\)|hsl\([^)]+\))[^"]*"/g;
const TEXT_COLOR_RE = /(?<![a-z-])color:/;
const BACKGROUND_COLOR_RE = /background(?:-color)?:/;
const BUTTON_ELEMENT_RE = /<button(?=[^>]*>)([^>]*)>([\s\S]*?)<\/button>/gi;
const ARIA_LABEL_RE = /aria-label(ledby)?=/;
const STRIP_TAGS_RE = /<[^>]+>/g;
const TITLE_ATTR_RE = /title=/;
const ROLE_ATTR_RE = /role="(\w+)"/g;
const HEADING_LEVEL_RE = /<h([1-6])\b/gi;
const INPUT_NEEDS_LABEL_RE =
  /<input(?=[^>]*type=["'](?!hidden|submit|button|reset|image))[^>]*>/gi;
const INPUT_ID_RE = /id=["']([^"']+)["']/;
const PLACEHOLDER_ATTR_RE = /placeholder=/;
const TABINDEX_RE = /tabindex=["'](\d+)["']/g;
const CLICKABLE_DIV_SPAN_RE = /<(div|span)\b[^>]*on[Cc]lick[^>]*>/gi;
const KEYBOARD_HANDLER_RE = /on[Kk]ey[Dd]own|on[Kk]ey[Uu]p|on[Kk]ey[Pp]ress/;
const ROLE_PRESENT_RE = /role=/;
const TABINDEX_PRESENT_RE = /tabindex=/;
const IMG_ELEMENT_RE = /<img\b[^>]*>/gi;
const ALT_ATTR_RE = /alt=/;
const PRESENTATION_ROLE_RE = /role=["']presentation["']|role=["']none["']/;
const BLANK_LINK_RE = /<a\b[^>]*target=["']_blank["'][^>]*>/gi;
const NOOPENER_RE = /rel=["'][^"']*noopener[^"']*["']/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccessibilityViolation {
  /** Human-readable description of the violation */
  description: string;
  /** Unique rule identifier */
  id: string;
  /** Impact level */
  impact: "critical" | "serious" | "moderate" | "minor";
  /** The HTML snippet causing the violation */
  snippet?: string;
}

// ---------------------------------------------------------------------------
// Accessibility checker
// ---------------------------------------------------------------------------

/**
 * Analyze an HTML string for common accessibility violations.
 * Returns an array of violations found.
 */
function checkAccessibility(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  violations.push(...checkColorContrast(html));
  violations.push(...checkAriaAttributes(html));
  violations.push(...checkHeadingHierarchy(html));
  violations.push(...checkFormLabels(html));
  violations.push(...checkFocusManagement(html));
  violations.push(...checkKeyboardNavigation(html));
  violations.push(...checkImageAlts(html));
  violations.push(...checkLinkTargets(html));

  return violations;
}

// ---------------------------------------------------------------------------
// Individual rule checks
// ---------------------------------------------------------------------------

/**
 * Check for potential color contrast issues.
 * Detects inline styles with light-on-light or dark-on-dark patterns.
 */
function checkColorContrast(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // Detect text elements with potentially low-contrast inline color styles
  INLINE_COLOR_STYLE_RE.lastIndex = 0;
  const matches = html.matchAll(INLINE_COLOR_STYLE_RE);

  for (const match of matches) {
    const styleValue = match[0];
    // Flag elements that set color but not background (or vice versa)
    const hasColor = TEXT_COLOR_RE.test(styleValue);
    const hasBgColor = BACKGROUND_COLOR_RE.test(styleValue);

    if (hasColor && !hasBgColor) {
      violations.push({
        id: "color-contrast-incomplete",
        description:
          "Element sets text color without background-color. Ensure sufficient contrast ratio (4.5:1 for normal text, 3:1 for large text).",
        impact: "serious",
        snippet: styleValue.slice(0, 100),
      });
    }
  }

  return violations;
}

/**
 * Check for proper ARIA attribute usage on interactive elements.
 */
function checkAriaAttributes(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // Buttons without accessible labels
  BUTTON_ELEMENT_RE.lastIndex = 0;
  for (const match of html.matchAll(BUTTON_ELEMENT_RE)) {
    const attrs = match[1] ?? "";
    const content = match[2] ?? "";

    const hasAriaLabel = ARIA_LABEL_RE.test(attrs);
    const hasTextContent = content.replace(STRIP_TAGS_RE, "").trim().length > 0;
    const hasTitle = TITLE_ATTR_RE.test(attrs);

    if (!(hasAriaLabel || hasTextContent || hasTitle)) {
      violations.push({
        id: "button-no-label",
        description:
          "Button element has no accessible label. Add text content, aria-label, or aria-labelledby.",
        impact: "critical",
        snippet: match[0].slice(0, 100),
      });
    }
  }

  // Elements with role but missing required ARIA attributes
  ROLE_ATTR_RE.lastIndex = 0;
  for (const match of html.matchAll(ROLE_ATTR_RE)) {
    const role = match[1];
    const surroundingContext = html.slice(
      Math.max(0, (match.index ?? 0) - 50),
      (match.index ?? 0) + 200
    );

    if (role === "tablist" && !surroundingContext.includes('role="tab"')) {
      violations.push({
        id: "aria-required-children",
        description:
          'Element with role="tablist" must contain elements with role="tab".',
        impact: "critical",
        snippet: surroundingContext.slice(0, 100),
      });
    }
  }

  return violations;
}

/**
 * Check heading hierarchy (h1 -> h2 -> h3, no skipping levels).
 */
function checkHeadingHierarchy(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  HEADING_LEVEL_RE.lastIndex = 0;
  let lastLevel = 0;
  let h1Count = 0;

  for (const match of html.matchAll(HEADING_LEVEL_RE)) {
    const level = Number.parseInt(match[1] ?? "0", 10);

    if (level === 1) {
      h1Count++;
    }

    // Check for skipped heading levels (e.g., h1 directly to h3)
    if (lastLevel > 0 && level > lastLevel + 1) {
      violations.push({
        id: "heading-order",
        description: `Heading level skipped: h${lastLevel} to h${level}. Headings should follow a sequential order (h1 -> h2 -> h3).`,
        impact: "moderate",
        snippet: match[0],
      });
    }

    lastLevel = level;
  }

  // Pages should have exactly one h1
  if (h1Count > 1) {
    violations.push({
      id: "multiple-h1",
      description: `Page has ${h1Count} h1 elements. There should be exactly one h1 per page.`,
      impact: "moderate",
    });
  }

  return violations;
}

/**
 * Check that form inputs have associated labels.
 */
function checkFormLabels(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // Inputs that need labels
  INPUT_NEEDS_LABEL_RE.lastIndex = 0;

  for (const match of html.matchAll(INPUT_NEEDS_LABEL_RE)) {
    const inputHtml = match[0];
    const hasAriaLabel = ARIA_LABEL_RE.test(inputHtml);
    const hasId = INPUT_ID_RE.exec(inputHtml);
    const hasTitle = TITLE_ATTR_RE.test(inputHtml);
    const hasPlaceholder = PLACEHOLDER_ATTR_RE.test(inputHtml);

    if (hasId) {
      const inputId = hasId[1];
      const labelPattern = new RegExp(`<label[^>]*for=["']${inputId}["']`);
      const hasAssociatedLabel = labelPattern.test(html);

      if (!(hasAssociatedLabel || hasAriaLabel || hasTitle)) {
        violations.push({
          id: "input-no-label",
          description: `Input with id="${inputId}" has no associated label. Add a <label for="${inputId}"> or aria-label attribute.`,
          impact: "critical",
          snippet: inputHtml.slice(0, 100),
        });
      }
    } else if (!(hasAriaLabel || hasTitle || hasPlaceholder)) {
      violations.push({
        id: "input-no-label",
        description:
          "Input element has no id, aria-label, or title. Screen readers cannot identify this field.",
        impact: "critical",
        snippet: inputHtml.slice(0, 100),
      });
    }
  }

  return violations;
}

/**
 * Check focus management patterns (tabindex usage, focus traps).
 */
function checkFocusManagement(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // Detect positive tabindex values (should generally be 0 or -1)
  TABINDEX_RE.lastIndex = 0;
  for (const match of html.matchAll(TABINDEX_RE)) {
    const value = Number.parseInt(match[1] ?? "0", 10);
    if (value > 0) {
      violations.push({
        id: "tabindex-positive",
        description: `Positive tabindex="${value}" detected. Use tabindex="0" to add to tab order or tabindex="-1" for programmatic focus only. Positive values disrupt natural tab order.`,
        impact: "serious",
        snippet: match[0],
      });
    }
  }

  return violations;
}

/**
 * Check for keyboard navigation support on interactive elements.
 */
function checkKeyboardNavigation(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  // Divs/spans with onClick but no keyboard handlers or role
  CLICKABLE_DIV_SPAN_RE.lastIndex = 0;

  for (const match of html.matchAll(CLICKABLE_DIV_SPAN_RE)) {
    const element = match[0];
    const hasKeyboardHandler = KEYBOARD_HANDLER_RE.test(element);
    const hasRole = ROLE_PRESENT_RE.test(element);
    const hasTabindex = TABINDEX_PRESENT_RE.test(element);

    if (!(hasKeyboardHandler && hasRole && hasTabindex)) {
      violations.push({
        id: "interactive-no-keyboard",
        description:
          "Non-interactive element has click handler but may lack keyboard support. Add role, tabindex, and onKeyDown handler.",
        impact: "serious",
        snippet: element.slice(0, 100),
      });
    }
  }

  return violations;
}

/**
 * Check images for alt text.
 */
function checkImageAlts(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  IMG_ELEMENT_RE.lastIndex = 0;
  for (const match of html.matchAll(IMG_ELEMENT_RE)) {
    const imgHtml = match[0];
    const hasAlt = ALT_ATTR_RE.test(imgHtml);
    const hasRole = PRESENTATION_ROLE_RE.test(imgHtml);

    if (!(hasAlt || hasRole)) {
      violations.push({
        id: "img-no-alt",
        description:
          'Image element is missing alt attribute. Add alt="" for decorative images or descriptive alt text.',
        impact: "critical",
        snippet: imgHtml.slice(0, 100),
      });
    }
  }

  return violations;
}

/**
 * Check links with target="_blank" for security and accessibility.
 */
function checkLinkTargets(html: string): AccessibilityViolation[] {
  const violations: AccessibilityViolation[] = [];

  BLANK_LINK_RE.lastIndex = 0;
  for (const match of html.matchAll(BLANK_LINK_RE)) {
    const linkHtml = match[0];
    const hasNoopener = NOOPENER_RE.test(linkHtml);

    if (!hasNoopener) {
      violations.push({
        id: "link-no-noopener",
        description:
          'Link with target="_blank" is missing rel="noopener". This is a security risk.',
        impact: "moderate",
        snippet: linkHtml.slice(0, 100),
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Accessibility Checker", () => {
  describe("checkAccessibility", () => {
    it("should return no violations for well-formed HTML", () => {
      const html = `
        <html>
          <body>
            <h1>Main Title</h1>
            <h2>Section</h2>
            <h3>Subsection</h3>
            <button>Click me</button>
            <label for="name">Name</label>
            <input type="text" id="name" />
            <img alt="A cat" src="/cat.png" />
            <a href="/about" target="_blank" rel="noopener">About</a>
          </body>
        </html>
      `;
      const violations = checkAccessibility(html);
      expect(violations).toHaveLength(0);
    });

    it("should detect missing alt text on images", () => {
      const html = '<img src="/photo.png" />';
      const violations = checkAccessibility(html);
      const imgViolation = violations.find((v) => v.id === "img-no-alt");
      expect(imgViolation).toBeDefined();
      expect(imgViolation?.impact).toBe("critical");
    });

    it("should allow decorative images with role=presentation", () => {
      const html = '<img src="/bg.png" role="presentation" />';
      const violations = checkAccessibility(html);
      const imgViolation = violations.find((v) => v.id === "img-no-alt");
      expect(imgViolation).toBeUndefined();
    });

    it("should detect buttons without accessible labels", () => {
      const html = "<button><svg></svg></button>";
      const violations = checkAccessibility(html);
      const btnViolation = violations.find((v) => v.id === "button-no-label");
      expect(btnViolation).toBeDefined();
      expect(btnViolation?.impact).toBe("critical");
    });

    it("should accept buttons with aria-label", () => {
      const html = '<button aria-label="Close"><svg></svg></button>';
      const violations = checkAccessibility(html);
      const btnViolation = violations.find((v) => v.id === "button-no-label");
      expect(btnViolation).toBeUndefined();
    });

    it("should detect skipped heading levels", () => {
      const html = "<h1>Title</h1><h3>Skipped h2</h3>";
      const violations = checkAccessibility(html);
      const headingViolation = violations.find((v) => v.id === "heading-order");
      expect(headingViolation).toBeDefined();
      expect(headingViolation?.impact).toBe("moderate");
    });

    it("should detect multiple h1 elements", () => {
      const html = "<h1>First</h1><h1>Second</h1>";
      const violations = checkAccessibility(html);
      const h1Violation = violations.find((v) => v.id === "multiple-h1");
      expect(h1Violation).toBeDefined();
    });

    it("should detect form inputs without labels", () => {
      const html = '<input type="text" id="email" />';
      const violations = checkAccessibility(html);
      const labelViolation = violations.find((v) => v.id === "input-no-label");
      expect(labelViolation).toBeDefined();
      expect(labelViolation?.impact).toBe("critical");
    });

    it("should accept inputs with associated labels", () => {
      const html =
        '<label for="email">Email</label><input type="text" id="email" />';
      const violations = checkAccessibility(html);
      const labelViolation = violations.find((v) => v.id === "input-no-label");
      expect(labelViolation).toBeUndefined();
    });

    it("should detect positive tabindex values", () => {
      const html = '<button tabindex="5">Bad</button>';
      const violations = checkAccessibility(html);
      const tabViolation = violations.find((v) => v.id === "tabindex-positive");
      expect(tabViolation).toBeDefined();
      expect(tabViolation?.impact).toBe("serious");
    });

    it("should detect links without rel=noopener", () => {
      const html = '<a href="/x" target="_blank">Link</a>';
      const violations = checkAccessibility(html);
      const linkViolation = violations.find((v) => v.id === "link-no-noopener");
      expect(linkViolation).toBeDefined();
    });

    it("should detect non-interactive elements with click handlers", () => {
      const html = '<div onClick="handleClick()">Clickable</div>';
      const violations = checkAccessibility(html);
      const kbViolation = violations.find(
        (v) => v.id === "interactive-no-keyboard"
      );
      expect(kbViolation).toBeDefined();
      expect(kbViolation?.impact).toBe("serious");
    });
  });
});
