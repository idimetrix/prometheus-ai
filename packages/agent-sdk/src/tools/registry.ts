import type { AgentToolDefinition } from "./types";
import { fileTools } from "./file";
import { terminalTools } from "./terminal";
import { gitTools } from "./git";
import { searchTools } from "./search";

export const TOOL_REGISTRY: Record<string, AgentToolDefinition> = {};

function registerTools(tools: AgentToolDefinition[]) {
  for (const tool of tools) {
    TOOL_REGISTRY[tool.name] = tool;
  }
}

registerTools(fileTools);
registerTools(terminalTools);
registerTools(gitTools);
registerTools(searchTools);
