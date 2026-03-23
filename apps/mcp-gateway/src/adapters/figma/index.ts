import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const _logger = createLogger("mcp-gateway:figma");

const FIGMA_API = "https://api.figma.com/v1";

async function figmaFetch(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const url = path.startsWith("http") ? path : `${FIGMA_API}${path}`;

  const headers: Record<string, string> = {
    "X-Figma-Token": token,
    "User-Agent": "Prometheus-MCP-Gateway/1.0",
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("json")
    ? await response.json()
    : await response.text();

  return { status: response.status, data };
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.figma_token;
  if (!token) {
    return {
      success: false,
      error: "Figma access token required. Provide credentials.figma_token.",
    };
  }
  return token;
}

export function registerFigmaAdapter(registry: ToolRegistry): void {
  // ---- get_file ----
  registry.register(
    {
      name: "figma_get_file",
      adapter: "figma",
      description: "Get a Figma file's structure, pages, and component list",
      inputSchema: {
        type: "object",
        properties: {
          fileKey: { type: "string", description: "Figma file key (from URL)" },
          depth: {
            type: "number",
            description: "Depth of node tree to return (default: 2)",
          },
        },
        required: ["fileKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { fileKey, depth } = input as { fileKey: string; depth?: number };

      const params = new URLSearchParams();
      if (depth !== undefined) {
        params.set("depth", String(depth));
      }

      const queryStr = params.toString() ? `?${params.toString()}` : "";
      const { status, data } = await figmaFetch(
        `/files/${fileKey}${queryStr}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Figma API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const file = data as Record<string, unknown>;
      const document = file.document as Record<string, unknown> | undefined;

      // Extract pages and their top-level frames
      const pages: Array<{
        id: string;
        name: string;
        frames: Array<{ id: string; name: string }>;
      }> = [];
      if (document?.children) {
        for (const page of document.children as Record<string, unknown>[]) {
          const frames = ((page.children as Record<string, unknown>[]) ?? [])
            .filter(
              (child: Record<string, unknown>) =>
                child.type === "FRAME" ||
                child.type === "COMPONENT" ||
                child.type === "COMPONENT_SET"
            )
            .map((frame: Record<string, unknown>) => ({
              id: frame.id as string,
              name: frame.name as string,
              type: frame.type as string,
            }));

          pages.push({
            id: page.id as string,
            name: page.name as string,
            frames,
          });
        }
      }

      // Extract components from the file metadata
      const components = file.components
        ? Object.entries(
            file.components as Record<string, Record<string, unknown>>
          ).map(([id, comp]) => ({
            id,
            name: comp.name,
            description: comp.description ?? "",
            key: comp.key,
          }))
        : [];

      // Extract styles
      const styles = file.styles
        ? Object.entries(
            file.styles as Record<string, Record<string, unknown>>
          ).map(([id, style]) => ({
            id,
            name: style.name,
            type: style.styleType, // FILL, TEXT, EFFECT, GRID
            description: style.description ?? "",
          }))
        : [];

      return {
        success: true,
        data: {
          name: file.name,
          lastModified: file.lastModified,
          version: file.version,
          pages,
          components,
          styles,
          thumbnailUrl: file.thumbnailUrl,
        },
      };
    }
  );

  // ---- get_components ----
  registry.register(
    {
      name: "figma_get_components",
      adapter: "figma",
      description: "Get all published components from a Figma file",
      inputSchema: {
        type: "object",
        properties: {
          fileKey: { type: "string", description: "Figma file key" },
        },
        required: ["fileKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { fileKey } = input as { fileKey: string };
      const { status, data } = await figmaFetch(
        `/files/${fileKey}/components`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Figma API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const meta = result.meta as Record<string, unknown> | undefined;
      const components = (
        (meta?.components as Record<string, unknown>[]) ?? []
      ).map((comp) => ({
        key: comp.key,
        name: comp.name,
        description: comp.description ?? "",
        node_id: comp.node_id,
        containing_frame: comp.containing_frame
          ? {
              name: (comp.containing_frame as Record<string, unknown>).name,
              nodeId: (comp.containing_frame as Record<string, unknown>).nodeId,
            }
          : null,
        created_at: comp.created_at,
        updated_at: comp.updated_at,
      }));

      return {
        success: true,
        data: { components, count: components.length },
      };
    }
  );

  // ---- export_images ----
  registry.register(
    {
      name: "figma_export_images",
      adapter: "figma",
      description: "Export images/icons from specific nodes in a Figma file",
      inputSchema: {
        type: "object",
        properties: {
          fileKey: { type: "string" },
          nodeIds: {
            type: "array",
            items: { type: "string" },
            description: "Node IDs to export",
          },
          format: {
            type: "string",
            enum: ["png", "svg", "jpg", "pdf"],
            description: "Export format",
          },
          scale: {
            type: "number",
            description: "Export scale (1-4, default 2)",
          },
        },
        required: ["fileKey", "nodeIds"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { fileKey, nodeIds, format, scale } = input as {
        fileKey: string;
        nodeIds: string[];
        format?: string;
        scale?: number;
      };

      if (!nodeIds.length) {
        return { success: false, error: "At least one node ID is required" };
      }

      const params = new URLSearchParams({
        ids: nodeIds.join(","),
        format: format ?? "png",
        scale: String(Math.min(Math.max(scale ?? 2, 1), 4)),
      });

      const { status, data } = await figmaFetch(
        `/images/${fileKey}?${params.toString()}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Figma API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const images = result.images as Record<string, string | null> | undefined;

      if (!images) {
        return { success: false, error: "No images returned" };
      }

      const exportedImages = Object.entries(images).map(([nodeId, url]) => ({
        nodeId,
        url,
        format: format ?? "png",
      }));

      return {
        success: true,
        data: {
          images: exportedImages,
          count: exportedImages.length,
          err: result.err ?? null,
        },
      };
    }
  );

  // ---- get_design_tokens ----
  registry.register(
    {
      name: "figma_get_design_tokens",
      adapter: "figma",
      description:
        "Extract design tokens (colors, typography, spacing) from a Figma file's published styles",
      inputSchema: {
        type: "object",
        properties: {
          fileKey: { type: "string" },
        },
        required: ["fileKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { fileKey } = input as { fileKey: string };

      // Get file styles
      const { status, data } = await figmaFetch(
        `/files/${fileKey}/styles`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Figma API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const meta = result.meta as Record<string, unknown> | undefined;
      const styles = (meta?.styles as Record<string, unknown>[]) ?? [];

      // Categorize styles into token types
      const colors: Array<{ name: string; key: string; description: string }> =
        [];
      const typography: Array<{
        name: string;
        key: string;
        description: string;
      }> = [];
      const effects: Array<{ name: string; key: string; description: string }> =
        [];
      const grids: Array<{ name: string; key: string; description: string }> =
        [];

      for (const style of styles) {
        const entry = {
          name: style.name as string,
          key: style.key as string,
          description: (style.description as string) ?? "",
          node_id: style.node_id as string,
        };

        switch (style.style_type) {
          case "FILL":
            colors.push(entry);
            break;
          case "TEXT":
            typography.push(entry);
            break;
          case "EFFECT":
            effects.push(entry);
            break;
          case "GRID":
            grids.push(entry);
            break;
          default:
            break;
        }
      }

      // Also get the file to extract actual color/text values from the nodes
      const fileResult = await figmaFetch(
        `/files/${fileKey}?depth=1`,
        tokenOrErr
      );
      let _fileStyles: Record<string, unknown> = {};
      if (fileResult.status === 200) {
        const fileData = fileResult.data as Record<string, unknown>;
        _fileStyles = (fileData.styles as Record<string, unknown>) ?? {};
      }

      return {
        success: true,
        data: {
          colors: {
            tokens: colors,
            count: colors.length,
          },
          typography: {
            tokens: typography,
            count: typography.length,
          },
          effects: {
            tokens: effects,
            count: effects.length,
          },
          grids: {
            tokens: grids,
            count: grids.length,
          },
          totalStyles: styles.length,
        },
      };
    }
  );
}
