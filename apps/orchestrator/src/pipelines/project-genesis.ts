/**
 * Project Genesis Pipeline (MOON-001)
 *
 * Full project generation from a natural language specification.
 * Takes a spec like "Build a SaaS invoicing app with Stripe integration"
 * and orchestrates end-to-end project generation:
 *
 * 1. Discovery agent elicits requirements (5-question protocol)
 * 2. Architect agent designs system architecture
 * 3. Planner agent creates sprint plan
 * 4. Frontend/Backend/Integration coders implement
 * 5. Test engineer writes tests
 * 6. CI loop validates everything builds and tests pass
 * 7. Deploy engineer prepares deployment config
 */

import { createLogger } from "@prometheus/logger";
import { modelRouterClient, sandboxManagerClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:project-genesis");

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const JSON_ARRAY_RE = /\[[\s\S]*\]/;
const CODE_FENCE_RE = /^```[\w]*\n?/;
const CODE_FENCE_END_RE = /\n?```$/;
const TEST_FILE_EXT_RE = /\.tsx?$/;
const PASS_COUNT_RE = /(\d+)\s*pass/i;
const FAIL_COUNT_RE = /(\d+)\s*fail/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectGenesisOptions {
  /** Maximum credits to spend on generation */
  budget?: number;
  /** The Prometheus project ID */
  projectId: string;
  /** The sandbox ID for code execution */
  sandboxId: string;
  /** Preferred tech stack override (e.g., "Next.js + tRPC + Drizzle") */
  techStack?: string;
}

export interface ProjectGenesisResult {
  /** Whether the generated project is ready for deployment */
  deployReady: boolean;
  /** Number of files created */
  filesCreated: number;
  /** Whether the pipeline succeeded */
  success: boolean;
  /** Human-readable summary of what was generated */
  summary: string;
  /** Number of tests passing */
  testsPassing: number;
  /** Number of tests written */
  testsWritten: number;
}

interface DiscoveryResult {
  acceptanceCriteria: string[];
  coreFeatures: string[];
  dataEntities: string[];
  integrations: string[];
  techRecommendation: string;
}

interface ArchitectureResult {
  apiContracts: string;
  dbSchema: string;
  deployConfig: string;
  projectStructure: string[];
  summary: string;
}

interface SprintPlan {
  sprints: Array<{
    description: string;
    name: string;
    tasks: Array<{
      description: string;
      files: string[];
      role: "frontend" | "backend" | "integration" | "test" | "deploy";
    }>;
  }>;
}

interface GeneratedFile {
  content: string;
  path: string;
}

interface CIResult {
  buildPassed: boolean;
  errors: string[];
  testsFailed: number;
  testsPassed: number;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class ProjectGenesisPipeline {
  private readonly sandboxId: string;
  private creditsUsed = 0;

  constructor(sandboxId: string) {
    this.sandboxId = sandboxId;
  }

  /**
   * Generate a full project from a natural language specification.
   */
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: pipeline orchestration requires sequential multi-step logic
  async generate(
    spec: string,
    options: ProjectGenesisOptions
  ): Promise<ProjectGenesisResult> {
    const logCtx = {
      projectId: options.projectId,
      sandboxId: options.sandboxId,
    };
    const budget = options.budget ?? Number.POSITIVE_INFINITY;

    logger.info(
      { ...logCtx, spec: spec.slice(0, 200) },
      "Starting project genesis"
    );

    let totalFilesCreated = 0;
    let totalTestsWritten = 0;
    let totalTestsPassing = 0;
    let deployReady = false;

    try {
      // Phase 1: Discovery — elicit requirements from the spec
      const discovery = await this.runDiscovery(spec, options.techStack);
      logger.info(
        { ...logCtx, features: discovery.coreFeatures.length },
        "Discovery complete"
      );
      this.checkBudget(budget);

      // Phase 2: Architecture — design system from requirements
      const architecture = await this.designArchitecture(
        discovery,
        options.techStack
      );
      logger.info(
        { ...logCtx, files: architecture.projectStructure.length },
        "Architecture designed"
      );
      this.checkBudget(budget);

      // Phase 3: Sprint planning — create ordered implementation plan
      const plan = await this.createSprintPlan(discovery, architecture);
      const totalTasks = plan.sprints.reduce(
        (sum, s) => sum + s.tasks.length,
        0
      );
      logger.info(
        { ...logCtx, sprints: plan.sprints.length, tasks: totalTasks },
        "Sprint plan created"
      );
      this.checkBudget(budget);

      // Phase 4: Implementation — execute each sprint
      const allFiles: GeneratedFile[] = [];

      for (const sprint of plan.sprints) {
        logger.info({ ...logCtx, sprint: sprint.name }, "Executing sprint");

        for (const task of sprint.tasks) {
          this.checkBudget(budget);

          const files = await this.implementTask(
            task,
            discovery,
            architecture,
            allFiles
          );
          allFiles.push(...files);
          totalFilesCreated += files.length;

          // Write files to sandbox
          for (const file of files) {
            await this.writeToSandbox(file.path, file.content);
          }
        }
      }

      logger.info(
        { ...logCtx, filesCreated: totalFilesCreated },
        "Implementation complete"
      );

      // Phase 5: Test generation
      const testFiles = await this.generateTests(allFiles, discovery);
      for (const file of testFiles) {
        await this.writeToSandbox(file.path, file.content);
      }
      totalTestsWritten = testFiles.length;
      totalFilesCreated += testFiles.length;

      logger.info(
        { ...logCtx, testsWritten: totalTestsWritten },
        "Test generation complete"
      );

      // Phase 6: CI validation loop (up to 3 attempts)
      let ciResult: CIResult = {
        buildPassed: false,
        testsPassed: 0,
        testsFailed: 0,
        errors: [],
      };
      const maxCIAttempts = 3;

      for (let attempt = 1; attempt <= maxCIAttempts; attempt++) {
        this.checkBudget(budget);

        ciResult = await this.runCIValidation();
        logger.info(
          {
            ...logCtx,
            attempt,
            buildPassed: ciResult.buildPassed,
            testsPassed: ciResult.testsPassed,
            testsFailed: ciResult.testsFailed,
          },
          "CI validation attempt"
        );

        if (ciResult.buildPassed && ciResult.testsFailed === 0) {
          break;
        }

        // Attempt to fix CI failures
        if (attempt < maxCIAttempts && ciResult.errors.length > 0) {
          const fixes = await this.fixCIErrors(ciResult.errors, allFiles);
          for (const fix of fixes) {
            await this.writeToSandbox(fix.path, fix.content);
          }
        }
      }

      totalTestsPassing = ciResult.testsPassed;

      // Phase 7: Deployment configuration
      if (ciResult.buildPassed) {
        const deployFiles = await this.generateDeployConfig(
          discovery,
          architecture
        );
        for (const file of deployFiles) {
          await this.writeToSandbox(file.path, file.content);
        }
        totalFilesCreated += deployFiles.length;
        deployReady = true;

        logger.info({ ...logCtx }, "Deployment config generated");
      }

      const summary = this.buildSummary(
        discovery,
        totalFilesCreated,
        totalTestsWritten,
        totalTestsPassing,
        deployReady
      );

      logger.info(
        {
          ...logCtx,
          filesCreated: totalFilesCreated,
          testsWritten: totalTestsWritten,
          testsPassing: totalTestsPassing,
          deployReady,
        },
        "Project genesis complete"
      );

      return {
        success: true,
        filesCreated: totalFilesCreated,
        testsWritten: totalTestsWritten,
        testsPassing: totalTestsPassing,
        deployReady,
        summary,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ ...logCtx, error: msg }, "Project genesis failed");

      return {
        success: false,
        filesCreated: totalFilesCreated,
        testsWritten: totalTestsWritten,
        testsPassing: totalTestsPassing,
        deployReady: false,
        summary: `Project genesis failed: ${msg}`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Phase implementations
  // -------------------------------------------------------------------------

  /**
   * Phase 1: Discovery — elicit structured requirements from natural language.
   * Uses a 5-question protocol to extract core features, data entities,
   * integrations, acceptance criteria, and tech recommendations.
   */
  private async runDiscovery(
    spec: string,
    techStack?: string
  ): Promise<DiscoveryResult> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `You are a senior software architect analyzing a project specification.
Extract structured requirements using this 5-question protocol:

1. What are the core features? (list each feature)
2. What data entities are needed? (list each entity with key fields)
3. What external integrations are required? (APIs, services, SDKs)
4. What are the acceptance criteria? (measurable outcomes)
5. What tech stack is best suited? ${techStack ? `The user prefers: ${techStack}` : "Recommend based on the spec."}

Project Specification:
${spec}

Output a JSON object with these fields:
- "coreFeatures": string[] — list of features
- "dataEntities": string[] — list of entities
- "integrations": string[] — list of integrations
- "acceptanceCriteria": string[] — list of criteria
- "techRecommendation": string — recommended tech stack

Output ONLY the JSON object, no other text.`,
          },
        ],
        options: { maxTokens: 2048, temperature: 0.2 },
      });
      this.creditsUsed += 1;

      const content = response.data.choices[0]?.message.content ?? "{}";
      const jsonMatch = content.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as DiscoveryResult;
      }
    } catch (error) {
      logger.warn({ error }, "Discovery LLM call failed, using defaults");
    }

    return {
      coreFeatures: [spec],
      dataEntities: [],
      integrations: [],
      acceptanceCriteria: [],
      techRecommendation: techStack ?? "Next.js + tRPC + Drizzle + PostgreSQL",
    };
  }

  /**
   * Phase 2: Architecture — design system structure from requirements.
   */
  private async designArchitecture(
    discovery: DiscoveryResult,
    techStack?: string
  ): Promise<ArchitectureResult> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `You are a senior software architect. Design a system architecture for the following requirements.

Tech Stack: ${techStack ?? discovery.techRecommendation}

Features:
${discovery.coreFeatures.map((f) => `- ${f}`).join("\n")}

Data Entities:
${discovery.dataEntities.map((e) => `- ${e}`).join("\n")}

Integrations:
${discovery.integrations.map((i) => `- ${i}`).join("\n")}

Output a JSON object with:
- "projectStructure": string[] — list of file paths to create
- "dbSchema": string — database schema definition
- "apiContracts": string — API route definitions
- "deployConfig": string — deployment configuration notes
- "summary": string — architecture overview

Output ONLY the JSON object, no other text.`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.1 },
      });
      this.creditsUsed += 1;

      const content = response.data.choices[0]?.message.content ?? "{}";
      const jsonMatch = content.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as ArchitectureResult;
      }
    } catch (error) {
      logger.warn({ error }, "Architecture design LLM call failed");
    }

    return {
      projectStructure: [],
      dbSchema: "",
      apiContracts: "",
      deployConfig: "",
      summary: "Architecture generation failed — using minimal defaults",
    };
  }

  /**
   * Phase 3: Sprint planning — create ordered implementation plan.
   */
  private async createSprintPlan(
    discovery: DiscoveryResult,
    architecture: ArchitectureResult
  ): Promise<SprintPlan> {
    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `You are a senior engineering manager. Create a sprint plan for implementing the following architecture.

Architecture:
${architecture.summary}

Files to create:
${architecture.projectStructure.map((f) => `- ${f}`).join("\n")}

DB Schema:
${architecture.dbSchema}

API Contracts:
${architecture.apiContracts}

Features:
${discovery.coreFeatures.map((f) => `- ${f}`).join("\n")}

Create sprints in dependency order. Each sprint has tasks, each task has:
- "role": "backend" | "frontend" | "integration" | "test" | "deploy"
- "description": what to implement
- "files": which files to create/modify

Output a JSON object with:
- "sprints": Array<{ name: string, description: string, tasks: Array<{ role, description, files }> }>

Output ONLY the JSON object, no other text.`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.1 },
      });
      this.creditsUsed += 1;

      const content = response.data.choices[0]?.message.content ?? "{}";
      const jsonMatch = content.match(JSON_OBJECT_RE);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as SprintPlan;
      }
    } catch (error) {
      logger.warn({ error }, "Sprint planning LLM call failed");
    }

    return { sprints: [] };
  }

  /**
   * Phase 4: Implement a single task — generate code files.
   */
  private async implementTask(
    task: SprintPlan["sprints"][number]["tasks"][number],
    discovery: DiscoveryResult,
    architecture: ArchitectureResult,
    existingFiles: GeneratedFile[]
  ): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    for (const filePath of task.files) {
      try {
        const existingContext = existingFiles
          .filter((f) => f.path !== filePath)
          .slice(-5)
          .map((f) => `### ${f.path}\n${f.content.slice(0, 500)}`)
          .join("\n\n");

        const response = await modelRouterClient.post<{
          choices: Array<{ message: { content: string } }>;
        }>("/route", {
          slot: "default",
          messages: [
            {
              role: "user",
              content: `Generate the complete file content for the following task.

Role: ${task.role}
File: ${filePath}
Task: ${task.description}

Architecture Summary:
${architecture.summary}

DB Schema:
${architecture.dbSchema.slice(0, 1000)}

API Contracts:
${architecture.apiContracts.slice(0, 1000)}

Features:
${discovery.coreFeatures.map((f) => `- ${f}`).join("\n")}

Existing files for context:
${existingContext || "No files yet."}

Output ONLY the file content, no markdown code fences, no explanation.`,
            },
          ],
          options: { maxTokens: 4096, temperature: 0.1 },
        });
        this.creditsUsed += 1;

        const content = response.data.choices[0]?.message.content ?? "";
        if (content) {
          const cleaned = content
            .replace(CODE_FENCE_RE, "")
            .replace(CODE_FENCE_END_RE, "");
          files.push({ path: filePath, content: cleaned });
        }
      } catch (error) {
        logger.warn({ error, filePath }, "Failed to generate file, skipping");
      }
    }

    return files;
  }

  /**
   * Phase 5: Generate tests for the implemented code.
   */
  private async generateTests(
    files: GeneratedFile[],
    discovery: DiscoveryResult
  ): Promise<GeneratedFile[]> {
    const testFiles: GeneratedFile[] = [];

    // Group files by type for batch test generation
    const testableFiles = files.filter(
      (f) =>
        (f.path.endsWith(".ts") || f.path.endsWith(".tsx")) &&
        !f.path.includes(".test.") &&
        !f.path.includes(".spec.") &&
        !f.path.includes("__tests__")
    );

    for (const file of testableFiles.slice(0, 20)) {
      try {
        const testPath = file.path.replace(TEST_FILE_EXT_RE, ".test.ts");

        const response = await modelRouterClient.post<{
          choices: Array<{ message: { content: string } }>;
        }>("/route", {
          slot: "default",
          messages: [
            {
              role: "user",
              content: `Write comprehensive tests for the following file using vitest.

File: ${file.path}
Content:
${file.content.slice(0, 3000)}

Acceptance criteria:
${discovery.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}

Write tests that cover:
- Happy path
- Edge cases
- Error handling

Output ONLY the test file content, no markdown code fences.`,
            },
          ],
          options: { maxTokens: 4096, temperature: 0.1 },
        });
        this.creditsUsed += 1;

        const content = response.data.choices[0]?.message.content ?? "";
        if (content) {
          const cleaned = content
            .replace(CODE_FENCE_RE, "")
            .replace(CODE_FENCE_END_RE, "");
          testFiles.push({ path: testPath, content: cleaned });
        }
      } catch (error) {
        logger.warn({ error, file: file.path }, "Failed to generate tests");
      }
    }

    return testFiles;
  }

  /**
   * Phase 6: Run CI validation in the sandbox.
   */
  private async runCIValidation(): Promise<CIResult> {
    try {
      // Install dependencies
      await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/exec`, {
        command: "npm install",
        timeout: 60_000,
      });

      // Run build
      const buildResult = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "npm run build",
        timeout: 120_000,
      });

      const buildPassed = buildResult.data.exitCode === 0;

      // Run tests
      const testResult = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command: "npm test -- --reporter=json",
        timeout: 120_000,
      });

      const testOutput = testResult.data.stdout + testResult.data.stderr;
      const passMatch = testOutput.match(PASS_COUNT_RE);
      const failMatch = testOutput.match(FAIL_COUNT_RE);

      const testsPassed = passMatch
        ? Number.parseInt(passMatch[1] ?? "0", 10)
        : 0;
      const testsFailed = failMatch
        ? Number.parseInt(failMatch[1] ?? "0", 10)
        : 0;

      const errors: string[] = [];
      if (!buildPassed) {
        errors.push(buildResult.data.stderr.slice(0, 2000));
      }
      if (testsFailed > 0) {
        errors.push(testResult.data.stderr.slice(0, 2000));
      }

      return { buildPassed, testsPassed, testsFailed, errors };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ error: msg }, "CI validation failed");
      return {
        buildPassed: false,
        testsPassed: 0,
        testsFailed: 0,
        errors: [msg],
      };
    }
  }

  /**
   * Fix CI errors by analyzing failures and generating patches.
   */
  private async fixCIErrors(
    errors: string[],
    existingFiles: GeneratedFile[]
  ): Promise<GeneratedFile[]> {
    const fixes: GeneratedFile[] = [];

    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "think",
        messages: [
          {
            role: "user",
            content: `Analyze these CI errors and suggest file fixes.

Errors:
${errors.join("\n---\n").slice(0, 4000)}

Project files:
${existingFiles.map((f) => f.path).join("\n")}

Output a JSON array of fixes, each with:
- "path": the file to fix
- "content": the complete corrected file content

Output ONLY the JSON array, no other text.`,
          },
        ],
        options: { maxTokens: 8192, temperature: 0.1 },
      });
      this.creditsUsed += 1;

      const content = response.data.choices[0]?.message.content ?? "[]";
      const jsonMatch = content.match(JSON_ARRAY_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as Array<{
          content: string;
          path: string;
        }>;
        for (const fix of parsed) {
          if (fix.path && fix.content) {
            fixes.push(fix);
          }
        }
      }
    } catch (error) {
      logger.warn({ error }, "Failed to generate CI fixes");
    }

    return fixes;
  }

  /**
   * Phase 7: Generate deployment configuration.
   */
  private async generateDeployConfig(
    discovery: DiscoveryResult,
    architecture: ArchitectureResult
  ): Promise<GeneratedFile[]> {
    const files: GeneratedFile[] = [];

    try {
      const response = await modelRouterClient.post<{
        choices: Array<{ message: { content: string } }>;
      }>("/route", {
        slot: "default",
        messages: [
          {
            role: "user",
            content: `Generate deployment configuration files for the following project.

Architecture: ${architecture.summary}
Deploy Notes: ${architecture.deployConfig}
Tech Stack: ${discovery.techRecommendation}
Integrations: ${discovery.integrations.join(", ")}

Generate these files:
1. Dockerfile
2. docker-compose.yml
3. .env.example

Output a JSON array of files, each with "path" and "content".
Output ONLY the JSON array.`,
          },
        ],
        options: { maxTokens: 4096, temperature: 0.1 },
      });
      this.creditsUsed += 1;

      const content = response.data.choices[0]?.message.content ?? "[]";
      const jsonMatch = content.match(JSON_ARRAY_RE);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as GeneratedFile[];
        for (const f of parsed) {
          if (f.path && f.content) {
            files.push(f);
          }
        }
      }
    } catch (error) {
      logger.warn({ error }, "Failed to generate deploy config");
    }

    return files;
  }

  // -------------------------------------------------------------------------
  // Helpers
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

  private checkBudget(budget: number): void {
    if (this.creditsUsed >= budget) {
      throw new Error(
        `Budget exceeded: used ${this.creditsUsed} credits (limit: ${budget})`
      );
    }
  }

  private buildSummary(
    discovery: DiscoveryResult,
    filesCreated: number,
    testsWritten: number,
    testsPassing: number,
    deployReady: boolean
  ): string {
    const lines = [
      `Project generated with ${filesCreated} files and ${testsWritten} tests (${testsPassing} passing).`,
      "",
      `Tech Stack: ${discovery.techRecommendation}`,
      "",
      "Features:",
      ...discovery.coreFeatures.map((f) => `  - ${f}`),
      "",
      `Deployment: ${deployReady ? "Ready" : "Not ready — build or tests failed"}`,
    ];
    return lines.join("\n");
  }
}
