/**
 * Full-Stack Generator Pipeline
 *
 * Generates a complete full-stack application from a high-level description
 * and tech stack configuration. Orchestrates multiple agent roles through
 * a sequential pipeline:
 *
 * 1. Architect: project structure, DB schema, API contracts
 * 2. Backend: DB schema, API routes, middleware, services
 * 3. Frontend: pages, components, API hooks, forms
 * 4. Integration: wire frontend to backend, auth flow
 * 5. Test: generate basic tests for API and components
 * 6. CI: verify build passes, run tests
 * 7. Deploy: Dockerfile, docker-compose, deployment config
 */

import { createLogger } from "@prometheus/logger";
import {
  generateId,
  modelRouterClient,
  sandboxManagerClient,
} from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:full-stack-generator");

const CODE_FENCE_RE = /^```[\w]*\n?/;
const CODE_FENCE_END_RE = /\n?```$/;
const JSON_OBJECT_RE = /\{[\s\S]*\}/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FullStackConfig {
  description: string;
  features: string[];
  techStack: {
    frontend: string;
    backend: string;
    database: string;
    auth: string;
  };
}

export interface GenerationResult {
  error: string | null;
  id: string;
  status: "success" | "partial" | "failed";
  steps: StepResult[];
  totalFiles: number;
}

interface StepResult {
  durationMs: number;
  error: string | null;
  filesCreated: string[];
  status: "success" | "failed";
  step: string;
}

interface ArchitectOutput {
  apiContracts: string;
  dbSchema: string;
  projectStructure: string[];
  summary: string;
}

interface GeneratedFile {
  content: string;
  path: string;
}

// ---------------------------------------------------------------------------
// FullStackGenerator
// ---------------------------------------------------------------------------

export class FullStackGenerator {
  readonly sandboxId: string;

  constructor(sandboxId: string, _modelRouterUrl: string) {
    this.sandboxId = sandboxId;
  }

