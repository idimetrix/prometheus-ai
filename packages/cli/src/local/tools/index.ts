import { fileListTool } from "./file-list";
import { fileReadTool } from "./file-read";
import { fileWriteTool } from "./file-write";
import {
  gitCommitTool,
  gitDiffTool,
  gitLogTool,
  gitStatusTool,
} from "./git-ops";
import { terminalExecTool } from "./terminal-exec";
import type { LocalTool } from "./types";
import { webSearchTool } from "./web-search";

export const LOCAL_TOOLS: LocalTool[] = [
  fileReadTool,
  fileWriteTool,
  fileListTool,
  terminalExecTool,
  gitStatusTool,
  gitDiffTool,
  gitCommitTool,
  gitLogTool,
  webSearchTool,
];

export function getToolByName(name: string): LocalTool | undefined {
  return LOCAL_TOOLS.find((t) => t.name === name);
}

export type { LocalTool, ToolResult } from "./types";
