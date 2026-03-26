import { createLogger } from "@prometheus/logger";

const logger = createLogger("pattern-recognizer");

const FACTORY_METHOD_RE = /create\w+\(/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ArchitectureType =
  | "hybrid"
  | "microservices"
  | "modular_monolith"
  | "monolith"
  | "serverless";

export type EffortLevel = "high" | "low" | "medium";

export interface DetectedPattern {
  confidence: number;
  description: string;
  files: string[];
  name: string;
}

export interface ArchitectureInfo {
  dataFlow: string;
  entryPoints: string[];
  layers: string[];
  type: ArchitectureType;
}

export interface ArchitectureSuggestion {
  applicableTo: string[];
  benefit: string;
  effort: EffortLevel;
  pattern: string;
}

export interface PatternRecognitionResult {
  architecture: ArchitectureInfo;
  patterns: DetectedPattern[];
  suggestions: ArchitectureSuggestion[];
}

// ---------------------------------------------------------------------------
// Pattern detection helpers
// ---------------------------------------------------------------------------

interface FileIndex {
  content: string;
  path: string;
  pathLower: string;
}

function buildIndex(files: Map<string, string>): FileIndex[] {
  const index: FileIndex[] = [];
  for (const [path, content] of files) {
    index.push({ path, pathLower: path.toLowerCase(), content });
  }
  return index;
}

// ---------------------------------------------------------------------------
// Individual pattern detectors
// ---------------------------------------------------------------------------

function detectMVC(index: FileIndex[]): DetectedPattern | null {
  const models = index.filter(
    (f) =>
      f.pathLower.includes("/model") ||
      f.pathLower.includes("/entities") ||
      f.pathLower.includes("/schema")
  );
  const views = index.filter(
    (f) =>
      f.pathLower.includes("/view") ||
      f.pathLower.includes("/pages") ||
      f.pathLower.includes("/components")
  );
  const controllers = index.filter(
    (f) =>
      f.pathLower.includes("/controller") ||
      f.pathLower.includes("/handler") ||
      f.pathLower.includes("/router")
  );

  const hasAll =
    models.length > 0 && views.length > 0 && controllers.length > 0;
  if (!hasAll) {
    return null;
  }

  const total = models.length + views.length + controllers.length;
  const confidence = Math.min(0.95, 0.5 + total * 0.02);

  return {
    name: "MVC (Model-View-Controller)",
    confidence,
    files: [
      ...models.slice(0, 3),
      ...views.slice(0, 3),
      ...controllers.slice(0, 3),
    ].map((f) => f.path),
    description:
      "Separation of data models, presentation views, and request handling controllers",
  };
}

function detectRepository(index: FileIndex[]): DetectedPattern | null {
  const repos = index.filter(
    (f) =>
      f.pathLower.includes("/repositor") ||
      f.content.includes("Repository") ||
      f.content.includes("repository")
  );

  if (repos.length < 2) {
    return null;
  }

  return {
    name: "Repository Pattern",
    confidence: Math.min(0.9, 0.4 + repos.length * 0.1),
    files: repos.slice(0, 5).map((f) => f.path),
    description:
      "Data access abstracted behind repository interfaces for persistence decoupling",
  };
}

function detectEventDriven(index: FileIndex[]): DetectedPattern | null {
  const eventFiles = index.filter(
    (f) =>
      f.pathLower.includes("/event") ||
      f.content.includes("EventEmitter") ||
      f.content.includes("publish") ||
      f.content.includes("subscribe") ||
      f.content.includes("on(")
  );

  if (eventFiles.length < 3) {
    return null;
  }

  return {
    name: "Event-Driven Architecture",
    confidence: Math.min(0.85, 0.3 + eventFiles.length * 0.05),
    files: eventFiles.slice(0, 5).map((f) => f.path),
    description:
      "Components communicate through events, enabling loose coupling and async processing",
  };
}

function detectDependencyInjection(index: FileIndex[]): DetectedPattern | null {
  const diFiles = index.filter(
    (f) =>
      f.content.includes("@Injectable") ||
      f.content.includes("@Inject") ||
      f.content.includes("container.resolve") ||
      f.content.includes("createContainer") ||
      (f.pathLower.includes("/provider") && f.content.includes("provide"))
  );

  if (diFiles.length < 2) {
    return null;
  }

  return {
    name: "Dependency Injection",
    confidence: Math.min(0.9, 0.4 + diFiles.length * 0.08),
    files: diFiles.slice(0, 5).map((f) => f.path),
    description:
      "Dependencies injected via constructors or containers rather than hardcoded",
  };
}

function detectMiddleware(index: FileIndex[]): DetectedPattern | null {
  const mwFiles = index.filter(
    (f) =>
      f.pathLower.includes("middleware") ||
      f.content.includes("app.use(") ||
      f.content.includes("next()")
  );

  if (mwFiles.length < 2) {
    return null;
  }

  return {
    name: "Middleware / Pipeline Pattern",
    confidence: Math.min(0.85, 0.4 + mwFiles.length * 0.08),
    files: mwFiles.slice(0, 5).map((f) => f.path),
    description:
      "Request processing through a chain of composable middleware functions",
  };
}

function detectCQRS(index: FileIndex[]): DetectedPattern | null {
  const commandFiles = index.filter(
    (f) =>
      f.pathLower.includes("/command") ||
      f.content.includes("CommandHandler") ||
      f.content.includes("CommandBus")
  );
  const queryFiles = index.filter(
    (f) =>
      f.pathLower.includes("/quer") ||
      f.content.includes("QueryHandler") ||
      f.content.includes("QueryBus")
  );

  if (commandFiles.length < 1 || queryFiles.length < 1) {
    return null;
  }

  return {
    name: "CQRS (Command Query Responsibility Segregation)",
    confidence: Math.min(
      0.85,
      0.3 + (commandFiles.length + queryFiles.length) * 0.08
    ),
    files: [...commandFiles.slice(0, 3), ...queryFiles.slice(0, 3)].map(
      (f) => f.path
    ),
    description:
      "Separate models for reading and writing data, enabling independent scaling",
  };
}

function detectStrategy(index: FileIndex[]): DetectedPattern | null {
  const strategyFiles = index.filter(
    (f) =>
      f.pathLower.includes("strategy") ||
      f.pathLower.includes("policy") ||
      (f.content.includes("Strategy") && f.content.includes("execute"))
  );

  if (strategyFiles.length < 2) {
    return null;
  }

  return {
    name: "Strategy Pattern",
    confidence: Math.min(0.8, 0.3 + strategyFiles.length * 0.1),
    files: strategyFiles.slice(0, 5).map((f) => f.path),
    description:
      "Interchangeable algorithm implementations selected at runtime",
  };
}

function detectFactory(index: FileIndex[]): DetectedPattern | null {
  const factoryFiles = index.filter(
    (f) =>
      f.pathLower.includes("factory") ||
      f.content.includes("createFactory") ||
      FACTORY_METHOD_RE.test(f.content)
  );

  if (factoryFiles.length < 2) {
    return null;
  }

  return {
    name: "Factory Pattern",
    confidence: Math.min(0.8, 0.3 + factoryFiles.length * 0.07),
    files: factoryFiles.slice(0, 5).map((f) => f.path),
    description:
      "Object creation delegated to factory functions for flexible instantiation",
  };
}

// ---------------------------------------------------------------------------
// Architecture type detection
// ---------------------------------------------------------------------------

function detectArchitectureType(index: FileIndex[]): ArchitectureInfo {
  const hasDockerCompose = index.some(
    (f) =>
      f.pathLower.includes("docker-compose") ||
      f.pathLower.includes("compose.y")
  );
  const hasK8s = index.some(
    (f) =>
      f.pathLower.includes("k8s") ||
      f.pathLower.includes("kubernetes") ||
      f.pathLower.includes("deployment.y")
  );
  const hasServerless = index.some(
    (f) =>
      f.pathLower.includes("serverless") ||
      f.pathLower.includes("lambda") ||
      f.content.includes("exports.handler")
  );
  const hasWorkspaces = index.some(
    (f) =>
      f.pathLower.includes("turbo.json") ||
      f.pathLower.includes("pnpm-workspace") ||
      f.pathLower.includes("lerna.json")
  );
  const serviceCount = index.filter(
    (f) => f.pathLower.includes("/apps/") || f.pathLower.includes("/services/")
  ).length;

  let type: ArchitectureType = "monolith";
  if (hasServerless) {
    type = "serverless";
  } else if (hasK8s && serviceCount > 10) {
    type = "microservices";
  } else if (hasWorkspaces && serviceCount > 5) {
    type = "modular_monolith";
  } else if (hasDockerCompose && serviceCount > 3) {
    type = "hybrid";
  }

  // Detect layers
  const layers: string[] = [];
  if (
    index.some(
      (f) =>
        f.pathLower.includes("/component") ||
        f.pathLower.includes("/page") ||
        f.pathLower.includes("/view")
    )
  ) {
    layers.push("presentation");
  }
  if (
    index.some(
      (f) =>
        f.pathLower.includes("/api/") ||
        f.pathLower.includes("/router") ||
        f.pathLower.includes("/trpc")
    )
  ) {
    layers.push("api");
  }
  if (
    index.some(
      (f) =>
        f.pathLower.includes("/service") ||
        f.pathLower.includes("/logic") ||
        f.pathLower.includes("/domain")
    )
  ) {
    layers.push("business");
  }
  if (
    index.some(
      (f) =>
        f.pathLower.includes("/db") ||
        f.pathLower.includes("/schema") ||
        f.pathLower.includes("/migration")
    )
  ) {
    layers.push("data");
  }
  if (
    index.some(
      (f) =>
        f.pathLower.includes("/infra") ||
        f.pathLower.includes("/deploy") ||
        f.pathLower.includes("docker")
    )
  ) {
    layers.push("infrastructure");
  }

  // Detect entry points
  const entryPoints = index
    .filter(
      (f) =>
        f.pathLower.endsWith("/index.ts") ||
        f.pathLower.endsWith("/main.ts") ||
        f.pathLower.endsWith("/server.ts") ||
        f.pathLower.endsWith("/app.ts")
    )
    .map((f) => f.path)
    .slice(0, 10);

  const dataFlow = buildDataFlowDescription(type, layers);

  return { type, layers, entryPoints, dataFlow };
}

function buildDataFlowDescription(
  type: ArchitectureType,
  layers: string[]
): string {
  const layerFlow = layers.join(" -> ");

  switch (type) {
    case "microservices":
      return `Independent services communicating via message queues and REST APIs. Layer flow: ${layerFlow}`;
    case "modular_monolith":
      return `Modular packages in a monorepo sharing a single deployment. Layer flow: ${layerFlow}`;
    case "serverless":
      return `Event-driven functions triggered by cloud events. Layer flow: ${layerFlow}`;
    case "hybrid":
      return `Mixed architecture with some services deployed independently. Layer flow: ${layerFlow}`;
    default:
      return `Single deployable unit with internal layering. Layer flow: ${layerFlow}`;
  }
}

// ---------------------------------------------------------------------------
// Suggestion generation
// ---------------------------------------------------------------------------

function generateSuggestions(
  patterns: DetectedPattern[],
  architecture: ArchitectureInfo
): ArchitectureSuggestion[] {
  const suggestions: ArchitectureSuggestion[] = [];
  const patternNames = new Set(patterns.map((p) => p.name));

  if (!patternNames.has("Repository Pattern")) {
    suggestions.push({
      pattern: "Repository Pattern",
      benefit:
        "Decouples data access from business logic, making it easier to swap databases or add caching",
      applicableTo: architecture.layers.includes("data")
        ? ["data layer"]
        : ["all data access code"],
      effort: "medium",
    });
  }

  if (
    !patternNames.has("Event-Driven Architecture") &&
    architecture.type !== "serverless"
  ) {
    suggestions.push({
      pattern: "Event-Driven Architecture",
      benefit:
        "Enables async processing, improves scalability, and reduces coupling between services",
      applicableTo: ["inter-service communication", "background jobs"],
      effort: "high",
    });
  }

  if (!patternNames.has("Strategy Pattern")) {
    suggestions.push({
      pattern: "Strategy Pattern",
      benefit: "Makes algorithms interchangeable without modifying client code",
      applicableTo: ["authentication", "routing", "model selection"],
      effort: "low",
    });
  }

  if (
    !patternNames.has("CQRS (Command Query Responsibility Segregation)") &&
    architecture.type !== "monolith"
  ) {
    suggestions.push({
      pattern: "CQRS",
      benefit:
        "Separates read and write models for independent optimization and scaling",
      applicableTo: ["high-read APIs", "complex write workflows"],
      effort: "high",
    });
  }

  if (!patternNames.has("Middleware / Pipeline Pattern")) {
    suggestions.push({
      pattern: "Middleware / Pipeline Pattern",
      benefit:
        "Composable request processing for cross-cutting concerns like auth, logging, rate limiting",
      applicableTo: ["API layer", "request handling"],
      effort: "low",
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Main recognizer class
// ---------------------------------------------------------------------------

export class ArchitecturePatternRecognizer {
  /**
   * Analyze project files and recognize architecture patterns.
   *
   * @param projectId - The project being analyzed
   * @param files - Map of file path -> content. In production this would
   *                be fetched from the sandbox filesystem.
   */
  recognize(
    projectId: string,
    files: Map<string, string> = new Map()
  ): PatternRecognitionResult {
    logger.info(
      { projectId, fileCount: files.size },
      "Starting architecture pattern recognition"
    );

    const index = buildIndex(files);

    const detectors = [
      detectMVC,
      detectRepository,
      detectEventDriven,
      detectDependencyInjection,
      detectMiddleware,
      detectCQRS,
      detectStrategy,
      detectFactory,
    ];

    const patterns: DetectedPattern[] = [];
    for (const detector of detectors) {
      const result = detector(index);
      if (result) {
        patterns.push(result);
      }
    }

    patterns.sort((a, b) => b.confidence - a.confidence);

    const architecture = detectArchitectureType(index);
    const suggestions = generateSuggestions(patterns, architecture);

    logger.info(
      {
        projectId,
        patternsFound: patterns.length,
        architectureType: architecture.type,
        suggestionCount: suggestions.length,
      },
      "Architecture pattern recognition complete"
    );

    return { patterns, architecture, suggestions };
  }
}
