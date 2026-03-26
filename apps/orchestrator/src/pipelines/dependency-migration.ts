/**
 * Dependency Migration Pipeline (MOON-007)
 *
 * Migrates a major dependency version (e.g., React 18 -> 19).
 * 1. Read migration guide from official docs
 * 2. Analyze current usage of deprecated APIs
 * 3. Create migration plan with file-by-file changes
 * 4. Execute changes progressively
 * 5. Run tests after each batch
 * 6. Fix breaking changes iteratively
 * 7. Update related configs (tsconfig, eslint, etc.)
 */

import { createLogger } from "@prometheus/logger";
import {
  modelRouterClient,
  projectBrainClient,
  sandboxManagerClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:dependency-migration");

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;
const CODE_FENCE_RE = /^```[\w]*\n?/;
const CODE_FENCE_END_RE = /\n?```$/;
const PASS_COUNT_RE = /(\d+)\s*pass/i;
const FAIL_COUNT_RE = /(\d+)\s*fail/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DependencyMigrationOptions {
  /** The dependency to migrate (e.g., "react") */
  dependency: string;
  /** If true, analyze without applying changes */
  dryRun?: boolean;
  /** Current version (e.g., "18.2.0") */
  fromVersion: string;
  /** The Prometheus project ID */
  projectId: string;
  /** Target version (e.g., "19.0.0") */
  toVersion: string;
}

export interface BreakingChange {
  /** What changed */
  change: string;
  /** The affected file */
  file: string;
  /** Whether the change was resolved */
  resolved: boolean;
}

export interface DependencyMigrationResult {
  /** Breaking changes found and their resolution status */
  breakingChanges: BreakingChange[];
  /** Total files changed */
  filesChanged: number;
  /** Whether the migration completed successfully */
  migrationComplete: boolean;
  /** Test results after migration */
  testResults: { failed: number; passed: number };
}

interface MigrationGuide {
  breakingChanges: Array<{
    description: string;
    migration: string;
    oldApi: string;
  }>;
  configChanges: string[];
  newApis: string[];
}

interface MigrationPlan {
  batches: Array<{
    changes: Array<{
      change: string;
      file: string;
    }>;
    description: string;
  }>;
  configUpdates: string[];
}

interface FileChange {
  content: string;
  path: string;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class DependencyMigrationPipeline {
  private readonly sandboxId: string;

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId;
  }

  /**
   * Migrate a dependency from one major version to another.
   */
  async migrate(
    options: DependencyMigrationOptions
  ): Promise<DependencyMigrationResult> {
    const logCtx = {
      dependency: options.dependency,
      fromVersion: options.fromVersion,
      projectId: options.projectId,
      toVersion: options.toVersion,
    };

    logger.info(logCtx, "Starting dependency migration");

    const allBreakingChanges: BreakingChange[] = [];
    let totalFilesChanged = 0;
    let testResults = { passed: 0, failed: 0 };

    try {
      // Step 1: Fetch migration guide knowledge
      const guide = await this.fetchMigrationGuide(
        options.dependency,
        options.fromVersion,
        options.toVersion
      );
      logger.info(
        {
          ...logCtx,
          breakingChanges: guide.breakingChanges.length,
          configChanges: guide.configChanges.length,
        },
        "Migration guide loaded"
      );

      // Step 2: Analyze current usage of deprecated APIs
      const affectedFiles = await this.analyzeCurrentUsage(
        options.projectId,
        options.dependency,
        guide
      );
      logger.info(
        { ...logCtx, affectedFiles: affectedFiles.length },
        "Usage analysis complete"
      );

      // Step 3: Create migration plan
      const plan = await this.createMigrationPlan(
        options,
        guide,
        affectedFiles
      );
      const totalChanges = plan.batches.reduce(
        (sum, b) => sum + b.changes.length,
        0
      );
      logger.info(
        {
          ...logCtx,
          batches: plan.batches.length,
          totalChanges,
        },
        "Migration plan created"
      );

      if (options.dryRun) {
        // In dry run mode, return the plan without applying changes
        const dryRunBreaking = plan.batches.flatMap((b) =>
          b.changes.map((c) => ({
            file: c.file,
            change: c.change,
            resolved: false,
          }))
        );

        return {
          filesChanged: 0,
          breakingChanges: dryRunBreaking,
          testResults: { passed: 0, failed: 0 },
          migrationComplete: false,
        };
      }

      // Step 4: Update the dependency version in package.json
      await this.updateDependencyVersion(options);

      // Step 5: Execute changes progressively, batch by batch
      for (const batch of plan.batches) {
        logger.info(
          { ...logCtx, batch: batch.description },
          "Executing migration batch"
        );

        const changes = await this.executeBatch(batch, options, guide);
        totalFilesChanged += changes.length;

        for (const change of changes) {
          await this.writeToSandbox(change.path, change.content);
        }

        // Record breaking changes
        for (const c of batch.changes) {
          allBreakingChanges.push({
            file: c.file,
            change: c.change,
            resolved: changes.some((ch) => ch.path === c.file),
          });
        }

        // Step 5b: Run tests after each batch
        testResults = await this.runTests();
        logger.info(
          {
            ...logCtx,
            batch: batch.description,
            passed: testResults.passed,
            failed: testResults.failed,
          },
          "Post-batch test results"
        );

        // Step 6: Fix breaking test failures
        if (testResults.failed > 0) {
          const fixes = await this.fixBreakingTests(testResults, changes);
          for (const fix of fixes) {
            await this.writeToSandbox(fix.path, fix.content);
          }
          totalFilesChanged += fixes.length;

          // Re-run tests after fixes
          testResults = await this.runTests();
        }
      }

      // Step 7: Update related configs
      if (plan.configUpdates.length > 0) {
        const configChanges = await this.updateConfigs(
          plan.configUpdates,
          options
        );
        for (const change of configChanges) {
          await this.writeToSandbox(change.path, change.content);
        }
        totalFilesChanged += configChanges.length;
      }

      // Final test run
      testResults = await this.runTests();

      const migrationComplete =
        testResults.failed === 0 &&
        allBreakingChanges.every((bc) => bc.resolved);

      logger.info(
        {
          ...logCtx,
          filesChanged: totalFilesChanged,
          migrationComplete,
          testsPassed: testResults.passed,
          testsFailed: testResults.failed,
        },
        "Dependency migration complete"
      );

      return {
        filesChanged: totalFilesChanged,
        breakingChanges: allBreakingChanges,
        testResults,
        migrationComplete,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "Dependency migration failed");

      return {
        filesChanged: totalFilesChanged,
        breakingChanges: allBreakingChanges,
        testResults,
        migrationComplete: false,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step implementations
  // -------------------------------------------------------------------------

  /**
   * Fetch migration guide knowledge from the LLM.
   */
  private async fetchMigrationGuide(
    dependency: string,
    fromVersion: string,
    toVersion: string
  ): Promise<MigrationGuide> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `You are an expert on ${dependency}. Provide a migration guide from version ${fromVersion} to ${toVersion}.

Output a JSON object with:
- "breakingChanges": Array<{ oldApi: string, description: string, migration: string }> — each breaking change and how to migrate
- "newApis": string[] — new APIs introduced that should be adopted
- "configChanges": string[] — config files that need updating (tsconfig, eslint, etc.)

Output ONLY the JSON object, no other text.`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "{}";
      const jsonMatch = content.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as MigrationGuide;
      }
    } catch (error) {
      logger.warn({ error }, "Migration guide fetch failed");
    }

    return { breakingChanges: [], newApis: [], configChanges: [] };
  }

  /**
   * Analyze current usage of the dependency to find affected files.
   */
  private async analyzeCurrentUsage(
    projectId: string,
    dependency: string,
    guide: MigrationGuide
  ): Promise<Array<{ content: string; path: string }>> {
    try {
      const deprecatedApis = guide.breakingChanges
        .map((bc) => bc.oldApi)
        .join(" ");

      const searchQuery = `${dependency} ${deprecatedApis}`.slice(0, 500);

      const response = await projectBrainClient.post<{
        files: Array<{ content: string; path: string }>;
      }>(`/api/projects/${projectId}/search`, {
        query: searchQuery,
        maxFiles: 50,
      });

      return response.data.files;
    } catch (error) {
      logger.warn({ error }, "Usage analysis search failed");
      return [];
    }
  }

  /**
   * Create a migration plan organized into batches.
   */
  private async createMigrationPlan(
    options: DependencyMigrationOptions,
    guide: MigrationGuide,
    affectedFiles: Array<{ content: string; path: string }>
  ): Promise<MigrationPlan> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Create a migration plan for ${options.dependency} from ${options.fromVersion} to ${options.toVersion}.

Breaking changes:
${guide.breakingChanges.map((bc) => `- ${bc.oldApi}: ${bc.description} -> ${bc.migration}`).join("\n")}

Affected files:
${affectedFiles.map((f) => `- ${f.path}`).join("\n")}

Config changes needed:
${guide.configChanges.join("\n")}

Group changes into batches that can be applied and tested independently.
Order batches by dependency (infrastructure first, then features).

Output a JSON object with:
- "batches": Array<{ description: string, changes: Array<{ file: string, change: string }> }>
- "configUpdates": string[] — config files to update

Output ONLY the JSON object, no other text.`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "{}";
      const jsonMatch = content.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as MigrationPlan;
      }
    } catch (error) {
      logger.warn({ error }, "Migration plan creation failed");
    }

    return { batches: [], configUpdates: [] };
  }

  /**
   * Execute a single batch of migration changes.
   */
  private async executeBatch(
    batch: MigrationPlan["batches"][number],
    options: DependencyMigrationOptions,
    guide: MigrationGuide
  ): Promise<FileChange[]> {
    const results: FileChange[] = [];

    for (const change of batch.changes) {
      try {
        // Fetch current file content from sandbox
        const currentContent = await this.readFromSandbox(change.file);

        const response = await modelRouterClient.post<{
          choices: Array<{ message: { content: string } }>;
        }>("/route", {
          slot: "default",
          messages: [
            {
              role: "user",
              content: `Apply migration changes to this file for ${options.dependency} ${options.fromVersion} -> ${options.toVersion}.

File: ${change.file}
Required change: ${change.change}

Migration rules:
${guide.breakingChanges.map((bc) => `- Replace ${bc.oldApi}: ${bc.migration}`).join("\n")}

Current file content:
${currentContent || "File not found — create it if needed."}

Output ONLY the complete updated file content, no markdown code fences, no explanation.`,
            },
          ],
          options: { maxTokens: 8192, temperature: 0.1 },
        });

        const content = response.data.choices[0]?.message.content ?? "";
        if (content) {
          const cleaned = content
            .replace(CODE_FENCE_RE, "")
            .replace(CODE_FENCE_END_RE, "");
          results.push({ path: change.file, content: cleaned });
        }
      } catch (error) {
        logger.warn({ error, file: change.file }, "Failed to migrate file");
      }
    }

    return results;
  }

  /**
   * Update the dependency version in package.json.
   */
  private async updateDependencyVersion(
    options: DependencyMigrationOptions
  ): Promise<void> {
    try {
      await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/exec`, {
        command: `npm install ${options.dependency}@${options.toVersion}`,
        timeout: 60_000,
      });
    } catch (error) {
      logger.warn({ error }, "Failed to update dependency version");
    }
  }

  /**
   * Run tests in the sandbox and return results.
   */
  private async runTests(): Promise<{ failed: number; passed: number }> {
    try {
      const result = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "npm test -- --reporter=json",
        timeout: 120_000,
      });

      const output = result.data.stdout + result.data.stderr;
      const passMatch = output.match(PASS_COUNT_RE);
      const failMatch = output.match(FAIL_COUNT_RE);

      return {
        passed: passMatch ? Number.parseInt(passMatch[1] ?? "0", 10) : 0,
        failed: failMatch ? Number.parseInt(failMatch[1] ?? "0", 10) : 0,
      };
    } catch (error) {
      logger.warn({ error }, "Test run failed");
      return { passed: 0, failed: 0 };
    }
  }

  /**
   * Attempt to fix tests broken by the migration.
   */
  private async fixBreakingTests(
    _testResults: { failed: number; passed: number },
    recentChanges: FileChange[]
  ): Promise<FileChange[]> {
    try {
      // Get test output for diagnostics
      const testOutput = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "npm test 2>&1 || true",
        timeout: 120_000,
      });

      const errorOutput = (
        testOutput.data.stdout + testOutput.data.stderr
      ).slice(0, 4000);

      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Fix the failing tests after a dependency migration.

