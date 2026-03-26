/**
 * Multi-Repo Coordinator
 *
 * Orchestrates agent execution across multiple repositories simultaneously.
 * Detects cross-repo tasks, plans changes across repos, executes agents in
 * parallel sandboxes, validates cross-repo consistency, creates linked PRs,
 * and supports rollback on failure.
 */
import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { FleetManager } from "../fleet-manager";
import type { SchedulableTask } from "../parallel/scheduler";
import {
  type APISurface,
  type BreakingChange,
  buildAPISurface,
  diffSurfaces,
  validateCrossRepoConsistency,
} from "./api-surface-analyzer";

const logger = createLogger("orchestrator:multi-repo-coordinator");

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface RepoDescriptor {
  defaultBranch: string;
  id: string;
  /** Provider access token for clone / PR creation */
  installationToken?: string;
  /** Human-readable name */
  name: string;
  /** Owner / org on the git host */
  owner: string;
  repoUrl: string;
}

export interface MultiRepoTaskInput {
  /** Free-form description of the change spanning repos */
  description: string;
  orgId: string;
  planTier: string;
  projectId: string;
  repos: RepoDescriptor[];
  sessionId: string;
  userId: string;
}

export interface RepoChangeSet {
  agentResults: AgentExecutionResult[];
  branchName: string;
  /** Populated after PR creation */
  prNumber?: number;
  /** Populated after PR creation */
  prUrl?: string;
  repo: RepoDescriptor;
  sandboxId: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "rolled_back";
  surfaceAfter?: APISurface;
  surfaceBefore?: APISurface;
}

export interface MultiRepoResult {
  breakingChanges: BreakingChange[];
  changeSets: RepoChangeSet[];
  crossRepoValid: boolean;
  id: string;
  status: "success" | "partial" | "failed" | "rolled_back";
}

/** Heuristic keywords that suggest multi-repo relevance per-repo */
const MULTI_REPO_HINT_KEYWORDS = [
  "api",
  "contract",
  "schema",
  "endpoint",
  "shared",
  "common",
  "types",
  "proto",
  "grpc",
  "graphql",
  "import",
  "dependency",
  "consumer",
  "provider",
  "client",
  "sdk",
];

interface ModelRouterResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface RepoPlan {
  agentRole: string;
  description: string;
  repoId: string;
  sharedContract?: string;
}

interface CrossRepoPlanResult {
  branchPrefix: string;
  plans: RepoPlan[];
  sharedContract: string;
}

/** Top-level regex for extracting JSON objects from model responses */
const JSON_OBJECT_RE = /\{[\s\S]*\}/;

/** Top-level regex for extracting PR numbers from GitHub URLs */
const PR_NUMBER_RE = /\/pull\/(\d+)/;

// ─── Sandbox manager HTTP helpers ───────────────────────────────────────────────

const SANDBOX_MANAGER_URL =
  process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006";
const MODEL_ROUTER_URL =
  process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

async function createSandbox(repoUrl: string, token?: string): Promise<string> {
  const response = await fetch(`${SANDBOX_MANAGER_URL}/sandboxes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getInternalAuthHeaders(),
    },
    body: JSON.stringify({ repoUrl, token }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to create sandbox: ${response.status} ${await response.text()}`
    );
  }

  const data = (await response.json()) as { sandboxId: string };
  return data.sandboxId;
}

