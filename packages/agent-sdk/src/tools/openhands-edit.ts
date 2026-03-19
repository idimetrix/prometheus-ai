import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const searchReplaceSchema = z
  .object({
    filePath: z.string().describe("File path relative to project root"),
    searchBlock: z
      .string()
      .min(1)
      .describe(
        "Exact text block to search for in the file. Must appear exactly once."
      ),
    replaceBlock: z.string().describe("Replacement text block"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function resolveProjectPath(workDir: string, relativePath: string): string {
  if (relativePath.startsWith("/")) {
    return relativePath;
  }
  return `${workDir}/${relativePath}`;
}

/**
 * Generate a unified-diff-style preview of the change.
 */
function generateDiffPreview(
  filePath: string,
  searchBlock: string,
  replaceBlock: string,
  lineNumber: number
): string {
  const oldLines = searchBlock.split("\n");
  const newLines = replaceBlock.split("\n");

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${lineNumber},${oldLines.length} +${lineNumber},${newLines.length} @@`,
  ];

  for (const line of oldLines) {
    lines.push(`-${line}`);
  }
  for (const line of newLines) {
    lines.push(`+${line}`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

export const openhandsEditTools: AgentToolDefinition[] = [
  {
    name: "file_edit_search_replace",
    description:
      "Edit a file using search/replace blocks. More reliable than line-number-based editing for large files. " +
      "The search block must appear exactly once in the file. The entire search block is replaced with the replace block.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "File path relative to project root",
        },
        searchBlock: {
          type: "string",
          description:
            "Exact text block to search for. Must appear exactly once in the file.",
        },
        replaceBlock: {
          type: "string",
          description: "Replacement text block",
        },
      },
      required: ["filePath", "searchBlock", "replaceBlock"],
    },
    zodSchema: searchReplaceSchema,
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = searchReplaceSchema.parse(input);
      const absPath = resolveProjectPath(ctx.workDir, parsed.filePath);

      // Read the file
      const readResult = await execInSandbox(`cat "${absPath}"`, ctx);
      if (!readResult.success) {
        return {
          success: false,
          output: "",
          error: `Failed to read file: ${readResult.error ?? "unknown error"}`,
        };
      }

      const fileContent = readResult.output;

      // Validate search block exists
      if (!fileContent.includes(parsed.searchBlock)) {
        return {
          success: false,
          output: "",
          error: [
            `Search block not found in ${parsed.filePath}.`,
            "Ensure the search text is an exact match including whitespace and indentation.",
          ].join(" "),
        };
      }

      // Validate uniqueness
      const firstIdx = fileContent.indexOf(parsed.searchBlock);
      const secondIdx = fileContent.indexOf(parsed.searchBlock, firstIdx + 1);

      if (secondIdx !== -1) {
        const occurrences = fileContent.split(parsed.searchBlock).length - 1;
        return {
          success: false,
          output: "",
          error: `Found ${occurrences} occurrences of the search block in ${parsed.filePath}. Include more surrounding context to make the match unique.`,
        };
      }

      // Apply replacement
      const updatedContent = fileContent.replace(
        parsed.searchBlock,
        parsed.replaceBlock
      );

      // Write back
      const writeCommand = `cat > "${absPath}" << 'PROMETHEUS_EOF'\n${updatedContent}\nPROMETHEUS_EOF`;
      const writeResult = await execInSandbox(writeCommand, ctx);

      if (!writeResult.success) {
        return {
          success: false,
          output: "",
          error: `Failed to write file: ${writeResult.error ?? "unknown error"}`,
        };
      }

      // Calculate line number for diff preview
      const lineNumber = fileContent.slice(0, firstIdx).split("\n").length;

      const diff = generateDiffPreview(
        parsed.filePath,
        parsed.searchBlock,
        parsed.replaceBlock,
        lineNumber
      );

      return {
        success: true,
        output: `Successfully edited ${parsed.filePath}\n\n${diff}`,
        metadata: {
          path: parsed.filePath,
          lineNumber,
          searchLength: parsed.searchBlock.length,
          replaceLength: parsed.replaceBlock.length,
        },
      };
    },
  },
];
