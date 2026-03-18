import { describe, it, expect } from "vitest";
import { TOOL_REGISTRY } from "../tools/registry";

describe("TOOL_REGISTRY", () => {
  it("should have file tools registered", () => {
    expect(TOOL_REGISTRY).toHaveProperty("file_read");
    expect(TOOL_REGISTRY).toHaveProperty("file_write");
    expect(TOOL_REGISTRY).toHaveProperty("file_edit");
    expect(TOOL_REGISTRY).toHaveProperty("file_delete");
    expect(TOOL_REGISTRY).toHaveProperty("file_list");
  });

  it("should have terminal tools registered", () => {
    expect(TOOL_REGISTRY).toHaveProperty("terminal_exec");
    expect(TOOL_REGISTRY).toHaveProperty("terminal_background");
  });

  it("should have git tools registered", () => {
    expect(TOOL_REGISTRY).toHaveProperty("git_status");
    expect(TOOL_REGISTRY).toHaveProperty("git_diff");
    expect(TOOL_REGISTRY).toHaveProperty("git_commit");
    expect(TOOL_REGISTRY).toHaveProperty("git_branch");
    expect(TOOL_REGISTRY).toHaveProperty("git_push");
    expect(TOOL_REGISTRY).toHaveProperty("git_create_pr");
  });

  it("should have search tools registered", () => {
    expect(TOOL_REGISTRY).toHaveProperty("search_files");
    expect(TOOL_REGISTRY).toHaveProperty("search_content");
    expect(TOOL_REGISTRY).toHaveProperty("search_semantic");
  });

  it("should have valid tool definitions", () => {
    for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
      expect(tool.name).toBe(name);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
      expect(["read", "write", "execute", "admin"]).toContain(tool.permissionLevel);
    }
  });

  it("should have 16 total tools", () => {
    expect(Object.keys(TOOL_REGISTRY)).toHaveLength(16);
  });
});
