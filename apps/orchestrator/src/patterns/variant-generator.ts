import { createLogger } from "@prometheus/logger";
import { generateId, modelRouterClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:variant-generator");

const CODE_BLOCK_RE = /```(?:tsx?|jsx?|vue|svelte)?\n([\s\S]*?)```/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DesignStyle =
  | "minimal"
  | "bold"
  | "playful"
  | "corporate"
  | "modern";

export interface VariantGeneratorOptions {
  count?: number;
  framework?: string;
  styles?: DesignStyle[];
}

export interface DesignVariant {
  code: string;
  id: string;
  preview?: string;
  style: string;
}

// ---------------------------------------------------------------------------
// Style Descriptions
// ---------------------------------------------------------------------------

const STYLE_DESCRIPTIONS: Record<DesignStyle, string> = {
  minimal:
    "Clean, minimalistic design with ample whitespace, subtle borders, muted colors, and simple typography. Focus on clarity and restraint.",
  bold: "Strong visual impact with large typography, vibrant colors, bold contrasts, and striking visual hierarchy. Use heavy font weights and saturated hues.",
  playful:
    "Fun and approachable with rounded corners, warm colors, playful animations, emoji-friendly, and casual typography. Use gradients and soft shadows.",
  corporate:
    "Professional and trustworthy with a structured layout, neutral color palette (blues, grays), formal typography, and clear data presentation.",
  modern:
    "Contemporary aesthetic with glass-morphism effects, subtle gradients, modern sans-serif fonts, dark mode friendly, and smooth micro-interactions.",
};

const DEFAULT_STYLES: DesignStyle[] = ["minimal", "bold", "modern"];

// ---------------------------------------------------------------------------
// Design Variant Generator
// ---------------------------------------------------------------------------

/**
 * Generates multiple visual variants of the same component description.
 * Uses parallel LLM calls with different style parameters so the user
 * can pick the design direction they prefer.
 */
export class DesignVariantGenerator {
  /**
   * Generate multiple design variants for a given prompt.
   */
  async generateVariants(
    prompt: string,
    options?: VariantGeneratorOptions
  ): Promise<DesignVariant[]> {
    const count = options?.count ?? 3;
    const framework = options?.framework ?? "react";
    const styles = options?.styles ?? DEFAULT_STYLES.slice(0, count);

    // Pad or trim styles to match count
    const effectiveStyles = this.resolveStyles(styles, count);

    logger.info(
      {
        prompt: prompt.slice(0, 100),
        count: effectiveStyles.length,
        framework,
        styles: effectiveStyles,
      },
      "Generating design variants"
    );

    // Fire all LLM calls in parallel
    const variantPromises = effectiveStyles.map((style) =>
      this.generateSingleVariant(prompt, style, framework)
    );

    const results = await Promise.allSettled(variantPromises);

    const variants: DesignVariant[] = [];
    for (const [index, result] of results.entries()) {
      const style = effectiveStyles[index] ?? "modern";
      if (result.status === "fulfilled") {
        variants.push(result.value);
      } else {
        logger.warn(
          { style, error: result.reason },
          "Variant generation failed"
        );
        // Push a placeholder so the caller knows which style failed
        variants.push({
          id: generateId(),
          style,
          code: `// Generation failed for "${style}" style. Please retry.`,
        });
      }
    }

    logger.info(
      {
        total: variants.length,
        succeeded: variants.filter((v) => !v.code.startsWith("// Generation"))
          .length,
      },
      "Variant generation complete"
    );

    return variants;
  }

  /**
   * Generate a single variant for a given style.
   */
  private async generateSingleVariant(
    prompt: string,
    style: DesignStyle,
    framework: string
  ): Promise<DesignVariant> {
    const id = generateId();
    const styleDescription = STYLE_DESCRIPTIONS[style];

    logger.debug({ id, style, framework }, "Generating variant");

    const systemPrompt = `You are an expert UI developer specializing in ${style} design.
Generate a ${framework} component based on the user's description.

## Design Style: ${style}
${styleDescription}

## Rules
- Use TypeScript with explicit prop types.
- Use Tailwind CSS utility classes.
- Export the component as a named export.
- Add "use client" directive for React components with interactivity.
- Make the component responsive and accessible.
- Apply the "${style}" design style consistently throughout.
- Return ONLY the component code inside a single code block.`;

    const response = await modelRouterClient.post<{ text: string }>(
      "/chat/completions",
      {
        model: "fast",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        maxTokens: 4096,
        temperature: 0.7, // Higher temperature for more diverse variants
      }
    );

    const code = this.extractCodeBlock(response.data.text);

    return { id, style, code };
  }

  /**
   * Resolve the list of styles to use, padding with defaults if needed.
   */
  private resolveStyles(
    requested: DesignStyle[],
    count: number
  ): DesignStyle[] {
    if (requested.length >= count) {
      return requested.slice(0, count);
    }

    const allStyles: DesignStyle[] = [
      "minimal",
      "bold",
      "playful",
      "corporate",
      "modern",
    ];
    const result = [...requested];
    for (const s of allStyles) {
      if (result.length >= count) {
        break;
      }
      if (!result.includes(s)) {
        result.push(s);
      }
    }
    return result.slice(0, count);
  }

  /**
   * Extract code block content from LLM response.
   */
  private extractCodeBlock(text: string): string {
    const match = text.match(CODE_BLOCK_RE);
    if (match?.[1]) {
      return match[1].trim();
    }
    return text.trim();
  }
}