  /**
   * Generate a full-stack application from the given configuration.
   * Runs through all pipeline steps sequentially, passing outputs forward.
   */
  async generate(config: FullStackConfig): Promise<GenerationResult> {
    const generationId = generateId("gen");
    const steps: StepResult[] = [];
    let totalFiles = 0;

    logger.info(
      {
        generationId,
        sandboxId: this.sandboxId,
        techStack: config.techStack,
        features: config.features,
      },
      "Starting full-stack generation"
    );

    try {
      // Step 1: Architect
      const architectResult = await this.runStep("architect", () => {
        return this.architectStep(config);
      });
      steps.push(architectResult.stepResult);
      if (architectResult.stepResult.status === "failed") {
        return this.buildResult(generationId, "failed", steps, totalFiles);
      }
      totalFiles += architectResult.stepResult.filesCreated.length;

      // Step 2: Backend
      const backendResult = await this.runStep("backend", () => {
        return this.backendStep(config, architectResult.output);
      });
      steps.push(backendResult.stepResult);
      if (backendResult.stepResult.status === "failed") {
        return this.buildResult(generationId, "partial", steps, totalFiles);
      }
      totalFiles += backendResult.stepResult.filesCreated.length;

      // Step 3: Frontend
      const frontendResult = await this.runStep("frontend", () => {
        return this.frontendStep(config, architectResult.output);
      });
      steps.push(frontendResult.stepResult);
      if (frontendResult.stepResult.status === "failed") {
        return this.buildResult(generationId, "partial", steps, totalFiles);
      }
      totalFiles += frontendResult.stepResult.filesCreated.length;

      // Step 4: Integration
      const integrationResult = await this.runStep("integration", () => {
        return this.integrationStep(config, architectResult.output);
      });
      steps.push(integrationResult.stepResult);
      if (integrationResult.stepResult.status === "failed") {
        return this.buildResult(generationId, "partial", steps, totalFiles);
      }
      totalFiles += integrationResult.stepResult.filesCreated.length;

      // Step 5: Test
      const testResult = await this.runStep("test", () => {
        return this.testStep(config, architectResult.output);
      });
      steps.push(testResult.stepResult);
      totalFiles += testResult.stepResult.filesCreated.length;

      // Step 6: CI (verify build)
      const ciResult = await this.runStep("ci", () => {
        return this.ciStep();
      });
      steps.push(ciResult.stepResult);

      // Step 7: Deploy
      const deployResult = await this.runStep("deploy", () => {
        return this.deployStep(config, architectResult.output);
      });
      steps.push(deployResult.stepResult);
      totalFiles += deployResult.stepResult.filesCreated.length;

      const allSucceeded = steps.every((s) => s.status === "success");
      const status = allSucceeded ? "success" : "partial";

      logger.info(
        { generationId, status, totalFiles, stepCount: steps.length },
        "Full-stack generation complete"
      );

      return this.buildResult(generationId, status, steps, totalFiles);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { generationId, error: msg },
        "Full-stack generation failed"
      );
      return this.buildResult(generationId, "failed", steps, totalFiles, msg);
    }
  }

  // -------------------------------------------------------------------------
  // Pipeline steps
  // -------------------------------------------------------------------------

  /**
   * Architect step: generate project structure, DB schema, and API contracts.
   */
  private async architectStep(
    config: FullStackConfig
  ): Promise<GeneratedFile[]> {
    const response = await modelRouterClient.post<{
      choices: Array<{ message: { content: string } }>;
    }>("/route", {
      slot: "think",
      messages: [
        {
          role: "system",
          content:
            "You are a senior software architect. Design project structures, database schemas, and API contracts. Output only valid JSON.",
        },
        {
          role: "user",
          content: `Design a full-stack application with the following requirements:

Description: ${config.description}
Frontend: ${config.techStack.frontend}
Backend: ${config.techStack.backend}
Database: ${config.techStack.database}
Auth: ${config.techStack.auth}
Features: ${config.features.join(", ")}

Generate a JSON object with:
1. "files" - array of { "path": string, "content": string } for:
   - Project configuration files (package.json, tsconfig.json, etc.)
   - Database schema file
   - API contract/types file
   - Project structure skeleton (empty index files for each module)

Output ONLY the JSON object with a "files" key.`,
        },
      ],
      options: { maxTokens: 8192, temperature: 0.2 },
    });

    return this.parseGeneratedFiles(response.data.choices[0]?.message.content);
  }

  /**
   * Backend step: implement DB schema, API routes, middleware, services.
   */
  private async backendStep(
    config: FullStackConfig,
    architectOutput: ArchitectOutput
  ): Promise<GeneratedFile[]> {
    const response = await modelRouterClient.post<{
      choices: Array<{ message: { content: string } }>;
    }>("/route", {
      slot: "default",
      messages: [
        {
          role: "system",
          content: `You are a senior backend engineer. Implement backend code using ${config.techStack.backend} with ${config.techStack.database}. Output only valid JSON.`,
        },
        {
          role: "user",
          content: `Implement the backend for this application:

Description: ${config.description}
Tech: ${config.techStack.backend} + ${config.techStack.database}
Auth: ${config.techStack.auth}
Features: ${config.features.join(", ")}

Project structure:
${architectOutput.projectStructure.join("\n")}

DB Schema:
${architectOutput.dbSchema}

API Contracts:
${architectOutput.apiContracts}

Generate a JSON object with "files" array of { "path": string, "content": string } for:
- Database schema and migrations
- API route handlers for each feature
- Middleware (auth, validation, error handling)
- Service layer with business logic
- Server entry point

Output ONLY the JSON object.`,
        },
      ],
      options: { maxTokens: 8192, temperature: 0.1 },
    });

    return this.parseGeneratedFiles(response.data.choices[0]?.message.content);
  }

  /**
   * Frontend step: implement pages, components, API hooks, forms.
   */
  private async frontendStep(
    config: FullStackConfig,
    architectOutput: ArchitectOutput
  ): Promise<GeneratedFile[]> {
    const response = await modelRouterClient.post<{
      choices: Array<{ message: { content: string } }>;
    }>("/route", {
      slot: "default",
      messages: [
        {
          role: "system",
          content: `You are a senior frontend engineer. Implement frontend code using ${config.techStack.frontend}. Output only valid JSON.`,
        },
        {
          role: "user",
          content: `Implement the frontend for this application:

Description: ${config.description}
Tech: ${config.techStack.frontend}
Auth: ${config.techStack.auth}
Features: ${config.features.join(", ")}

API Contracts:
${architectOutput.apiContracts}

Generate a JSON object with "files" array of { "path": string, "content": string } for:
- Page components for each feature
- Shared UI components (layout, navigation, forms)
- API client hooks/utilities
- Auth integration (login, signup, protected routes)
- Styling/theme configuration

Output ONLY the JSON object.`,
        },
      ],
      options: { maxTokens: 8192, temperature: 0.1 },
    });

    return this.parseGeneratedFiles(response.data.choices[0]?.message.content);
  }

  /**
   * Integration step: wire frontend to backend, set up auth flow.
   */
  private async integrationStep(
    config: FullStackConfig,
    architectOutput: ArchitectOutput
  ): Promise<GeneratedFile[]> {
    const response = await modelRouterClient.post<{
      choices: Array<{ message: { content: string } }>;
    }>("/route", {
      slot: "default",
      messages: [
        {
          role: "system",
          content:
            "You are a full-stack integration engineer. Wire frontend to backend, configure auth flows, and set up environment. Output only valid JSON.",
        },
        {
          role: "user",
          content: `Create integration files for a ${config.techStack.frontend} + ${config.techStack.backend} application:

Description: ${config.description}
Auth: ${config.techStack.auth}
Features: ${config.features.join(", ")}

API Contracts:
${architectOutput.apiContracts}

Generate a JSON object with "files" array of { "path": string, "content": string } for:
- Environment configuration (.env.example, config loaders)
- API client setup (base URL, auth headers, error handling)
- Auth flow integration (token storage, refresh, protected routes)
- CORS and proxy configuration
- Shared types between frontend and backend

Output ONLY the JSON object.`,
        },
      ],
      options: { maxTokens: 4096, temperature: 0.1 },
    });

    return this.parseGeneratedFiles(response.data.choices[0]?.message.content);
  }

  /**
   * Test step: generate basic tests for API and components.
   */
  private async testStep(
    config: FullStackConfig,
    architectOutput: ArchitectOutput
  ): Promise<GeneratedFile[]> {
    const response = await modelRouterClient.post<{
      choices: Array<{ message: { content: string } }>;
    }>("/route", {
      slot: "default",
      messages: [
        {
          role: "system",
          content:
            "You are a test engineer. Generate comprehensive but focused tests. Output only valid JSON.",
        },
        {
          role: "user",
          content: `Generate tests for a ${config.techStack.frontend} + ${config.techStack.backend} application:

Description: ${config.description}
Features: ${config.features.join(", ")}

API Contracts:
${architectOutput.apiContracts}

Generate a JSON object with "files" array of { "path": string, "content": string } for:
- API endpoint tests (one test file per route group)
- Component tests for key UI components
- Auth flow integration test
- Test utilities and fixtures
- Test configuration (jest/vitest config)

Output ONLY the JSON object.`,
        },
      ],
      options: { maxTokens: 4096, temperature: 0.1 },
    });

    return this.parseGeneratedFiles(response.data.choices[0]?.message.content);
  }

  /**
   * CI step: verify the build passes and run tests in the sandbox.
   */
  private async ciStep(): Promise<GeneratedFile[]> {
    // Install dependencies
    const installResult = await this.execInSandbox("npm", [
      "install",
      "--legacy-peer-deps",
    ]);
    if (installResult.exitCode !== 0) {
      logger.warn({ stderr: installResult.stderr }, "npm install had issues");
    }

    // Try building
    const buildResult = await this.execInSandbox("npm", [
      "run",
      "build",
      "--if-present",
    ]);
    if (buildResult.exitCode !== 0) {
      logger.warn({ stderr: buildResult.stderr }, "Build failed");
      throw new Error(`Build failed: ${buildResult.stderr.slice(0, 500)}`);
    }

    // Try running tests
    const testResult = await this.execInSandbox("npm", [
      "test",
      "--if-present",
      "--",
      "--passWithNoTests",
    ]);
    if (testResult.exitCode !== 0) {
      logger.warn({ stderr: testResult.stderr }, "Tests failed");
    }

    // CI step does not produce files
    return [];
  }

  /**
   * Deploy step: generate Dockerfile, docker-compose, and deployment config.
   */
  private async deployStep(
    config: FullStackConfig,
    architectOutput: ArchitectOutput
  ): Promise<GeneratedFile[]> {
    const response = await modelRouterClient.post<{
      choices: Array<{ message: { content: string } }>;
    }>("/route", {
      slot: "default",
      messages: [
        {
          role: "system",
          content:
            "You are a DevOps engineer. Generate production-ready deployment configurations. Output only valid JSON.",
        },
        {
          role: "user",
          content: `Generate deployment configuration for a ${config.techStack.frontend} + ${config.techStack.backend} application with ${config.techStack.database}:

Description: ${config.description}
Project structure:
${architectOutput.projectStructure.join("\n")}

Generate a JSON object with "files" array of { "path": string, "content": string } for:
- Dockerfile (multi-stage build)
- docker-compose.yml (app + database + redis)
- .dockerignore
- nginx.conf (if applicable)
- GitHub Actions CI/CD workflow (.github/workflows/ci.yml)
- Deployment documentation as comments in docker-compose

Output ONLY the JSON object.`,
        },
      ],
      options: { maxTokens: 4096, temperature: 0.1 },
    });

    return this.parseGeneratedFiles(response.data.choices[0]?.message.content);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Run a pipeline step, measuring duration and catching errors.
   */
  private async runStep(
    stepName: string,
    fn: () => Promise<GeneratedFile[]>
  ): Promise<{ output: ArchitectOutput; stepResult: StepResult }> {
    const start = Date.now();
    logger.info(
      { step: stepName, sandboxId: this.sandboxId },
      "Starting pipeline step"
    );

    try {
      const files = await fn();

      // Write generated files to the sandbox
      const writtenPaths: string[] = [];
      for (const file of files) {
        try {
          await this.writeFileToSandbox(file.path, file.content);
          writtenPaths.push(file.path);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.warn({ file: file.path, error: msg }, "Failed to write file");
        }
      }

      // Build an ArchitectOutput from written files for downstream steps
      const output = this.buildArchitectOutput(files);

      const durationMs = Date.now() - start;
      logger.info(
        { step: stepName, filesCreated: writtenPaths.length, durationMs },
        "Pipeline step complete"
      );

      return {
        output,
        stepResult: {
          step: stepName,
          status: "success",
          filesCreated: writtenPaths,
          error: null,
          durationMs,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const durationMs = Date.now() - start;
      logger.error(
        { step: stepName, error: msg, durationMs },
        "Pipeline step failed"
      );

      return {
        output: {
          projectStructure: [],
          dbSchema: "",
          apiContracts: "",
          summary: "",
        },
        stepResult: {
          step: stepName,
          status: "failed",
          filesCreated: [],
          error: msg,
          durationMs,
        },
      };
    }
  }

  /**
   * Parse the LLM response into an array of generated files.
   */
  private parseGeneratedFiles(raw: string | undefined): GeneratedFile[] {
    if (!raw) {
      return [];
    }

    // Strip markdown code fences
    const cleaned = raw
      .replace(CODE_FENCE_RE, "")
      .replace(CODE_FENCE_END_RE, "");

    const jsonMatch = cleaned.match(JSON_OBJECT_RE);
    if (!jsonMatch) {
      return [];
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as {
        files?: GeneratedFile[];
      };
      return parsed.files ?? [];
    } catch {
      logger.warn("Failed to parse generated files JSON");
      return [];
    }
  }

  /**
   * Build an ArchitectOutput from generated files for use by downstream steps.
   */
  private buildArchitectOutput(files: GeneratedFile[]): ArchitectOutput {
    const projectStructure = files.map((f) => f.path);

    const schemaFile = files.find(
      (f) =>
        f.path.includes("schema") ||
        f.path.includes("migration") ||
        f.path.includes("drizzle")
    );

    const contractFile = files.find(
      (f) =>
        f.path.includes("contract") ||
        f.path.includes("types") ||
        f.path.includes("api")
    );

    return {
      projectStructure,
      dbSchema: schemaFile?.content ?? "",
      apiContracts: contractFile?.content ?? "",
      summary: `Generated ${files.length} files`,
    };
  }

  /**
   * Write a file inside the sandbox.
   */
  private async writeFileToSandbox(
    filePath: string,
    content: string
  ): Promise<void> {
    // Ensure the parent directory exists
    const parentDir = filePath.slice(0, filePath.lastIndexOf("/"));
    if (parentDir) {
      await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/exec`, {
        command: "mkdir",
        args: ["-p", parentDir],
        timeout: 5000,
      });
    }

    await sandboxManagerClient.post(`/sandboxes/${this.sandboxId}/exec`, {
      command: "tee",
      args: [filePath],
      stdin: content,
      timeout: 10_000,
    });
  }

  /**
   * Execute a command inside the sandbox and return the result.
   */
  private async execInSandbox(
    command: string,
    args: string[]
  ): Promise<{ exitCode: number; stderr: string; stdout: string }> {
    try {
      const response = await sandboxManagerClient.post<{
        exitCode: number;
        stderr: string;
        stdout: string;
      }>(`/sandboxes/${this.sandboxId}/exec`, {
        command,
        args,
        timeout: 120_000,
      });
      return response.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { exitCode: 1, stdout: "", stderr: msg };
    }
  }

  /**
   * Build the final GenerationResult.
   */
  private buildResult(
    id: string,
    status: GenerationResult["status"],
    steps: StepResult[],
    totalFiles: number,
    error: string | null = null
  ): GenerationResult {
    return { id, status, steps, totalFiles, error };
  }
}
