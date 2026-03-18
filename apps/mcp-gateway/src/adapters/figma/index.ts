import type { ToolRegistry } from "../../registry";

export function registerFigmaAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "figma_get_file",
      adapter: "figma",
      description: "Get a Figma file's component structure",
      inputSchema: {
        type: "object",
        properties: { fileKey: { type: "string" } },
        required: ["fileKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { name: "", components: [], styles: [] } };
    }
  );

  registry.register(
    {
      name: "figma_export_images",
      adapter: "figma",
      description: "Export images/icons from a Figma file",
      inputSchema: {
        type: "object",
        properties: {
          fileKey: { type: "string" },
          nodeIds: { type: "array", items: { type: "string" } },
          format: { type: "string", enum: ["png", "svg", "jpg"] },
          scale: { type: "number" },
        },
        required: ["fileKey", "nodeIds"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { images: {} } };
    }
  );

  registry.register(
    {
      name: "figma_get_design_tokens",
      adapter: "figma",
      description: "Extract design tokens (colors, typography, spacing) from a Figma file",
      inputSchema: {
        type: "object",
        properties: { fileKey: { type: "string" } },
        required: ["fileKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { colors: {}, typography: {}, spacing: {} } };
    }
  );
}
