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
