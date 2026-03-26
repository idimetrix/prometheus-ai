import { createLogger } from "@prometheus/logger";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  buildUIGenerationPrompt,
  buildUIRefinementPrompt,
  UI_GENERATION_SYSTEM_PROMPT,
} from "../prompts/ui-generation";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("generate-router");

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

/**
 * Call the model-router directly for fast-path generation.
 * Bypasses the orchestrator queue for sub-15-second UI generation.
 */
async function callModelRouter(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${MODEL_ROUTER_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "fast",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 4096,
      temperature: 0.3,
      stream: false,
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    logger.error(
      { status: response.status, error: errorText },
      "Model router request failed"
    );
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to generate UI component",
    });
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Empty response from model",
    });
  }

  return stripCodeFences(content);
}

/**
 * Strip markdown code fences if the model wraps the output.
 */
function stripCodeFences(code: string): string {
  let result = code.trim();
  // Remove leading ```tsx or ```typescript or ```
  if (result.startsWith("```")) {
    const firstNewline = result.indexOf("\n");
    if (firstNewline !== -1) {
      result = result.slice(firstNewline + 1);
    }
  }
  // Remove trailing ```
  if (result.endsWith("```")) {
    result = result.slice(0, -3);
  }
  return result.trim();
}

export const generateRouter = router({
  /**
   * Fast-path UI generation. Calls the model-router directly
   * (no queue, no orchestrator) for sub-15-second generation.
   */
  ui: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        style: z
          .enum(["shadcn", "tailwind", "plain"])
          .optional()
          .default("shadcn"),
        framework: z.enum(["react", "nextjs"]).optional().default("react"),
      })
    )
    .mutation(async ({ input }) => {
      const startTime = performance.now();
      logger.info(
        { style: input.style, framework: input.framework },
        "Starting fast-path UI generation"
      );

      const userPrompt = buildUIGenerationPrompt(
        input.prompt,
        input.style,
        input.framework
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const code = await callModelRouter(
          UI_GENERATION_SYSTEM_PROMPT,
          userPrompt,
          controller.signal
        );

        const duration = Math.round(performance.now() - startTime);
        logger.info({ duration }, "UI generation complete");

        return {
          code,
          durationMs: duration,
          style: input.style,
          framework: input.framework,
        };
      } finally {
        clearTimeout(timeout);
      }
    }),

  /**
   * Image-to-code generation. Takes a base64 image (screenshot/mockup)
   * and generates a matching component.
   */
  fromImage: protectedProcedure
    .input(
      z.object({
        imageBase64: z.string().min(1),
        prompt: z
          .string()
          .min(1)
          .max(2000)
          .optional()
          .default("Convert this design into a component"),
        style: z
          .enum(["shadcn", "tailwind", "plain"])
          .optional()
          .default("shadcn"),
        framework: z.enum(["react", "nextjs"]).optional().default("react"),
      })
    )
    .mutation(async ({ input }) => {
      const startTime = performance.now();
      logger.info(
        { style: input.style, framework: input.framework },
        "Starting image-to-code generation"
      );

      const systemPrompt = `${UI_GENERATION_SYSTEM_PROMPT}\n\nYou are given an image of a UI design. Convert it into a production-ready component that visually matches the design as closely as possible.`;

      const userPrompt = buildUIGenerationPrompt(
        input.prompt,
        input.style,
        input.framework
      );

      const response = await fetch(`${MODEL_ROUTER_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "vision",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: userPrompt },
                {
                  type: "image_url",
                  image_url: { url: input.imageBase64 },
                },
              ],
            },
          ],
          max_tokens: 4096,
          temperature: 0.3,
          stream: false,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        logger.error(
          { status: response.status, error: errorText },
          "Image-to-code model request failed"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate component from image",
        });
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Empty response from vision model",
        });
      }

      const code = stripCodeFences(content);
      const duration = Math.round(performance.now() - startTime);
      logger.info({ duration }, "Image-to-code generation complete");

      return {
        code,
        durationMs: duration,
        style: input.style,
        framework: input.framework,
      };
    }),

  /**
   * Iterative refinement. Modifies existing code based on an instruction
   * without regenerating from scratch.
   */
  refine: protectedProcedure
    .input(
      z.object({
        currentCode: z.string().min(1).max(50_000),
        instruction: z.string().min(1).max(2000),
      })
    )
    .mutation(async ({ input }) => {
      const startTime = performance.now();
      logger.info("Starting UI refinement");

      const userPrompt = buildUIRefinementPrompt(
        input.currentCode,
        input.instruction
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      try {
        const code = await callModelRouter(
          UI_GENERATION_SYSTEM_PROMPT,
          userPrompt,
          controller.signal
        );

        const duration = Math.round(performance.now() - startTime);
        logger.info({ duration }, "UI refinement complete");

        return {
          code,
          durationMs: duration,
        };
      } finally {
        clearTimeout(timeout);
      }
    }),
});
