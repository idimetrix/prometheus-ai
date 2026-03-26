import { createLogger } from "@prometheus/logger";
import {
  generateId,
  modelRouterClient,
  sandboxManagerClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:url-to-component");

const CODE_BLOCK_RE = /```(?:tsx?|jsx?|vue|svelte)?\n([\s\S]*?)```/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SupportedFramework = "react" | "vue" | "svelte";
export type SupportedStyling = "tailwind" | "css-modules" | "styled-components";

export interface UrlToComponentOptions {
  framework?: SupportedFramework;
  includeInteractivity?: boolean;
  styling?: SupportedStyling;
}

export interface UrlConversionResult {
  code: string;
  originalScreenshot: string;
  preview: string;
}

interface ExtractedPageData {
  cssText: string;
  htmlStructure: string;
  screenshot: string;
  title: string;
}

// ---------------------------------------------------------------------------
// URL-to-Component Converter
// ---------------------------------------------------------------------------

/**
 * Converts a live URL into a framework component by:
 * 1. Navigating to the URL with Playwright in the sandbox
 * 2. Capturing a screenshot and extracting HTML/CSS structure
 * 3. Sending the visual + structural data to a vision-capable LLM
 * 4. Generating a matching component in the requested framework
 */
export class UrlToComponentConverter {
  private readonly defaultFramework: SupportedFramework = "react";
  private readonly defaultStyling: SupportedStyling = "tailwind";

  /**
   * Convert a URL into a generated component that visually matches it.
   */
  async convert(
    url: string,
    options?: UrlToComponentOptions
  ): Promise<UrlConversionResult> {
    const framework = options?.framework ?? this.defaultFramework;
    const styling = options?.styling ?? this.defaultStyling;
    const includeInteractivity = options?.includeInteractivity ?? true;

    logger.info(
      { url, framework, styling },
      "Starting URL-to-component conversion"
    );

    // Step 1: Extract page data via the sandbox Playwright browser
    const pageData = await this.extractPageData(url);

    // Step 2: Send to vision LLM for analysis and code generation
    const code = await this.generateComponentFromPageData(pageData, {
      framework,
      styling,
      includeInteractivity,
    });

    // Step 3: Optionally render the generated component and capture preview
    const preview = await this.captureComponentPreview(code);

    logger.info(
      { url, framework, codeLength: code.length },
      "URL-to-component conversion complete"
    );

    return {
      code,
      preview,
      originalScreenshot: pageData.screenshot,
    };
  }

  /**
   * Navigate to the URL in a sandboxed browser and extract page structure.
   */
  private async extractPageData(url: string): Promise<ExtractedPageData> {
    logger.info({ url }, "Extracting page data from URL");

    const sandboxId = `url-extract-${generateId()}`;

    try {
      // Launch browser via sandbox manager
      const browserResult = await sandboxManagerClient.post<{
        screenshot: string;
        html: string;
        css: string;
        title: string;
      }>("/browser/extract", {
        sandboxId,
        url,
        actions: [
          { type: "navigate", url },
          { type: "wait", ms: 2000 },
          { type: "screenshot", fullPage: true },
          { type: "extractHtml" },
          { type: "extractCss" },
        ],
      });

      return {
        screenshot: browserResult.data.screenshot,
        htmlStructure: browserResult.data.html,
        cssText: browserResult.data.css,
        title: browserResult.data.title,
      };
    } catch (error) {
      logger.error({ url, error }, "Failed to extract page data");

      // Return a minimal fallback so downstream can still attempt generation
      return {
        screenshot: "",
        htmlStructure: "<div>Failed to extract page</div>",
        cssText: "",
        title: "Unknown",
      };
    }
  }

  /**
   * Send extracted page data to a vision-capable LLM to generate component code.
   */
  private async generateComponentFromPageData(
    pageData: ExtractedPageData,
    options: {
      framework: SupportedFramework;
      includeInteractivity: boolean;
      styling: SupportedStyling;
    }
  ): Promise<string> {
    const { framework, styling, includeInteractivity } = options;

    logger.info(
      { framework, styling },
      "Generating component from page data via LLM"
    );

    const frameworkInstruction = this.getFrameworkInstruction(framework);
    const stylingInstruction = this.getStylingInstruction(styling);
    const interactivityInstruction = includeInteractivity
      ? "Include hover states, click handlers, and any interactive behavior visible on the page."
      : "Generate a static/presentational component only.";

    const prompt = `You are an expert UI developer. Convert the following webpage into a ${framework} component.

## Page Title
${pageData.title}

## HTML Structure
\`\`\`html
${pageData.htmlStructure.slice(0, 8000)}
\`\`\`

## CSS Styles
\`\`\`css
${pageData.cssText.slice(0, 4000)}
\`\`\`

## Requirements
${frameworkInstruction}
${stylingInstruction}
${interactivityInstruction}

- Match the visual layout, colors, typography, and spacing as closely as possible.
- Use semantic HTML elements.
- Make the component responsive.
- Export the component as a named export.
- Include TypeScript types for all props.
- Return ONLY the component code, no explanations.`;

    type ContentItem =
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } };

    const content: ContentItem[] = [{ type: "text", text: prompt }];

    // Attach the screenshot if available
    if (pageData.screenshot) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:image/png;base64,${pageData.screenshot}`,
        },
      });
    }

    const messages = [{ role: "user" as const, content }];

    const response = await modelRouterClient.post<{ text: string }>(
      "/chat/completions",
      {
        model: "vision",
        messages,
        maxTokens: 4096,
        temperature: 0.2,
      }
    );

    return this.extractCodeBlock(response.data.text);
  }

  /**
   * Render the generated component in a sandbox and capture a preview screenshot.
   */
  private async captureComponentPreview(code: string): Promise<string> {
    try {
      const previewResult = await sandboxManagerClient.post<{
        screenshot: string;
      }>("/preview/render", {
        code,
        format: "png",
      });

      return previewResult.data.screenshot;
    } catch (error) {
      logger.warn({ error }, "Failed to capture component preview");
      return "";
    }
  }

  /**
   * Extract the code block content from LLM response text.
   */
  private extractCodeBlock(text: string): string {
    const codeBlockMatch = text.match(CODE_BLOCK_RE);
    if (codeBlockMatch?.[1]) {
      return codeBlockMatch[1].trim();
    }
    return text.trim();
  }

  private getFrameworkInstruction(framework: SupportedFramework): string {
    switch (framework) {
      case "react":
        return 'Generate a React functional component with TypeScript. Use "use client" directive if needed.';
      case "vue":
        return 'Generate a Vue 3 SFC with <script setup lang="ts">, <template>, and <style> blocks.';
      case "svelte":
        return 'Generate a Svelte component with <script lang="ts">, markup, and <style> blocks.';
      default:
        return "Generate a React functional component with TypeScript.";
    }
  }

  private getStylingInstruction(styling: SupportedStyling): string {
    switch (styling) {
      case "tailwind":
        return "Use Tailwind CSS utility classes for all styling. Prefer shadcn/ui compatible classes.";
      case "css-modules":
        return "Use CSS Modules for styling. Define styles in a companion .module.css object.";
      case "styled-components":
        return "Use styled-components for styling. Define styled elements above the component.";
      default:
        return "Use Tailwind CSS utility classes for all styling.";
    }
  }
}
