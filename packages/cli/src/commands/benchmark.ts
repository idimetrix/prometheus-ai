import { Command } from "commander";

interface BenchmarkRunResult {
  commitHash: string;
  failedInstances: string[];
  passRate: number;
  results: Array<{
    costUsd: number;
    error?: string;
    instanceId: string;
    latencyMs: number;
    resolved: boolean;
  }>;
  timestamp: string;
  totalInstances: number;
  totalResolved: number;
}

export const benchmarkCommand = new Command("benchmark")
  .description(
    "Run SWE-bench evaluation harness against the Prometheus pipeline"
  )
  .option(
    "-f, --file <path>",
    "Path to a SWE-bench JSONL file with test instances"
  )
  .option(
    "-c, --cases <ids>",
    "Comma-separated list of specific case IDs to run"
  )
  .option(
    "--commit <hash>",
    "Git commit hash to tag this benchmark run",
    "HEAD"
  )
  .option(
    "--orchestrator-url <url>",
    "Orchestrator URL",
    process.env.ORCHESTRATOR_URL ?? "http://localhost:4002"
  )
  .option("--json", "Output results as JSON")
  .action(
    async (opts: {
      cases?: string;
      commit: string;
      file?: string;
      json?: boolean;
      orchestratorUrl: string;
    }) => {
      const orchestratorUrl = opts.orchestratorUrl;

      console.log("SWE-bench Evaluation Harness");
      console.log(`Orchestrator: ${orchestratorUrl}`);
      console.log(`Commit: ${opts.commit}`);
      console.log("");

      try {
        if (opts.file) {
          // Run from a JSONL file
          console.log(`Loading instances from: ${opts.file}`);
          const response = await fetch(`${orchestratorUrl}/benchmark/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filePath: opts.file,
              commitHash: opts.commit,
            }),
            signal: AbortSignal.timeout(600_000),
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            console.error(
              `Benchmark run failed (${response.status}): ${text.slice(0, 200)}`
            );
            process.exit(1);
          }

          const report = (await response.json()) as BenchmarkRunResult;
          printReport(report, opts.json);
        } else if (opts.cases) {
          // Run specific cases
          const caseIds = opts.cases.split(",").map((id) => id.trim());
          console.log(`Running ${caseIds.length} specific case(s)...`);

          const response = await fetch(`${orchestratorUrl}/benchmark/suite`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              caseIds,
              commitHash: opts.commit,
            }),
            signal: AbortSignal.timeout(600_000),
          });

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            console.error(
              `Suite run failed (${response.status}): ${text.slice(0, 200)}`
            );
            process.exit(1);
          }

          const report = (await response.json()) as BenchmarkRunResult;
          printReport(report, opts.json);
        } else {
          console.log(
            "Usage: prometheus benchmark --file <path.jsonl> or --cases <id1,id2>"
          );
          console.log("");
          console.log("Options:");
          console.log("  -f, --file <path>    Path to SWE-bench JSONL file");
          console.log("  -c, --cases <ids>    Comma-separated case IDs");
          console.log("  --commit <hash>      Git commit hash (default: HEAD)");
          console.log("  --json               Output results as JSON");
          process.exit(1);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    }
  );

function printReport(report: BenchmarkRunResult, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log("=== SWE-bench Evaluation Report ===");
  console.log("");
  console.log(`Date:      ${report.timestamp}`);
  console.log(`Commit:    ${report.commitHash}`);
  console.log(`Instances: ${report.totalInstances}`);
  console.log(`Resolved:  ${report.totalResolved}`);
  console.log(`Pass Rate: ${(report.passRate * 100).toFixed(1)}%`);
  console.log("");

  if (report.results.length > 0) {
    console.log("--- Results ---");
    for (const r of report.results) {
      const status = r.resolved ? "PASS" : "FAIL";
      const cost = `$${r.costUsd.toFixed(4)}`;
      const latency = `${r.latencyMs}ms`;
      const errorNote = r.error ? ` (${r.error})` : "";
      console.log(
        `  [${status}] ${r.instanceId} - ${cost} - ${latency}${errorNote}`
      );
    }
  }

  if (report.failedInstances.length > 0) {
    console.log("");
    console.log("--- Failed Instances ---");
    for (const id of report.failedInstances) {
      console.log(`  - ${id}`);
    }
  }

  console.log("");
  const exitCode = report.passRate >= 0.3 ? 0 : 1;
  if (exitCode === 0) {
    console.log("Target pass rate (30%) met.");
  } else {
    console.log("Target pass rate (30%) NOT met.");
  }
  process.exit(exitCode);
}
