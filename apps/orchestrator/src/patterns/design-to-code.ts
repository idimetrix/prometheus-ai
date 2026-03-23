import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:design-to-code");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedFramework = "react" | "vue" | "svelte";

export interface ComponentSpec {
  children: ComponentSpec[];
  name: string;
  props: Record<string, string>;
  styles: Record<string, string>;
  type: "layout" | "text" | "image" | "input" | "button" | "container";
}

export interface DesignToken {
  borderRadius: Record<string, string>;
  colors: Record<string, string>;
  fontSizes: Record<string, string>;
  shadows: Record<string, string>;
  spacing: Record<string, string>;
}

export interface GeneratedComponent {
  code: string;
  componentName: string;
  fileName: string;
  framework: SupportedFramework;
}

export interface VisualMatchResult {
  confidence: number;
  discrepancies: string[];
  passed: boolean;
}

// ---------------------------------------------------------------------------
// DesignToCodePipeline
// ---------------------------------------------------------------------------

/**
 * Converts design specifications (Figma JSON, design tokens, component specs)
 * into framework-specific component code (React/Vue/Svelte).
 */
export class DesignToCodePipeline {
  /**
   * Parse a design specification string into a tree of component specs.
   */
  extractComponents(designSpec: string): ComponentSpec[] {
    logger.info("Extracting components from design spec");

    try {
      const parsed: unknown = JSON.parse(designSpec);
      if (!Array.isArray(parsed)) {
        return [this.parseNode(parsed as Record<string, unknown>)];
      }
      return (parsed as Record<string, unknown>[]).map((node) =>
        this.parseNode(node)
      );
    } catch {
      logger.warn("Failed to parse design spec as JSON, using fallback");
      return [
        {
          name: "Root",
          type: "container",
          props: {},
          styles: {},
          children: [],
        },
      ];
    }
  }

  /**
   * Generate framework-specific component code from a component spec.
   */
  generateComponent(
    componentSpec: ComponentSpec,
    framework: SupportedFramework
  ): GeneratedComponent {
    logger.info(`Generating ${framework} component: ${componentSpec.name}`);

    switch (framework) {
      case "react":
        return this.generateReactComponent(componentSpec);
      case "vue":
        return this.generateVueComponent(componentSpec);
      default:
        return this.generateSvelteComponent(componentSpec);
    }
  }

  /**
   * Check whether generated code visually matches the original design spec.
   * Uses a scoring heuristic based on structural similarity.
   */
  validateVisualMatch(
    generatedCode: string,
    designSpec: string
  ): VisualMatchResult {
    logger.info("Validating visual match");

    const components = this.extractComponents(designSpec);
    const discrepancies: string[] = [];

    // Check that all components are referenced in the generated code
    for (const comp of components) {
      if (!generatedCode.includes(comp.name)) {
        discrepancies.push(`Missing component: ${comp.name}`);
      }
    }

    // Check that style tokens appear in the output
    for (const comp of components) {
      for (const [key, value] of Object.entries(comp.styles)) {
        if (!generatedCode.includes(value)) {
          discrepancies.push(
            `Missing style value for ${comp.name}.${key}: ${value}`
          );
        }
      }
    }

    const totalChecks = components.length * 2;
    const confidence =
      totalChecks > 0 ? Math.max(0, 1 - discrepancies.length / totalChecks) : 1;

    return {
      passed: confidence >= 0.8,
      confidence,
      discrepancies,
    };
  }

  /**
   * Generate a Tailwind CSS or plain CSS stylesheet from design tokens.
   */
  generateStylesheet(designTokens: DesignToken): string {
    logger.info("Generating stylesheet from design tokens");

    const lines: string[] = [":root {"];

    for (const [name, value] of Object.entries(designTokens.colors)) {
      lines.push(`  --color-${name}: ${value};`);
    }
    for (const [name, value] of Object.entries(designTokens.spacing)) {
      lines.push(`  --spacing-${name}: ${value};`);
    }
    for (const [name, value] of Object.entries(designTokens.fontSizes)) {
      lines.push(`  --font-size-${name}: ${value};`);
    }
    for (const [name, value] of Object.entries(designTokens.borderRadius)) {
      lines.push(`  --radius-${name}: ${value};`);
    }
    for (const [name, value] of Object.entries(designTokens.shadows)) {
      lines.push(`  --shadow-${name}: ${value};`);
    }

    lines.push("}");
    return lines.join("\n");
  }

  // ---- Figma-specific utilities ----

