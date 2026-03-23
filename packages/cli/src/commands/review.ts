import { Command } from "commander";
import { APIClient } from "../api-client";

interface ReviewFinding {
  file?: string;
  line?: number;
  message: string;
  severity: "critical" | "warning" | "info";
  suggestion?: string;
}

function formatSeverity(severity: ReviewFinding["severity"]): string {
  switch (severity) {
    case "critical":
      return "[CRITICAL]";
    case "warning":
      return "[WARNING] ";
    case "info":
      return "[INFO]    ";
    default:
      return "[UNKNOWN] ";
  }
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };

function printFinding(finding: ReviewFinding): void {
  let location = "";
  if (finding.file) {
    location = finding.line
      ? ` ${finding.file}:${finding.line}`
      : ` ${finding.file}`;
  }
  console.log(`${formatSeverity(finding.severity)}${location}`);
  console.log(`  ${finding.message}`);
  if (finding.suggestion) {
    console.log(`  Suggestion: ${finding.suggestion}`);
  }
  console.log();
}

function printReviewSummary(findings: ReviewFinding[], severity: string): void {
  if (findings.length === 0) {
    console.log("\n\nNo issues found.");
    return;
  }

  console.log("\n\n--- Review Findings ---\n");

  const minSeverity =
    SEVERITY_ORDER[severity as keyof typeof SEVERITY_ORDER] ?? 2;
  const filtered = findings.filter(
    (f) => SEVERITY_ORDER[f.severity] <= minSeverity
  );

  for (const finding of filtered) {
    printFinding(finding);
  }

  const criticalCount = filtered.filter(
    (f) => f.severity === "critical"
  ).length;
  const warningCount = filtered.filter((f) => f.severity === "warning").length;
  console.log(
    `Found ${criticalCount} critical, ${warningCount} warnings, ${filtered.length} total findings`
  );
}

export const reviewCommand = new Command("review")
  .description("Run AI code review on files or git diff range")
  .argument("[paths...]", "File paths or git diff range (e.g., main..HEAD)")
  .option("-p, --project <id>", "Project ID")
  .option("--severity <level>", "Minimum severity to show", "info")
  .action(
    async (paths: string[], opts: { project?: string; severity: string }) => {
      const client = new APIClient();
      const projectId = opts.project ?? process.env.PROMETHEUS_PROJECT_ID;

      if (!projectId) {
        console.error(
          "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
        );
        process.exit(1);
      }

      const targetDescription =
        paths.length > 0 ? paths.join(", ") : "staged changes";

      try {
        console.log(`Reviewing: ${targetDescription}\n`);

        const result = await client.submitTask({
          title: `Code review: ${targetDescription}`,
          description: `Review the following files/changes: ${targetDescription}`,
          projectId,
          mode: "ask",
        });

        const findings: ReviewFinding[] = [];

        const stream = client.streamSession(result.sessionId, (event) => {
          const handlers: Record<string, () => void> = {
            token: () => {
              process.stdout.write(
                String((event.data as { content: string }).content)
              );
            },
            review_finding: () => {
              findings.push(event.data as ReviewFinding);
            },
            complete: () => {
              printReviewSummary(findings, opts.severity);
              stream.close();
              const hasCritical = findings.some(
                (f) => f.severity === "critical"
              );
              process.exit(hasCritical ? 1 : 0);
            },
          };
          handlers[event.type]?.();
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Error: ${msg}`);
        process.exit(1);
      }
    }
  );
