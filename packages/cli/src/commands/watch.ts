import { watch as fsWatch, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  ".cache",
  "__pycache__",
  ".pytest_cache",
  "target",
  ".prometheus",
];

function shouldIgnore(filePath: string, ignorePatterns: string[]): boolean {
  const parts = filePath.split("/");
  return parts.some((part) => ignorePatterns.includes(part));
}

interface WatchOpts {
  apiKey?: string;
  apiUrl?: string;
  ignore: string;
  path: string;
  project?: string;
}

export const watchCommand = new Command("watch")
  .description(
    "Watch filesystem for changes and send to Prometheus for analysis"
  )
  .option("-w, --path <dir>", "Directory to watch", ".")
  .option(
    "--ignore <patterns>",
    "Comma-separated patterns to ignore",
    DEFAULT_IGNORE.join(",")
  )
  .option("-p, --project <id>", "Project ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action((opts: WatchOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = config.projectId;

    if (!projectId) {
      console.error(
        "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
      );
      process.exit(1);
    }

    const watchDir = join(process.cwd(), opts.path);
    const ignorePatterns = opts.ignore.split(",").map((s) => s.trim());

    console.log(`Watching ${watchDir} for changes...`);
    console.log(`Ignoring: ${ignorePatterns.join(", ")}`);
    console.log("Press Ctrl+C to stop.\n");

    // Debounce: collect changes and send periodically
    let pendingChanges: Set<string> = new Set();
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let processing = false;

    async function flushChanges(): Promise<void> {
      if (pendingChanges.size === 0 || processing) {
        return;
      }

      processing = true;
      const changes = [...pendingChanges];
      pendingChanges = new Set();

      const fileList = changes.join(", ");
      console.log(`\nAnalyzing ${changes.length} changed file(s): ${fileList}`);

      try {
        const result = await client.submitTask({
          title: `Watch: Analyze changes in ${changes.length} file(s)`,
          description: `Files changed: ${fileList}. Please review these changes for potential issues, bugs, or improvements.`,
          projectId: projectId as string,
          mode: "ask",
        });

        const stream = client.streamSession(result.sessionId, (event) => {
          if (event.type === "token") {
            process.stdout.write(
              String((event.data as { content: string }).content)
            );
          } else if (event.type === "complete") {
            console.log("\n");
            stream.close();
          }
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Analysis error: ${msg}`);
      } finally {
        processing = false;
      }
    }

    function handleChange(filename: string | null): void {
      if (!filename) {
        return;
      }

      const relativePath = relative(watchDir, join(watchDir, filename));
      if (shouldIgnore(relativePath, ignorePatterns)) {
        return;
      }

      // Skip directories
      try {
        const stat = statSync(join(watchDir, filename));
        if (stat.isDirectory()) {
          return;
        }
      } catch {
        // File may have been deleted
      }

      const name = basename(filename);
      // Skip hidden files and common non-code files
      if (name.startsWith(".") || name.endsWith(".lock")) {
        return;
      }

      pendingChanges.add(relativePath);
      console.log(`  Changed: ${relativePath}`);

      // Debounce: wait 2 seconds after last change before analyzing
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        flushChanges().catch((err) => {
          console.error("Flush error:", err);
        });
      }, 2000);
    }

    // Start watching
    try {
      const watcher = fsWatch(
        watchDir,
        { recursive: true },
        (_eventType, filename) => {
          handleChange(filename);
        }
      );

      process.on("SIGINT", () => {
        watcher.close();
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        console.log("\nStopped watching.");
        process.exit(0);
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error setting up watcher: ${msg}`);
      process.exit(1);
    }
  });
