import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockClose, mockTools } = vi.hoisted(() => ({
  mockClose: vi.fn(),
  mockTools: vi.fn(),
}));

vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn().mockResolvedValue({
    close: mockClose,
    tools: mockTools,
  }),
}));

vi.mock("@prometheus/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { createMCPToolsForSession, MCPClientManager } from "../mcp-client";

describe("MCPClientManager", () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MCPClientManager();
  });

  afterEach(async () => {
    await manager.disconnectAll();
  });

  describe("connect", () => {
    it("connects to an MCP server", async () => {
      await manager.connect({
        name: "test-server",
        transport: "sse",
        url: "http://localhost:3000",
      });

      const servers = manager.listServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]?.name).toBe("test-server");
      expect(servers[0]?.status).toBe("connected");
    });

    it("disconnects existing server before reconnecting", async () => {
      await manager.connect({
        name: "test-server",
        transport: "sse",
        url: "http://localhost:3000",
      });

      await manager.connect({
        name: "test-server",
        transport: "http",
        url: "http://localhost:4000",
      });

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(manager.listServers()).toHaveLength(1);
    });

    it("handles connection errors gracefully", async () => {
      const { createMCPClient } = await import("@ai-sdk/mcp");
      vi.mocked(createMCPClient).mockRejectedValueOnce(
        new Error("Connection refused")
      );

      await manager.connect({
        name: "bad-server",
        transport: "sse",
        url: "http://localhost:9999",
      });

      expect(manager.listServers()).toHaveLength(0);
    });
  });

  describe("disconnect", () => {
    it("disconnects a connected server", async () => {
      await manager.connect({
        name: "srv",
        transport: "sse",
        url: "http://localhost:3000",
      });
      await manager.disconnect("srv");

      expect(manager.listServers()).toHaveLength(0);
      expect(mockClose).toHaveBeenCalled();
    });

    it("does nothing for unknown server name", async () => {
      await manager.disconnect("nonexistent");
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("removes client even if close throws", async () => {
      mockClose.mockRejectedValueOnce(new Error("close failed"));
      await manager.connect({
        name: "srv",
        transport: "sse",
        url: "http://localhost:3000",
      });
      await manager.disconnect("srv");

      expect(manager.listServers()).toHaveLength(0);
    });
  });

  describe("disconnectAll", () => {
    it("disconnects all connected servers", async () => {
      await manager.connect({
        name: "srv1",
        transport: "sse",
        url: "http://localhost:3000",
      });
      await manager.connect({
        name: "srv2",
        transport: "http",
        url: "http://localhost:4000",
      });

      expect(manager.listServers()).toHaveLength(2);

      await manager.disconnectAll();

      expect(manager.listServers()).toHaveLength(0);
    });
  });

  describe("getTools", () => {
    it("returns empty object for unknown server", async () => {
      const tools = await manager.getTools("unknown");
      expect(tools).toEqual({});
    });

    it("returns tools from a specific server", async () => {
      mockTools.mockResolvedValueOnce({
        readFile: { description: "Read a file" },
        writeFile: { description: "Write a file" },
      });

      await manager.connect({
        name: "fs-server",
        transport: "sse",
        url: "http://localhost:3000",
      });

      const tools = await manager.getTools("fs-server");
      expect(tools).toHaveProperty("readFile");
      expect(tools).toHaveProperty("writeFile");
    });

    it("returns tools from all servers when no name specified", async () => {
      mockTools
        .mockResolvedValueOnce({ tool1: { description: "T1" } })
        .mockResolvedValueOnce({ tool2: { description: "T2" } });

      await manager.connect({
        name: "srv1",
        transport: "sse",
        url: "http://localhost:3000",
      });
      await manager.connect({
        name: "srv2",
        transport: "http",
        url: "http://localhost:4000",
      });

      const tools = await manager.getTools();
      expect(tools).toHaveProperty("tool1");
      expect(tools).toHaveProperty("tool2");
    });

    it("handles tool fetch errors gracefully", async () => {
      mockTools.mockRejectedValueOnce(new Error("tool fetch failed"));

      await manager.connect({
        name: "srv",
        transport: "sse",
        url: "http://localhost:3000",
      });

      const tools = await manager.getTools("srv");
      expect(tools).toEqual({});
    });
  });

  describe("listServers", () => {
    it("returns empty array when no servers connected", () => {
      expect(manager.listServers()).toEqual([]);
    });
  });

  describe("refreshTools", () => {
    it("disconnects and reconnects the server", async () => {
      await manager.connect({
        name: "srv",
        transport: "sse",
        url: "http://localhost:3000",
      });

      await manager.refreshTools("srv");

      expect(mockClose).toHaveBeenCalled();
      expect(manager.listServers()).toHaveLength(1);
    });

    it("does nothing for unknown server", async () => {
      await manager.refreshTools("unknown");
      expect(mockClose).not.toHaveBeenCalled();
    });
  });
});

describe("createMCPToolsForSession", () => {
  it("returns all tools when no server names specified", async () => {
    // createMCPToolsForSession uses the singleton, so we test it indirectly
    const tools = await createMCPToolsForSession();
    expect(tools).toEqual({});
  });

  it("returns all tools when empty array is passed", async () => {
    const tools = await createMCPToolsForSession([]);
    expect(tools).toEqual({});
  });
});
