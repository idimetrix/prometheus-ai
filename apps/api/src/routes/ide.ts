/**
 * IDE-specific endpoints for inline completions and code editing.
 *
 * These endpoints are optimized for low latency and route requests to fast
 * models (GPT-4o-mini, Claude Haiku, or Groq Llama) via the model-router.
 *
 * POST /api/completions — inline tab completion
 * POST /api/edit — Cmd+K inline editing
 * POST /api/explain — code explanation
 */

import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";

const logger = createLogger("api:ide");

const CODE_FENCE_START_RE = /^```[\w]*\n?/;
const CODE_FENCE_END_RE = /\n?```$/;

const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompletionRequest {
  filePath: string;
  language: string;
  openFiles?: string[];
  prefix: string;
  suffix: string;
}

interface EditRequest {
  code: string;
  context?: string;
  filePath: string;
  instruction: string;
  language: string;
}

interface ExplainRequest {
  code: string;
  filePath: string;
  language: string;
}

// ---------------------------------------------------------------------------
// Helper: call model-router
// ---------------------------------------------------------------------------

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET ?? "";

async function callModelRouter(
  slot: string,
  messages: Array<{ content: string; role: string }>,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (INTERNAL_SECRET) {
    headers["x-internal-secret"] = INTERNAL_SECRET;
  }

  const response = await fetch(`${MODEL_ROUTER_URL}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages,
      slot,
      maxTokens: options?.maxTokens ?? 512,
      temperature: options?.temperature ?? 0.2,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Model router error (${response.status}): ${text}`);
  }

  const result = (await response.json()) as { content?: string; text?: string };
  return result.content ?? result.text ?? "";
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ideApp = new Hono();

/**
 * POST /api/completions — inline tab completion
 *
 * Input: { prefix, suffix, language, filePath, openFiles? }
 * Output: { completion: string }
 *
 * Uses a fast model for <500ms response time.
 */
ideApp.post("/completions", async (c) => {
  const startTime = performance.now();

  try {
    const body = (await c.req.json()) as CompletionRequest;

    if (!(body.prefix || body.suffix)) {
      return c.json({ completion: "" });
    }

    const openFilesContext =
      body.openFiles && body.openFiles.length > 0
        ? `\nOpen files: ${body.openFiles.slice(0, 10).join(", ")}`
        : "";

    const systemPrompt = `You are an intelligent code completion engine. Complete the code at the cursor position. Return ONLY the completion text, no explanation, no markdown, no code fences. The completion should be natural, idiomatic ${body.language} code.${openFilesContext}`;

    const userPrompt = `File: ${body.filePath}\nLanguage: ${body.language}\n\nCode before cursor:\n\`\`\`\n${body.prefix.slice(-2000)}\n\`\`\`\n\nCode after cursor:\n\`\`\`\n${body.suffix.slice(0, 500)}\n\`\`\`\n\nComplete the code at the cursor position:`;

    const completion = await callModelRouter(
      "fast-completion",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 256, temperature: 0.1 }
    );

    const durationMs = performance.now() - startTime;
    logger.debug(
      { durationMs: Math.round(durationMs), language: body.language },
      "Inline completion served"
    );

    return c.json({ completion: completion.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error: message }, "Inline completion failed");
    return c.json({ completion: "", error: message }, 500);
  }
});

/**
 * POST /api/edit — Cmd+K inline editing
 *
 * Input: { code, instruction, language, filePath, context? }
 * Output: { editedCode: string }
 *
 * Uses a code-focused model for high-quality edits.
 */
ideApp.post("/edit", async (c) => {
  const startTime = performance.now();

  try {
    const body = (await c.req.json()) as EditRequest;

    if (!(body.code && body.instruction)) {
      return c.json(
        { editedCode: "", error: "code and instruction are required" },
        400
      );
    }

    const contextSection = body.context
      ? `\n\nSurrounding context:\n\`\`\`${body.language}\n${body.context.slice(0, 3000)}\n\`\`\``
      : "";

    const systemPrompt = `You are a code editor. Apply the user's instruction to modify the provided code. Return ONLY the modified code, no explanations, no markdown code fences, no comments about what you changed. Preserve the original indentation and style.`;

    const userPrompt = `File: ${body.filePath}\nLanguage: ${body.language}\n\nInstruction: ${body.instruction}\n\nCode to edit:\n\`\`\`${body.language}\n${body.code}\n\`\`\`${contextSection}\n\nModified code:`;

    const editedCode = await callModelRouter(
      "code-edit",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 2048, temperature: 0.2 }
    );

    const durationMs = performance.now() - startTime;
    logger.debug(
      { durationMs: Math.round(durationMs), language: body.language },
      "Inline edit served"
    );

    // Strip any surrounding code fences if the model included them
    const cleaned = editedCode
      .replace(CODE_FENCE_START_RE, "")
      .replace(CODE_FENCE_END_RE, "")
      .trim();

    return c.json({ editedCode: cleaned });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error: message }, "Inline edit failed");
    return c.json({ editedCode: "", error: message }, 500);
  }
});

/**
 * POST /api/explain — code explanation
 *
 * Input: { code, language, filePath }
 * Output: { explanation: string }
 */
ideApp.post("/explain", async (c) => {
  try {
    const body = (await c.req.json()) as ExplainRequest;

    if (!body.code) {
      return c.json({ explanation: "", error: "code is required" }, 400);
    }

    const systemPrompt =
      "You are a code explanation engine. Explain the given code clearly and concisely. Include what the code does, key patterns used, and any important details.";

    const userPrompt = `File: ${body.filePath}\nLanguage: ${body.language}\n\nExplain this code:\n\`\`\`${body.language}\n${body.code}\n\`\`\``;

    const explanation = await callModelRouter(
      "code-explain",
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      { maxTokens: 1024, temperature: 0.3 }
    );

    return c.json({ explanation: explanation.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error({ error: message }, "Code explanation failed");
    return c.json({ explanation: "", error: message }, 500);
  }
});

export { ideApp };
