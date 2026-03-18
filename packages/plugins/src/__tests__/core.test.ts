import { describe, expect, it } from "vitest";
import { PluginManager } from "../core";
import { PluginLoader } from "../loader";
import type { PluginLifecycle, PluginManifest } from "../types";

const createTestManifest = (id: string): PluginManifest => ({
  id,
  name: `Test Plugin ${id}`,
  version: "1.0.0",
  description: "A test plugin",
  author: "test",
  category: "integration",
});

const noopLifecycle: PluginLifecycle = {
  activate: async () => {
    /* no-op */
  },
  deactivate: async () => {
    /* no-op */
  },
};

describe("PluginLoader", () => {
  it("registers a plugin", () => {
    const loader = new PluginLoader();
    const manifest = createTestManifest("test-1");
    loader.register(manifest, noopLifecycle);
    const plugins = loader.getAllPlugins();
    expect(plugins.some((p) => p.manifest.id === "test-1")).toBe(true);
  });

  it("activates and deactivates a plugin", async () => {
    const loader = new PluginLoader();
    const manifest = createTestManifest("test-2");
    loader.register(manifest, noopLifecycle);
    await loader.activate("test-2");
    let plugin = loader.getPlugin("test-2");
    expect(plugin?.status).toBe("active");
    await loader.deactivate("test-2");
    plugin = loader.getPlugin("test-2");
    expect(plugin?.status).toBe("inactive");
  });

  it("uninstalls a plugin", async () => {
    const loader = new PluginLoader();
    const manifest = createTestManifest("test-3");
    loader.register(manifest, noopLifecycle);
    await loader.uninstall("test-3");
    expect(loader.getPlugin("test-3")).toBeUndefined();
  });

  it("returns undefined for unknown plugin", () => {
    const loader = new PluginLoader();
    expect(loader.getPlugin("nonexistent")).toBeUndefined();
  });
});

describe("PluginManager", () => {
  it("creates a manager instance", () => {
    const manager = new PluginManager();
    expect(manager).toBeDefined();
  });

  it("registers and activates a plugin", async () => {
    const manager = new PluginManager();
    const manifest = createTestManifest("mgr-1");
    await manager.registerAndActivate(manifest, noopLifecycle);
    const summaries = manager.getPluginSummaries();
    expect(
      summaries.some((s) => s.id === "mgr-1" && s.status === "active")
    ).toBe(true);
  });

  it("shuts down all plugins", async () => {
    const manager = new PluginManager();
    await manager.registerAndActivate(
      createTestManifest("mgr-2"),
      noopLifecycle
    );
    await manager.registerAndActivate(
      createTestManifest("mgr-3"),
      noopLifecycle
    );
    await manager.shutdown();
    const summaries = manager.getPluginSummaries();
    expect(summaries.every((s) => s.status === "inactive")).toBe(true);
  });

  it("reports plugin summaries correctly", async () => {
    const manager = new PluginManager();
    await manager.registerAndActivate(
      createTestManifest("sum-1"),
      noopLifecycle
    );
    const summaries = manager.getPluginSummaries();
    const summary = summaries.find((s) => s.id === "sum-1");
    expect(summary).toBeDefined();
    expect(summary?.name).toBe("Test Plugin sum-1");
    expect(summary?.version).toBe("1.0.0");
    expect(summary?.status).toBe("active");
  });
});