async function destroySandbox(sandboxId: string): Promise<void> {
  try {
    await fetch(`${SANDBOX_MANAGER_URL}/sandboxes/${sandboxId}`, {
      method: "DELETE",
      headers: getInternalAuthHeaders(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.warn({ sandboxId, error: msg }, "Failed to destroy sandbox");
  }
}

async function execInSandbox(
  sandboxId: string,
  command: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const response = await fetch(
    `${SANDBOX_MANAGER_URL}/sandboxes/${sandboxId}/exec`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({ command, timeout: 60_000 }),
    }
  );

  if (!response.ok) {
    return { exitCode: 1, stdout: "", stderr: `HTTP ${response.status}` };
  }

  return (await response.json()) as {
    exitCode: number;
    stdout: string;
    stderr: string;
  };
}

async function readSandboxFile(
  sandboxId: string,
  filePath: string
): Promise<string | null> {
  const result = await execInSandbox(sandboxId, `cat ${filePath}`);
  if (result.exitCode !== 0) {
    return null;
  }
  return result.stdout;
}

// ─── MultiRepoCoordinator ───────────────────────────────────────────────────────

export class MultiRepoCoordinator {
  private readonly eventPublisher = new EventPublisher();

  /**
   * Detect whether a task description likely requires multi-repo changes.
   *
   * Uses a combination of heuristics and, when available, the model router
   * for more nuanced classification.
   */
  async detectMultiRepoTask(
    description: string,
    repos: RepoDescriptor[]
  ): Promise<{
    isMultiRepo: boolean;
    affectedRepoIds: string[];
    confidence: number;
    reason: string;
  }> {
    if (repos.length <= 1) {
      return {
        isMultiRepo: false,
        affectedRepoIds: repos.map((r) => r.id),
        confidence: 1,
        reason: "Only one repository in project",
      };
    }

    // Heuristic: keyword-based detection
    const lowerDesc = description.toLowerCase();
    const matchedKeywords = MULTI_REPO_HINT_KEYWORDS.filter((kw) =>
      lowerDesc.includes(kw)
    );

    // Check if specific repo names are mentioned
    const mentionedRepos = repos.filter(
      (r) =>
        lowerDesc.includes(r.name.toLowerCase()) ||
        lowerDesc.includes(r.owner.toLowerCase())
    );

    // Try LLM classification for better accuracy
    try {
      const llmResult = await this.classifyWithModel(description, repos);
      return llmResult;
    } catch {
      // Fall back to heuristic
      const heuristicScore =
        matchedKeywords.length * 0.15 + mentionedRepos.length * 0.25;
      const isMultiRepo = heuristicScore >= 0.3;

      let affectedRepoIds: string[];
      if (!isMultiRepo) {
        affectedRepoIds = repos.slice(0, 1).map((r) => r.id);
      } else if (mentionedRepos.length > 0) {
        affectedRepoIds = mentionedRepos.map((r) => r.id);
      } else {
        affectedRepoIds = repos.map((r) => r.id);
      }

      return {
        isMultiRepo,
        affectedRepoIds,
        confidence: Math.min(heuristicScore, 1),
        reason: isMultiRepo
          ? `Heuristic: matched keywords [${matchedKeywords.join(", ")}], mentioned repos [${mentionedRepos.map((r) => r.name).join(", ")}]`
          : "Heuristic: low multi-repo signal",
      };
    }
  }

  /**
   * Generate a cross-repo execution plan: determine which repos need changes,
   * what agent role should work on each, and what shared contracts exist.
   */
  async planCrossRepoChanges(
    input: MultiRepoTaskInput
  ): Promise<CrossRepoPlanResult> {
    const branchPrefix = `prometheus/${generateId("mr")}`;

    try {
      const llmPlan = await this.planWithModel(input, branchPrefix);
      return llmPlan;
    } catch {
      // Fallback: assign backend_coder to every repo
      const plans: RepoPlan[] = input.repos.map((repo) => ({
        repoId: repo.id,
        description: `${input.description} in ${repo.name}`,
        agentRole: "backend_coder",
      }));

      return {
        branchPrefix,
        sharedContract: "",
        plans,
      };
    }
  }

  /**
   * Execute the full multi-repo orchestration flow:
   *
   * 1. Plan cross-repo changes
   * 2. Create sandboxes and clone repos in parallel
   * 3. Capture API surface snapshots (before)
   * 4. Dispatch fleet agents to each repo in parallel
   * 5. Capture API surface snapshots (after)
   * 6. Validate cross-repo consistency
   * 7. Create linked PRs
   * 8. Rollback on failure if needed
   */
  async execute(input: MultiRepoTaskInput): Promise<MultiRepoResult> {
    const resultId = generateId("mrr");
    const changeSets: RepoChangeSet[] = [];

    logger.info(
      {
        resultId,
        sessionId: input.sessionId,
        repoCount: input.repos.length,
        description: input.description.slice(0, 120),
      },
      "Starting multi-repo orchestration"
    );

    await this.publishEvent(input.sessionId, "multi_repo_started", {
      resultId,
      repos: input.repos.map((r) => r.name),
    });

    // Step 1: Plan
    const plan = await this.planCrossRepoChanges(input);

    logger.info(
      {
        resultId,
        planCount: plan.plans.length,
        branchPrefix: plan.branchPrefix,
      },
      "Cross-repo plan generated"
    );

    // Step 2: Create sandboxes in parallel
    const sandboxPromises = input.repos.map(async (repo) => {
      const sandboxId = await createSandbox(
        repo.repoUrl,
        repo.installationToken
      );

      const changeSet: RepoChangeSet = {
        repo,
        sandboxId,
        branchName: `${plan.branchPrefix}/${repo.name}`,
        status: "pending",
        agentResults: [],
      };
      changeSets.push(changeSet);
      return changeSet;
    });

    try {
      await Promise.all(sandboxPromises);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ resultId, error: msg }, "Failed to create sandboxes");
      await this.cleanupSandboxes(changeSets);
      return {
        id: resultId,
        status: "failed",
        changeSets,
        breakingChanges: [],
        crossRepoValid: false,
      };
    }

    // Step 3: Create branches and capture before-surfaces in parallel
    await Promise.all(
      changeSets.map(async (cs) => {
        await execInSandbox(
          cs.sandboxId,
          `cd /workspace/repo && git checkout -b '${cs.branchName}'`
        );
        cs.surfaceBefore = await this.captureAPISurface(
          cs.sandboxId,
          cs.repo.id,
          "before"
        );
      })
    );

    // Step 4: Execute agents in parallel per repo
    await this.publishEvent(input.sessionId, "multi_repo_executing", {
      resultId,
      repos: changeSets.map((cs) => ({
        name: cs.repo.name,
        sandboxId: cs.sandboxId,
      })),
    });

    const agentPromises = changeSets.map(async (cs) => {
      cs.status = "in_progress";
      const repoPlan = plan.plans.find((p) => p.repoId === cs.repo.id);
      if (!repoPlan) {
        cs.status = "completed";
        return;
      }

      try {
        const fleet = new FleetManager({
          sessionId: input.sessionId,
          projectId: input.projectId,
          orgId: input.orgId,
          userId: input.userId,
          planTier: input.planTier,
        });

        const task: SchedulableTask = {
          id: generateId("mrt"),
          title: `[${cs.repo.name}] ${repoPlan.description.slice(0, 80)}`,
          agentRole: repoPlan.agentRole,
          dependencies: [],
          effort: "medium",
        };

        const blueprint = this.buildBlueprint(
          input.description,
          plan.sharedContract,
          cs.repo
        );

        const results = await fleet.executeTasks([task], blueprint);
        cs.agentResults = results;
        cs.status = results.every((r) => r.success) ? "completed" : "failed";
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { resultId, repo: cs.repo.name, error: msg },
          "Agent execution failed for repo"
        );
        cs.status = "failed";
        cs.agentResults = [
          {
            success: false,
            output: "",
            filesChanged: [],
            tokensUsed: { input: 0, output: 0 },
            toolCalls: 0,
            steps: 0,
            creditsConsumed: 0,
            error: msg,
          },
        ];
      }
    });

    await Promise.all(agentPromises);

    // Step 5: Capture after-surfaces
    await Promise.all(
      changeSets.map(async (cs) => {
        if (cs.status === "completed") {
          cs.surfaceAfter = await this.captureAPISurface(
            cs.sandboxId,
            cs.repo.id,
            "after"
          );
        }
      })
    );

    // Step 6: Validate cross-repo consistency
    const breakingChanges = this.validateConsistency(changeSets);
    const crossRepoValid = breakingChanges.every(
      (bc) => bc.severity !== "error"
    );

    logger.info(
      {
        resultId,
        breakingChanges: breakingChanges.length,
        crossRepoValid,
      },
      "Cross-repo consistency validation complete"
    );

    // Step 7: Create linked PRs (only if valid or no breaking errors)
    if (crossRepoValid) {
      await this.createLinkedPRs(changeSets, input.description, resultId);
    }

    // Step 8: Determine overall status
    const _completedCount = changeSets.filter(
      (cs) => cs.status === "completed"
    ).length;
    const failedCount = changeSets.filter(
      (cs) => cs.status === "failed"
    ).length;

    let status: MultiRepoResult["status"];
    if (failedCount === changeSets.length) {
      status = "failed";
    } else if (failedCount > 0) {
      status = "partial";
    } else {
      status = "success";
    }

    // If not valid, consider rollback
    if (!crossRepoValid) {
      logger.warn(
        { resultId, breakingChanges: breakingChanges.length },
        "Breaking changes detected, marking for review"
      );
    }

    await this.publishEvent(input.sessionId, "multi_repo_completed", {
      resultId,
      status,
      crossRepoValid,
      breakingChanges: breakingChanges.length,
      prs: changeSets
        .filter((cs) => cs.prUrl)
        .map((cs) => ({ repo: cs.repo.name, prUrl: cs.prUrl })),
    });

    // Cleanup sandboxes
    await this.cleanupSandboxes(changeSets);

    return {
      id: resultId,
      status,
      changeSets,
      breakingChanges,
      crossRepoValid,
    };
  }

  /**
   * Rollback all changes across repos by deleting remote branches.
   */
  async rollback(changeSets: RepoChangeSet[]): Promise<void> {
    logger.info(
      { repoCount: changeSets.length },
      "Rolling back multi-repo changes"
    );

    const rollbackPromises = changeSets.map(async (cs) => {
      try {
        // Delete the remote branch
        const result = await execInSandbox(
          cs.sandboxId,
          `cd /workspace/repo && git push origin --delete '${cs.branchName}' 2>/dev/null || true`
        );

        if (result.exitCode === 0) {
          cs.status = "rolled_back";
          logger.info(
            { repo: cs.repo.name, branch: cs.branchName },
            "Branch rolled back"
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { repo: cs.repo.name, error: msg },
          "Rollback failed for repo"
        );
      }
    });

    await Promise.all(rollbackPromises);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async classifyWithModel(
    description: string,
    repos: RepoDescriptor[]
  ): Promise<{
    isMultiRepo: boolean;
    affectedRepoIds: string[];
    confidence: number;
    reason: string;
  }> {
    const repoList = repos.map((r) => `- ${r.name} (${r.repoUrl})`).join("\n");

    const response = await fetch(`${MODEL_ROUTER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        model: "default",
        messages: [
          {
            role: "system",
            content: `You classify software tasks as single-repo or multi-repo. Respond ONLY with JSON:
{"isMultiRepo": boolean, "affectedRepoIds": ["id1", ...], "confidence": 0.0-1.0, "reason": "explanation"}`,
          },
          {
            role: "user",
            content: `Repositories:\n${repoList}\n\nRepo IDs: ${JSON.stringify(repos.map((r) => ({ id: r.id, name: r.name })))}\n\nTask: ${description}`,
          },
        ],
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      throw new Error(`Model router returned ${response.status}`);
    }

    const data = (await response.json()) as ModelRouterResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(JSON_OBJECT_RE);
    if (!jsonMatch) {
      throw new Error("No JSON in model response");
    }

    return JSON.parse(jsonMatch[0]) as {
      isMultiRepo: boolean;
      affectedRepoIds: string[];
      confidence: number;
      reason: string;
    };
  }

  private async planWithModel(
    input: MultiRepoTaskInput,
    branchPrefix: string
  ): Promise<CrossRepoPlanResult> {
    const repoList = input.repos
      .map((r) => `- ${r.id}: ${r.name} (${r.repoUrl})`)
      .join("\n");

    const response = await fetch(`${MODEL_ROUTER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: JSON.stringify({
        model: "default",
        messages: [
          {
            role: "system",
            content: `You are a cross-repo change planner. Given a task and repos, plan changes for each repo.
Respond ONLY with JSON:
{
  "plans": [{"repoId": "id", "description": "what to do in this repo", "agentRole": "backend_coder|frontend_coder|architect|test_engineer", "sharedContract": "optional type/interface definition"}],
  "sharedContract": "TypeScript interface or API contract shared across repos"
}`,
          },
          {
            role: "user",
            content: `Repositories:\n${repoList}\n\nTask: ${input.description}`,
          },
        ],
        temperature: 0.2,
      }),
    });

    if (!response.ok) {
      throw new Error(`Model router returned ${response.status}`);
    }

    const data = (await response.json()) as ModelRouterResponse;
    const content = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = content.match(JSON_OBJECT_RE);
    if (!jsonMatch) {
      throw new Error("No JSON in model response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      plans: RepoPlan[];
      sharedContract: string;
    };

    return {
      branchPrefix,
      sharedContract: parsed.sharedContract ?? "",
      plans: parsed.plans ?? [],
    };
  }

  private buildBlueprint(
    description: string,
    sharedContract: string,
    repo: RepoDescriptor
  ): string {
    const lines = [
      `# Multi-Repo Change: ${repo.name}`,
      "",
      "## Task Description",
      description,
      "",
    ];

    if (sharedContract) {
      lines.push(
        "## Shared API Contract (must match across all repos)",
        "```typescript",
        sharedContract,
        "```",
        ""
      );
    }

    lines.push(
      "## Important",
      "- Ensure all exports and API endpoints match the shared contract above",
      "- Do not introduce breaking changes to existing APIs without updating the contract",
      `- Target branch for PR: ${repo.defaultBranch}`
    );

    return lines.join("\n");
  }

  private async captureAPISurface(
    sandboxId: string,
    repoId: string,
    label: string
  ): Promise<APISurface> {
    // Find TypeScript/JavaScript source files in the repo
    const findResult = await execInSandbox(
      sandboxId,
      `cd /workspace/repo && find src -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \\) 2>/dev/null | head -100`
    );

    const files = new Map<string, string>();
    const filePaths = findResult.stdout.trim().split("\n").filter(Boolean);

    // Read up to 50 files to build the surface
    const readLimit = Math.min(filePaths.length, 50);
    for (let i = 0; i < readLimit; i++) {
      const fp = filePaths[i];
      if (fp) {
        const content = await readSandboxFile(
          sandboxId,
          `/workspace/repo/${fp}`
        );
        if (content) {
          files.set(fp, content);
        }
      }
    }

    const surface = buildAPISurface(repoId, label, files);

    logger.debug(
      {
        repoId,
        label,
        exports: surface.exports.length,
        rest: surface.rest.length,
      },
      "API surface captured"
    );

    return surface;
  }

  private validateConsistency(changeSets: RepoChangeSet[]): BreakingChange[] {
    const allBreaking: BreakingChange[] = [];

    // Check per-repo surface diffs
    for (const cs of changeSets) {
      if (cs.surfaceBefore && cs.surfaceAfter) {
        const diff = diffSurfaces(cs.surfaceBefore, cs.surfaceAfter);
        allBreaking.push(...diff.breakingChanges);
      }
    }

    // Cross-repo consistency: for each completed repo, check that exports
    // referenced by other repos still exist
    const surfaceMap = new Map<string, APISurface>();
    for (const cs of changeSets) {
      if (cs.surfaceAfter) {
        surfaceMap.set(cs.repo.id, cs.surfaceAfter);
      }
    }

    // For each pair, check if consumer imports match provider exports
    for (const [providerId, providerSurface] of surfaceMap) {
      for (const [consumerId, consumerSurface] of surfaceMap) {
        if (providerId === consumerId) {
          continue;
        }

        // Build a list of imports from the consumer that reference the provider
        // Heuristic: exports with matching names across repos likely indicate
        // cross-repo dependency
        const providerExportNames = new Set(
          providerSurface.exports.map((e) => e.name)
        );
        const suspectedImports = consumerSurface.exports
          .filter((e) => providerExportNames.has(e.name))
          .map((e) => ({
            repoId: consumerId,
            importedName: e.name,
            fromModule: providerId,
          }));

        if (suspectedImports.length > 0) {
          const issues = validateCrossRepoConsistency(
            providerSurface,
            suspectedImports
          );
          allBreaking.push(...issues);
        }
      }
    }

    return allBreaking;
  }

  private async createLinkedPRs(
    changeSets: RepoChangeSet[],
    description: string,
    resultId: string
  ): Promise<void> {
    const completedSets = changeSets.filter((cs) => cs.status === "completed");

    if (completedSets.length === 0) {
      return;
    }

    // Build cross-reference body
    const crossRefLines = completedSets.map(
      (cs) => `- **${cs.repo.name}**: Branch \`${cs.branchName}\``
    );
    const crossRefBody = [
      "## Multi-Repo Change",
      "",
      `Orchestration ID: \`${resultId}\``,
      "",
      "### Linked Repositories",
      ...crossRefLines,
      "",
      "### Description",
      description,
      "",
      "---",
      "*Created by Prometheus Multi-Repo Coordinator*",
    ].join("\n");

    // Create PRs in parallel using `gh` CLI in sandboxes
    const prPromises = completedSets.map(async (cs) => {
      try {
        // Commit changes
        await execInSandbox(
          cs.sandboxId,
          "cd /workspace/repo && git add -A && git diff --cached --stat | head -1"
        );

        const commitResult = await execInSandbox(
          cs.sandboxId,
          `cd /workspace/repo && git add -A && git commit -m 'feat: ${description.slice(0, 50)} [multi-repo]' --allow-empty`
        );

        if (commitResult.exitCode !== 0) {
          logger.warn(
            { repo: cs.repo.name, stderr: commitResult.stderr },
            "Commit failed, may be empty"
          );
        }

        // Push the branch
        const pushResult = await execInSandbox(
          cs.sandboxId,
          `cd /workspace/repo && git push -u origin '${cs.branchName}'`
        );

        if (pushResult.exitCode !== 0) {
          logger.error(
            { repo: cs.repo.name, stderr: pushResult.stderr },
            "Push failed"
          );
          return;
        }

        // Create PR using gh CLI
        const title = `feat: ${description.slice(0, 60)} [${cs.repo.name}]`;
        const prResult = await execInSandbox(
          cs.sandboxId,
          `cd /workspace/repo && gh pr create --title '${title.replace(/'/g, "\\'")}' --body '${crossRefBody.replace(/'/g, "\\'")}' --base '${cs.repo.defaultBranch}'`
        );

        if (prResult.exitCode === 0) {
          const prUrl = prResult.stdout.trim();
          cs.prUrl = prUrl;
          // Extract PR number from URL
          const prNumMatch = prUrl.match(PR_NUMBER_RE);
          if (prNumMatch?.[1]) {
            cs.prNumber = Number.parseInt(prNumMatch[1], 10);
          }
          logger.info({ repo: cs.repo.name, prUrl }, "PR created for repo");
        } else {
          logger.warn(
            { repo: cs.repo.name, stderr: prResult.stderr },
            "PR creation failed"
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error(
          { repo: cs.repo.name, error: msg },
          "Failed to create PR for repo"
        );
      }
    });

    await Promise.all(prPromises);

    // After all PRs are created, update each PR body with actual PR URLs
    const prLinks = completedSets
      .filter((cs) => cs.prUrl)
      .map((cs) => `- [${cs.repo.name}](${cs.prUrl})`)
      .join("\n");

    if (prLinks) {
      for (const cs of completedSets) {
        if (cs.prNumber && cs.prUrl) {
          const updateBody = `${crossRefBody}\n\n### PR Links\n${prLinks}`;
          await execInSandbox(
            cs.sandboxId,
            `cd /workspace/repo && gh pr edit ${cs.prNumber} --body '${updateBody.replace(/'/g, "\\'")}' 2>/dev/null || true`
          );
        }
      }
    }
  }

  private async cleanupSandboxes(changeSets: RepoChangeSet[]): Promise<void> {
    await Promise.all(changeSets.map((cs) => destroySandbox(cs.sandboxId)));
  }

  private async publishEvent(
    sessionId: string,
    type: string,
    data: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.eventPublisher.publishSessionEvent(sessionId, {
        type: QueueEvents.AGENT_STATUS,
        data: { multiRepo: { type, ...data } },
        timestamp: new Date().toISOString(),
      });
    } catch {
      // Non-critical
    }
  }
}
