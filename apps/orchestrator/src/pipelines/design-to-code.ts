import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:pipeline:design-to-code");

export interface DesignInput {
  componentLibrary?: string; // shadcn, mui, chakra
  content: string; // base64 image, URL, or text description
  framework?: string; // react, vue, svelte
  styling?: string; // tailwind, css-modules, styled-components
  type: "screenshot" | "figma_url" | "description";
}

export interface DesignToCodeResult {
  code: string;
  componentName: string;
  dependencies: string[];
  files: Array<{
    content: string;
    path: string;
  }>;
  previewHtml?: string;
}

/**
 * Converts design assets (screenshots, Figma URLs, or descriptions) into React components.
 * Uses vision-capable models to analyze the design and generate matching code.
 */
export async function designToCode(
  input: DesignInput,
  modelRouterUrl: string = process.env.MODEL_ROUTER_URL ??
    "http://localhost:4004"
): Promise<DesignToCodeResult> {
  logger.info(
    { type: input.type, framework: input.framework },
    "Starting design-to-code pipeline"
  );

  const framework = input.framework ?? "react";
  const componentLibrary = input.componentLibrary ?? "shadcn";
  const styling = input.styling ?? "tailwind";

  const systemPrompt = `You are an expert UI developer. Convert the provided design into a ${framework} component.
Use ${componentLibrary} components and ${styling} for styling.
Output a complete, working component with all imports.
Follow these rules:
- Use TypeScript with proper types for all props
- Make the component responsive (mobile-first)
- Include accessibility attributes (aria labels, semantic HTML)
- Use proper color tokens and spacing
- Export the component as a named export

Respond with JSON: { "componentName": "string", "files": [{ "path": "string", "content": "string" }], "dependencies": ["string"] }`;

  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: systemPrompt },
  ];

  if (input.type === "screenshot") {
    messages.push({
      role: "user",
      content: [
        {
          type: "text",
          text: "Convert this screenshot into a React component:",
        },
        {
          type: "image_url",
          image_url: { url: `data:image/png;base64,${input.content}` },
        },
      ],
    });
  } else if (input.type === "figma_url") {
    messages.push({
      role: "user",
      content: `Convert this Figma design into a React component. Figma URL: ${input.content}\n\nAnalyze the design at this URL and generate matching code.`,
    });
  } else {
    messages.push({
      role: "user",
      content: `Create a React component matching this description:\n\n${input.content}`,
    });
  }

  try {
    const response = await fetch(`${modelRouterUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "vision", // Routes to vision-capable model (GPT-4o, Claude)
        messages,
        max_tokens: 4096,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Model router returned ${response.status}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    const content = data.choices?.[0]?.message?.content ?? "{}";
    const result = JSON.parse(content) as {
      componentName?: string;
      dependencies?: string[];
      files?: Array<{ content: string; path: string }>;
    };

    const files = result.files ?? [];
    const componentName = result.componentName ?? "GeneratedComponent";
    const dependencies = result.dependencies ?? [];

    // Generate preview HTML wrapper
    const mainFile = files[0];
    const previewHtml = mainFile
      ? `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    // Preview placeholder - actual preview uses Sandpack
  </script>
</body>
</html>`
      : undefined;

    logger.info(
      { componentName, fileCount: files.length, depCount: dependencies.length },
      "Design-to-code pipeline completed"
    );

    return {
      componentName,
      files,
      dependencies,
      code: mainFile?.content ?? "",
      previewHtml,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Design-to-code pipeline failed");
    throw new Error(`Design-to-code failed: ${msg}`);
  }
}