  /**
   * Extract design tokens (colors, fonts, spacing) from a Figma node JSON
   * representation. Useful for the design-to-code agent to gather
   * visual properties before generating component code.
   */
  extractDesignTokens(figmaNode: Record<string, unknown>): DesignToken {
    logger.info("Extracting design tokens from Figma node");

    const colors: Record<string, string> = {};
    const fontSizes: Record<string, string> = {};
    const spacing: Record<string, string> = {};
    const borderRadius: Record<string, string> = {};
    const shadows: Record<string, string> = {};

    // Walk the Figma node tree and collect style properties
    const walk = (node: Record<string, unknown>, depth = 0): void => {
      const name = (node.name as string) ?? `token-${depth}`;
      const safeName = name.replaceAll(/[^a-zA-Z0-9-]/g, "-").toLowerCase();

      // Colors from fills
      const fills = node.fills as Record<string, unknown>[] | undefined;
      if (Array.isArray(fills)) {
        for (const fill of fills) {
          if (fill.type === "SOLID" && fill.color) {
            const c = fill.color as Record<string, number>;
            const hex = `#${Math.round((c.r ?? 0) * 255)
              .toString(16)
              .padStart(2, "0")}${Math.round((c.g ?? 0) * 255)
              .toString(16)
              .padStart(2, "0")}${Math.round((c.b ?? 0) * 255)
              .toString(16)
              .padStart(2, "0")}`;
            colors[safeName] = hex;
          }
        }
      }

      // Font size from style
      const style = node.style as Record<string, unknown> | undefined;
      if (style?.fontSize) {
        fontSizes[safeName] = `${style.fontSize}px`;
      }

      // Spacing from padding
      const padding = node.paddingLeft ?? node.paddingTop;
      if (typeof padding === "number" && padding > 0) {
        spacing[safeName] = `${padding}px`;
      }

      // Border radius
      const radius = node.cornerRadius;
      if (typeof radius === "number" && radius > 0) {
        borderRadius[safeName] = `${radius}px`;
      }

      // Shadows from effects
      const effects = node.effects as Record<string, unknown>[] | undefined;
      if (Array.isArray(effects)) {
        for (const effect of effects) {
          if (effect.type === "DROP_SHADOW") {
            const offset = effect.offset as Record<string, number> | undefined;
            const r = effect.radius ?? 0;
            shadows[safeName] =
              `${offset?.x ?? 0}px ${offset?.y ?? 0}px ${r}px rgba(0,0,0,0.15)`;
          }
        }
      }

      // Recurse into children
      const children = node.children as Record<string, unknown>[] | undefined;
      if (Array.isArray(children)) {
        for (const child of children) {
          walk(child, depth + 1);
        }
      }
    };

    walk(figmaNode);

    return { colors, fontSizes, spacing, borderRadius, shadows };
  }

  /**
   * Convert a set of design tokens into Tailwind CSS utility classes.
   * Returns a mapping of token name to Tailwind class string.
   */
  mapToTailwindClasses(tokens: DesignToken): Record<string, string> {
    logger.info("Mapping design tokens to Tailwind classes");

    const classes: Record<string, string> = {};

    // Map font sizes to Tailwind text-* classes
    const fontSizeMap: Record<string, string> = {
      "12px": "text-xs",
      "14px": "text-sm",
      "16px": "text-base",
      "18px": "text-lg",
      "20px": "text-xl",
      "24px": "text-2xl",
      "30px": "text-3xl",
      "36px": "text-4xl",
    };

    for (const [name, size] of Object.entries(tokens.fontSizes)) {
      classes[`font-${name}`] = fontSizeMap[size] ?? `text-[${size}]`;
    }

    // Map spacing to Tailwind p-* classes
    const spacingMap: Record<string, string> = {
      "4px": "p-1",
      "8px": "p-2",
      "12px": "p-3",
      "16px": "p-4",
      "20px": "p-5",
      "24px": "p-6",
      "32px": "p-8",
    };

    for (const [name, value] of Object.entries(tokens.spacing)) {
      classes[`spacing-${name}`] = spacingMap[value] ?? `p-[${value}]`;
    }

    // Map border radius to Tailwind rounded-* classes
    const radiusMap: Record<string, string> = {
      "2px": "rounded-sm",
      "4px": "rounded",
      "6px": "rounded-md",
      "8px": "rounded-lg",
      "12px": "rounded-xl",
      "16px": "rounded-2xl",
      "9999px": "rounded-full",
    };

    for (const [name, value] of Object.entries(tokens.borderRadius)) {
      classes[`radius-${name}`] = radiusMap[value] ?? `rounded-[${value}]`;
    }

    // Map colors to Tailwind bg-* / text-* arbitrary values
    for (const [name, hex] of Object.entries(tokens.colors)) {
      classes[`bg-${name}`] = `bg-[${hex}]`;
      classes[`text-${name}`] = `text-[${hex}]`;
    }

    // Map shadows
    for (const [name, value] of Object.entries(tokens.shadows)) {
      classes[`shadow-${name}`] = `shadow-[${value.replaceAll(" ", "_")}]`;
    }

    return classes;
  }

