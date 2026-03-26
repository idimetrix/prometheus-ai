import { execSync } from "node:child_process";
import { Command } from "commander";
import { APIClient } from "../api-client";
import { resolveConfig } from "../config";

interface _PullRequest {
  author: string;
  baseBranch: string;
  draft: boolean;
  headBranch: string;
  number: number;
  status: string;
  title: string;
  updatedAt: string;
  url: string;
}

interface _CICheck {
  name: string;
  status: "success" | "failure" | "pending" | "running";
}

function getCheckIcon(status: string): string {
  const icons: Record<string, string> = {
    success: "[PASS]",
    failure: "[FAIL]",
    pending: "[WAIT]",
    running: "[...]",
  };
  return icons[status] ?? "[   ]";
}

function getCurrentBranch(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "HEAD";
  }
}

function getDefaultBaseBranch(): string {
  try {
    const remote = execSync(
      "git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || echo refs/remotes/origin/main",
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
    return remote.replace("refs/remotes/origin/", "");
  } catch {
    return "main";
  }
}

interface PrCreateOpts {
  apiKey?: string;
  apiUrl?: string;
  base?: string;
  draft?: boolean;
  project?: string;
  title?: string;
}

interface PrListOpts {
  apiKey?: string;
  apiUrl?: string;
  project?: string;
}

interface PrStatusOpts {
  apiKey?: string;
  apiUrl?: string;
  project?: string;
}

function requireProjectId(config: { projectId?: string }): string {
  if (!config.projectId) {
    console.error(
      "Error: Project ID required. Use --project or set PROMETHEUS_PROJECT_ID"
    );
    process.exit(1);
  }
  return config.projectId;
}

export const prCommand = new Command("pr").description(
  "Manage pull requests for the current project"
);

prCommand
  .command("create")
  .description("Create a pull request from the current branch")
  .option("-t, --title <title>", "PR title")
  .option("-b, --base <branch>", "Base branch (default: main)")
  .option("-d, --draft", "Create as draft PR")
  .option("-p, --project <id>", "Project ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (opts: PrCreateOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = requireProjectId(config);

    const headBranch = getCurrentBranch();
    const baseBranch = opts.base ?? getDefaultBaseBranch();
    const title = opts.title ?? `PR from ${headBranch}`;

    try {
      console.log(`Creating PR: ${title}`);
      console.log(`  ${headBranch} -> ${baseBranch}`);
      if (opts.draft) {
        console.log("  (draft)");
      }

      const result = await client.createPullRequest({
        projectId,
        title,
        headBranch,
        baseBranch,
        draft: opts.draft === true,
      });

      console.log(`\nPR #${result.number} created`);
      console.log(`URL: ${result.url}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

prCommand
  .command("list")
  .description("List pull requests for the project")
  .option("-p, --project <id>", "Project ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (opts: PrListOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = requireProjectId(config);

    try {
      const prs = await client.listPullRequests(projectId);

      if (prs.length === 0) {
        console.log("No open pull requests.");
        return;
      }

      console.log("Pull Requests:\n");
      for (const pr of prs) {
        const draftTag = pr.draft ? " [DRAFT]" : "";
        const statusTag = pr.status === "open" ? "" : ` (${pr.status})`;
        console.log(`  #${pr.number} ${pr.title}${draftTag}${statusTag}`);
        console.log(
          `    ${pr.headBranch} -> ${pr.baseBranch}  by ${pr.author}`
        );
      }
      console.log(`\n${prs.length} pull request(s)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });

prCommand
  .command("status <number>")
  .description("Show PR status with CI checks")
  .option("-p, --project <id>", "Project ID")
  .option("--api-url <url>", "Prometheus API URL")
  .option("--api-key <key>", "Prometheus API key")
  .action(async (prNumber: string, opts: PrStatusOpts) => {
    const config = resolveConfig({
      apiUrl: opts.apiUrl,
      apiKey: opts.apiKey,
      project: opts.project,
    });
    const client = new APIClient(config);
    const projectId = requireProjectId(config);
    const num = Number.parseInt(prNumber, 10);

    if (Number.isNaN(num)) {
      console.error("Error: PR number must be a valid number");
      process.exit(1);
    }

    try {
      const pr = await client.getPullRequestStatus(projectId, num);

      console.log(`PR #${pr.number}: ${pr.title}\n`);
      console.log(`  Status:  ${pr.status}`);
      console.log(`  Branch:  ${pr.headBranch} -> ${pr.baseBranch}`);
      console.log(`  Author:  ${pr.author}`);
      console.log(`  URL:     ${pr.url}`);

      if (pr.checks && pr.checks.length > 0) {
        console.log("\n  CI Checks:");
        for (const check of pr.checks) {
          console.log(`    ${getCheckIcon(check.status)} ${check.name}`);
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${msg}`);
      process.exit(1);
    }
  });
