import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";

const logger = createLogger("api:completions:inline");

const app = new Hono();

/**
 * POST /api/v1/completions/inline
 * Fast inline code completion for editor ghost text.
 * Uses the fastest available model for sub-200ms responses.
 */
app.post("/", async (c) => {
  const body = (await c.req.json()) as {
    prefix: string;
    suffix: string;
    language: string;
    filePath?: string;
    maxTokens?: number;
  };

  const { prefix, suffix, language, filePath, maxTokens = 128 } = body;

  if (!prefix) {
    return c.json({ error: "prefix is required" }, 400);
  }

  logger.info(
    { language, filePath, prefixLen: prefix.length },
    "Inline completion request"
  );

  try {
    // Use the model router's fast slot for minimal latency
    const modelRouterUrl =
      process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
    const response = await fetch(`${modelRouterUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "fast", // Routes to fastest available model
        messages: [
          {
            role: "system",
            content: `You are a code completion engine. Complete the code at the cursor position. Output ONLY the completion text, no explanation. Language: ${language}${filePath ? `. File: ${filePath}` : ""}`,
          },
          {
            role: "user",
            content: `${prefix}<CURSOR>${suffix}`,
          },
        ],
        max_tokens: maxTokens,
        temperature: 0,
        stop: ["\n\n", "\nfunction ", "\nclass ", "\nexport ", "\nimport "],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return c.json({ completion: "", error: "Model unavailable" }, 200);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const completion = data.choices?.[0]?.message?.content ?? "";

    return c.json({
      completion: completion.trim(),
      model: "fast",
      cached: false,
    });
  } catch (_error) {
    // On timeout or error, return empty completion (non-blocking)
    return c.json({ completion: "", error: "timeout" }, 200);
  }
});

export default app;