  /**
   * Generate a React component skeleton from a Figma node and extracted tokens.
   * Produces a "use client" component with Tailwind classes applied.
   */
  generateReactComponentFromFigma(
    figmaNode: Record<string, unknown>,
    tokens: DesignToken
  ): GeneratedComponent {
    const nodeName = (figmaNode.name as string) ?? "FigmaComponent";
    const componentName = nodeName.replaceAll(/[^a-zA-Z0-9]/g, "");
    const tailwindMap = this.mapToTailwindClasses(tokens);

    logger.info(`Generating React component from Figma node: ${componentName}`);

    // Collect relevant Tailwind classes for the root element
    const rootClasses: string[] = [];
    for (const [key, tw] of Object.entries(tailwindMap)) {
      if (
        key.startsWith("spacing-") ||
        key.startsWith("radius-") ||
        key.startsWith("bg-")
      ) {
        rootClasses.push(tw);
      }
    }

    // Build child JSX from Figma children
    const children = figmaNode.children as
      | Record<string, unknown>[]
      | undefined;
    let childrenJsx = "      {/* Content */}";
    if (Array.isArray(children) && children.length > 0) {
      childrenJsx = children
        .map((child) => {
          const childName = ((child.name as string) ?? "Child").replaceAll(
            /[^a-zA-Z0-9]/g,
            ""
          );
          const childType = child.type as string | undefined;
          if (childType === "TEXT") {
            const characters = (child.characters as string) ?? "";
            return `      <p>${characters}</p>`;
          }
          return `      <${childName} />`;
        })
        .join("\n");
    }

    const code = `"use client";

import type { FC } from "react";

interface ${componentName}Props {
  className?: string;
}

export const ${componentName}: FC<${componentName}Props> = ({ className }) => {
  return (
    <div className={\`${rootClasses.join(" ")} \${className ?? ""}\`}>
${childrenJsx}
    </div>
  );
};
`;

    return {
      componentName,
      fileName: `${componentName}.tsx`,
      framework: "react",
      code,
    };
  }

  // ---- Private helpers ----

  private parseNode(node: Record<string, unknown>): ComponentSpec {
    const children = Array.isArray(node.children)
      ? (node.children as Record<string, unknown>[]).map((c) =>
          this.parseNode(c)
        )
      : [];

    return {
      name: (node.name as string) ?? "Unknown",
      type: (node.type as ComponentSpec["type"]) ?? "container",
      props: (node.props as Record<string, string>) ?? {},
      styles: (node.styles as Record<string, string>) ?? {},
      children,
    };
  }

  private generateReactComponent(spec: ComponentSpec): GeneratedComponent {
    const name = spec.name.replaceAll(/\s+/g, "");
    const childrenJsx = spec.children
      .map((c) => `      <${c.name.replaceAll(/\s+/g, "")} />`)
      .join("\n");

    const code = `"use client";

import type { FC } from "react";

interface ${name}Props {
  className?: string;
}

export const ${name}: FC<${name}Props> = ({ className }) => {
  return (
    <div className={className}>
${childrenJsx || "      {/* Content */}"}
    </div>
  );
};
`;

    return {
      componentName: name,
      fileName: `${name}.tsx`,
      framework: "react",
      code,
    };
  }

  private generateVueComponent(spec: ComponentSpec): GeneratedComponent {
    const name = spec.name.replaceAll(/\s+/g, "");
    const childrenTemplate = spec.children
      .map((c) => `    <${c.name.replaceAll(/\s+/g, "")} />`)
      .join("\n");

    const code = `<template>
  <div :class="className">
${childrenTemplate || "    <!-- Content -->"}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  className?: string;
}>();
</script>
`;

    return {
      componentName: name,
      fileName: `${name}.vue`,
      framework: "vue",
      code,
    };
  }

  private generateSvelteComponent(spec: ComponentSpec): GeneratedComponent {
    const name = spec.name.replaceAll(/\s+/g, "");
    const childrenTemplate = spec.children
      .map((c) => `  <${c.name.replaceAll(/\s+/g, "")} />`)
      .join("\n");

    const code = `<script lang="ts">
  export let className: string = "";
</script>

<div class={className}>
${childrenTemplate || "  <!-- Content -->"}
</div>
`;

    return {
      componentName: name,
      fileName: `${name}.svelte`,
      framework: "svelte",
      code,
    };
  }
}
