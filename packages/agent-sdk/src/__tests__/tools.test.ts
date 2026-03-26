import { describe, expect, it } from "vitest";
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

  it("should have browser tools registered", () => {
    expect(TOOL_REGISTRY).toHaveProperty("browser_open");
    expect(TOOL_REGISTRY).toHaveProperty("browser_screenshot");
  });

  it("should have agent meta tools registered", () => {
    expect(TOOL_REGISTRY).toHaveProperty("ask_user");
    expect(TOOL_REGISTRY).toHaveProperty("spawn_agent");
    expect(TOOL_REGISTRY).toHaveProperty("kill_agent");
    expect(TOOL_REGISTRY).toHaveProperty("read_blueprint");
    expect(TOOL_REGISTRY).toHaveProperty("read_brain");
  });

  it("should have valid tool definitions", () => {
    for (const [name, tool] of Object.entries(TOOL_REGISTRY)) {
      expect(tool.name).toBe(name);
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
      expect(typeof tool.execute).toBe("function");
      expect(["read", "write", "execute", "admin"]).toContain(
        tool.permissionLevel
      );
      expect(typeof tool.creditCost).toBe("number");
      expect(tool.creditCost).toBeGreaterThanOrEqual(0);
    }
  });

  it("should have 45 total tools", () => {
    // 5 file + 2 terminal + 7 git (incl git_clone) + 3 search + 2 browser + 5 agent meta + 5 lsp + 4 ast-grep + 2 semgrep + 1 zoekt + 1 openhands-edit + 2 browser-automation + 1 sandbox-rollback + 5 env-setup = 45
    expect(Object.keys(TOOL_REGISTRY)).toHaveLength(45);
  });
});
