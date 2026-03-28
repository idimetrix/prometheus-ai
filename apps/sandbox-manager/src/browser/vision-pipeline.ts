import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox:vision-pipeline");

const JSON_EXTRACT_RE = /\{[\s\S]*\}/;

/**
 * Result of vision model analysis on a screenshot.
 */
export interface VisionAnalysis {
  /** Detected color palette */
  colors: Array<{ hex: string; usage: string }>;
  /** Detected UI components (buttons, forms, navigation, etc.) */
  components: Array<{
    boundingBox?: { height: number; width: number; x: number; y: number };
    confidence: number;
    description: string;
    type: string;
  }>;
  /** Overall page description */
  description: string;
  /** Detected layout structure */
  layout: {
    columns: number;
    hasFooter: boolean;
    hasHeader: boolean;
    hasSidebar: boolean;
    type: "grid" | "flex" | "single-column" | "multi-column" | "dashboard";
  };
  /** Raw vision model response text */
  rawResponse: string;
  /** Detected typography */
  typography: Array<{ element: string; size: string; weight: string }>;
}

/**
 * Options for the vision analysis pipeline.
 */
interface VisionPipelineOptions {
  /** Whether to detect colors (default: true) */
  detectColors?: boolean;
  /** Whether to detect layout structure (default: true) */
  detectLayout?: boolean;
  /** Whether to detect typography (default: true) */
  detectTypography?: boolean;
  /** Maximum tokens for vision model response */
  maxTokens?: number;
}

const VISION_ANALYSIS_PROMPT = `Analyze this screenshot of a web page or UI component. Provide a structured analysis including:

1. **Description**: A brief description of what this page/component is (e.g., "A dashboard with sidebar navigation and data cards")
2. **Layout**: The overall layout structure (grid, flex, single-column, multi-column, dashboard). Note if it has header, sidebar, footer.
3. **Components**: List all visible UI components (buttons, forms, tables, cards, navigation, etc.) with their approximate position and description.
4. **Colors**: The main colors used, described as hex values with their usage (e.g., "#3B82F6 for primary buttons").
5. **Typography**: Font sizes and weights for headings, body text, and labels.

Respond in JSON format matching this schema:
{
  "description": "string",
  "layout": { "type": "string", "hasHeader": bool, "hasSidebar": bool, "hasFooter": bool, "columns": number },
  "components": [{ "type": "string", "description": "string", "confidence": number }],
  "colors": [{ "hex": "string", "usage": "string" }],
  "typography": [{ "element": "string", "size": "string", "weight": "string" }]
}`;

/**
 * VisionPipeline takes screenshots and sends them to a vision-capable model
 * for structured analysis. This bridges the gap between raw screenshots
 * and actionable information the code generation agent can use.
 */
export class VisionPipeline {
  private readonly modelRouterUrl: string;

  constructor(modelRouterUrl?: string) {
    this.modelRouterUrl = modelRouterUrl ?? "http://localhost:4004";
  }

  /**
   * Analyze a screenshot using a vision model.
   *
   * @param screenshotBase64 - Base64-encoded screenshot image
   * @param options - Analysis options
   * @returns Structured vision analysis
   */
  async analyze(
    screenshotBase64: string,
    options: VisionPipelineOptions = {}
  ): Promise<VisionAnalysis> {
    const { maxTokens = 2000 } = options;

    try {
      const response = await fetch(
        `${this.modelRouterUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "vision",
            messages: [
              {
                role: "user",
                content: [
                  { type: "text", text: VISION_ANALYSIS_PROMPT },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${screenshotBase64}`,
                    },
                  },
                ],
              },
            ],
            max_tokens: maxTokens,
            temperature: 0.1,
          }),
        }
      );

      if (!response.ok) {
        logger.warn(
          { status: response.status },
          "Vision model request failed, returning empty analysis"
        );
        return this.emptyAnalysis("Vision model unavailable");
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const rawResponse = data.choices[0]?.message?.content ?? "";

      return this.parseVisionResponse(rawResponse);
    } catch (error) {
      logger.error({ error }, "Vision pipeline analysis failed");
      return this.emptyAnalysis("Analysis failed");
    }
  }

  /**
   * Compare two screenshots and describe the visual differences.
   * Used for iterative refinement in image-to-code pipeline.
   */
  async compareScreenshots(
    originalBase64: string,
    generatedBase64: string
  ): Promise<{
    differences: string[];
    similarityScore: number;
    suggestion: string;
  }> {
    try {
      const response = await fetch(
        `${this.modelRouterUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "vision",
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Compare these two images. The first is the original design, the second is the generated implementation. List all visual differences and rate the similarity from 0 to 1. Respond in JSON: { "similarityScore": number, "differences": ["string"], "suggestion": "string" }`,
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${originalBase64}`,
                    },
                  },
                  {
                    type: "image_url",
                    image_url: {
                      url: `data:image/png;base64,${generatedBase64}`,
                    },
                  },
                ],
              },
            ],
            max_tokens: 1500,
            temperature: 0.1,
          }),
        }
      );

      if (!response.ok) {
        return {
          similarityScore: 0,
          differences: ["Could not compare — vision model unavailable"],
          suggestion: "Manual comparison needed",
        };
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const raw = data.choices[0]?.message?.content ?? "";

      try {
        const jsonMatch = raw.match(JSON_EXTRACT_RE);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      } catch {
        // fallthrough
      }

      return {
        similarityScore: 0.5,
        differences: [raw],
        suggestion: "Review differences manually",
      };
    } catch (error) {
      logger.error({ error }, "Screenshot comparison failed");
      return {
        similarityScore: 0,
        differences: ["Comparison failed"],
        suggestion: "Retry or compare manually",
      };
    }
  }

  private parseVisionResponse(raw: string): VisionAnalysis {
    try {
      const jsonMatch = raw.match(JSON_EXTRACT_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          description: parsed.description ?? "",
          layout: parsed.layout ?? {
            type: "single-column",
            hasHeader: false,
            hasSidebar: false,
            hasFooter: false,
            columns: 1,
          },
          components: parsed.components ?? [],
          colors: parsed.colors ?? [],
          typography: parsed.typography ?? [],
          rawResponse: raw,
        };
      }
    } catch {
      logger.warn("Failed to parse vision response as JSON");
    }

    return this.emptyAnalysis(raw);
  }

  private emptyAnalysis(rawResponse: string): VisionAnalysis {
    return {
      description: "",
      layout: {
        type: "single-column",
        hasHeader: false,
        hasSidebar: false,
        hasFooter: false,
        columns: 1,
      },
      components: [],
      colors: [],
      typography: [],
      rawResponse,
    };
  }
}