Test output:
${errorOutput}

Recently changed files:
${recentChanges.map((f) => `- ${f.path}`).join("\n")}

Output a JSON array of fixed files, each with "path" and "content".
Output ONLY the JSON array, no other text.`,
          },
        ],
        options: { maxTokens: 8192, temperature: 0.1 },
      });

      const content = response.data.choices[0]?.message.content ?? "[]";
      const jsonMatch = content.match(JSON_ARRAY_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as FileChange[];
        return parsed.filter((f) => f.path && f.content);
      }
    } catch (error) {
      logger.warn({ error }, "Test fix generation failed");
    }

    return [];
  }

  /**
   * Update configuration files (tsconfig, eslint, etc.).
   */
  private async updateConfigs(
    configFiles: string[],
    options: DependencyMigrationOptions
  ): Promise<FileChange[]> {
    const results: FileChange[] = [];

    for (const configFile of configFiles) {
      try {
        const currentContent = await this.readFromSandbox(configFile);

        const response = await modelRouterClient.post<{
          choices: Array<{ message: { content: string } }>;
        }>("/route", {
          slot: "default",
          messages: [
            {
              role: "user",
              content: `Update this configuration file for ${options.dependency} ${options.toVersion}.

File: ${configFile}
Current content:
${currentContent || "File not found — create it if needed."}

Output ONLY the updated file content, no markdown code fences.`,
            },
          ],
          options: { maxTokens: 4096, temperature: 0.1 },
        });

        const content = response.data.choices[0]?.message.content ?? "";
        if (content) {
          const cleaned = content
            .replace(CODE_FENCE_RE, "")
            .replace(CODE_FENCE_END_RE, "");
          results.push({ path: configFile, content: cleaned });
        }
      } catch (error) {
        logger.warn({ error, configFile }, "Failed to update config");
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Sandbox helpers
  // -------------------------------------------------------------------------

  private async writeToSandbox(path: string, content: string): Promise<void> {
    try {
      await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/files`, {
        path,
        content,
      });
    } catch (error) {
      logger.warn({ error, path }, "Failed to write file to sandbox");
    }
  }

  private async readFromSandbox(path: string): Promise<string> {
    try {
      const response = await sandboxManagerClient.get<{ content: string }>(
        `/sandboxes/${this.sandboxId}/files?path=${encodeURIComponent(path)}`
      );
      return response.data.content;
    } catch {
      return "";
    }
  }
}
