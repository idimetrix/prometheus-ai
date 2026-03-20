import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface CLIPluginCommand {
  action: (args: string[], options: Record<string, string>) => Promise<void>;
  description: string;
  name: string;
  options?: Array<{ description: string; flags: string }>;
}

interface CLIPlugin {
  commands: CLIPluginCommand[];
  name: string;
  version: string;
}

interface CLIPluginModule {
  default?: CLIPlugin;
  plugin?: CLIPlugin;
}

/**
 * Discovers and loads CLI plugins from a plugin directory.
 * Plugins are directories containing a package.json with a "prometheus-cli"
 * entry that exports a CLIPlugin object.
 */
export class CLIPluginLoader {
  private readonly plugins = new Map<string, CLIPlugin>();

  /**
   * Discover and load plugins from a directory.
   * Each subdirectory should contain a package.json with a
   * "prometheus-cli" main entry.
   */
  async loadPlugins(pluginDir: string): Promise<number> {
    if (!existsSync(pluginDir)) {
      return 0;
    }

    const entries = readdirSync(pluginDir, { withFileTypes: true });
    let loaded = 0;

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const pluginPath = join(pluginDir, entry.name);
      const pkgPath = join(pluginPath, "package.json");

      if (!existsSync(pkgPath)) {
        continue;
      }

      try {
        const pkgRaw = readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgRaw) as {
          "prometheus-cli"?: { main: string };
        };
        const cliConfig = pkg["prometheus-cli"];

        if (!cliConfig?.main) {
          continue;
        }

        const modulePath = join(pluginPath, cliConfig.main);
        const mod = (await import(modulePath)) as CLIPluginModule;
        const plugin = mod.default ?? mod.plugin;

        if (plugin) {
          this.registerPlugin(plugin);
          loaded++;
        }
      } catch {
        // Skip plugins that fail to load
      }
    }

    return loaded;
  }

  /**
   * Register a plugin manually.
   */
  registerPlugin(plugin: CLIPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Get all commands provided by loaded plugins.
   */
  getPluginCommands(): CLIPluginCommand[] {
    const commands: CLIPluginCommand[] = [];
    for (const plugin of this.plugins.values()) {
      for (const cmd of plugin.commands) {
        commands.push(cmd);
      }
    }
    return commands;
  }

  /**
   * Get a specific plugin by name.
   */
  getPlugin(name: string): CLIPlugin | undefined {
    return this.plugins.get(name);
  }

  /**
   * Get all loaded plugins.
   */
  getAllPlugins(): CLIPlugin[] {
    return Array.from(this.plugins.values());
  }
}

export type { CLIPlugin, CLIPluginCommand };
