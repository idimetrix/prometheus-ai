import { createLogger } from "@prometheus/logger";

const _logger = createLogger("sandbox:dom-snapshot");

interface AccessibilityNode {
  checked?: boolean;
  children?: AccessibilityNode[];
  description?: string;
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  level?: number;
  name: string;
  role: string;
  selected?: boolean;
  value?: string;
}

interface SimplifiedNode {
  children?: SimplifiedNode[];
  name: string;
  role: string;
  value?: string;
}

/**
 * Converts a Playwright accessibility snapshot into a compact text
 * representation suitable for LLM consumption.
 *
 * Uses the accessibility tree instead of raw HTML because:
 * 1. It's much smaller (typically 10-50x smaller than raw HTML)
 * 2. It's semantic (buttons, links, headings, forms are clearly labeled)
 * 3. It's stable across UI framework changes
 * 4. LLMs can reason about structure more easily
 */
export function accessibilityTreeToText(
  node: AccessibilityNode | null,
  indent = 0,
  maxDepth = 10
): string {
  if (!node || indent > maxDepth) {
    return "";
  }

  const prefix = "  ".repeat(indent);
  const parts: string[] = [];

  const role = node.role || "generic";
  const name = node.name ? ` "${node.name}"` : "";
  const value = node.value ? ` value="${node.value}"` : "";

  // Skip generic/uninteresting nodes to keep output compact
  const skipRoles = new Set([
    "generic",
    "none",
    "presentation",
    "InlineTextBox",
  ]);
  const shouldShow = !skipRoles.has(role) || node.name;

  if (shouldShow) {
    parts.push(`${prefix}[${role}]${name}${value}`);
  }

  if (node.children) {
    for (const child of node.children) {
      const childText = accessibilityTreeToText(
        child,
        shouldShow ? indent + 1 : indent,
        maxDepth
      );
      if (childText) {
        parts.push(childText);
      }
    }
  }

  return parts.join("\n");
}

/**
 * Simplify the accessibility tree by removing empty/generic nodes
 * and flattening single-child chains. Returns a JSON-serializable structure.
 */
export function simplifyAccessibilityTree(
  node: AccessibilityNode | null,
  maxDepth = 8
): SimplifiedNode | null {
  if (!node || maxDepth <= 0) {
    return null;
  }

  const skipRoles = new Set(["generic", "none", "presentation"]);
  const isInteresting = !skipRoles.has(node.role) || Boolean(node.name);

  const children: SimplifiedNode[] = [];
  if (node.children) {
    for (const child of node.children) {
      const simplified = simplifyAccessibilityTree(child, maxDepth - 1);
      if (simplified) {
        children.push(simplified);
      }
    }
  }

  // If this node is uninteresting and has exactly one child, flatten
  if (!isInteresting && children.length === 1) {
    return children[0] ?? null;
  }

  // If this node is uninteresting and has no children, skip
  if (!isInteresting && children.length === 0) {
    return null;
  }

  const result: SimplifiedNode = {
    role: node.role,
    name: node.name,
  };

  if (node.value) {
    result.value = node.value;
  }

  if (children.length > 0) {
    result.children = children;
  }

  return result;
}

/**
 * Extract interactive elements (buttons, links, inputs) from the
 * accessibility tree. These are the elements the agent can interact with.
 */
export function extractInteractiveElements(
  node: AccessibilityNode | null
): Array<{ name: string; role: string; value?: string }> {
  if (!node) {
    return [];
  }

  const interactiveRoles = new Set([
    "button",
    "link",
    "textbox",
    "checkbox",
    "radio",
    "combobox",
    "searchbox",
    "slider",
    "spinbutton",
    "switch",
    "tab",
    "menuitem",
  ]);

  const elements: Array<{ name: string; role: string; value?: string }> = [];

  if (interactiveRoles.has(node.role) && node.name) {
    elements.push({
      role: node.role,
      name: node.name,
      ...(node.value ? { value: node.value } : {}),
    });
  }

  if (node.children) {
    for (const child of node.children) {
      elements.push(...extractInteractiveElements(child));
    }
  }

  return elements;
}
