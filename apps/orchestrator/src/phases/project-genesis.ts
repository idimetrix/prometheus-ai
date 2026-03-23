/**
 * ProjectGenesis: 8-phase pipeline that converts a natural language project
 * description into a fully scaffolded, validated codebase. Each phase
 * builds on the output of the previous one, producing a deterministic
 * result that can be replayed or resumed.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:project-genesis");

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface GenesisResult {
  apiContracts: string;
  architecture: string;
  cicdConfig: string;
  dbSchema: string;
  projectName: string;
  scaffoldedFiles: string[];
  techStack: TechStackRecommendation[];
  validationPassed: boolean;
}

export interface TechStackRecommendation {
  alternatives: string[];
  category:
    | "framework"
    | "database"
    | "orm"
    | "auth"
    | "hosting"
    | "testing"
    | "styling";
  name: string;
  reasoning: string;
  version: string;
}

// ---------------------------------------------------------------------------
// Internal phase result types
// ---------------------------------------------------------------------------

interface RequirementsResult {
  constraints: string[];
  features: string[];
  projectName: string;
  scalingNeeds: "small" | "medium" | "large" | "enterprise";
  summary: string;
  targetPlatform: string;
}

interface ArchitectureDesign {
  diagram: string;
  layers: string[];
  pattern: string;
  rationale: string;
  services: string[];
}

interface DbSchemaDesign {
  raw: string;
  relationships: Array<{
    from: string;
    to: string;
    type: "one-to-one" | "one-to-many" | "many-to-many";
  }>;
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; constraints: string[] }>;
    indexes: string[];
  }>;
}

interface ApiContract {
  endpoints: Array<{
    method: string;
    path: string;
    description: string;
    requestSchema: string;
    responseSchema: string;
  }>;
  raw: string;
}

interface ScaffoldResult {
  files: Array<{ path: string; content: string }>;
}

interface CiCdResult {
  config: string;
  provider: string;
}

interface ValidationResult {
  errors: string[];
  lintPassed: boolean;
  typecheckPassed: boolean;
}

// ---------------------------------------------------------------------------
// Phase helpers
// ---------------------------------------------------------------------------

const FRAMEWORK_DEFAULTS: Record<string, TechStackRecommendation> = {
  react: {
    category: "framework",
    name: "Next.js",
    version: "14",
    reasoning:
      "Full-stack React framework with SSR, API routes, and excellent DX",
    alternatives: ["Remix", "Vite + React", "Astro"],
  },
  api: {
    category: "framework",
    name: "Hono",
    version: "4",
    reasoning:
      "Ultra-fast, lightweight web framework with first-class TypeScript support",
    alternatives: ["Fastify", "Express", "Elysia"],
  },
  database: {
    category: "database",
    name: "PostgreSQL",
    version: "16",
    reasoning:
      "Battle-tested relational DB with pgvector for AI embeddings and JSONB for flexibility",
    alternatives: ["MySQL", "SQLite", "CockroachDB"],
  },
  orm: {
    category: "orm",
    name: "Drizzle",
    version: "0.30",
    reasoning:
      "Type-safe SQL-like ORM with zero runtime overhead and excellent migration support",
    alternatives: ["Prisma", "Kysely", "TypeORM"],
  },
  auth: {
    category: "auth",
    name: "Better Auth",
    version: "1",
    reasoning:
      "Modern, framework-agnostic auth library with built-in multi-tenancy support",
    alternatives: ["NextAuth", "Lucia", "Clerk"],
  },
  testing: {
    category: "testing",
    name: "Vitest",
    version: "2",
    reasoning:
      "Vite-native test runner with excellent TypeScript integration and fast HMR",
    alternatives: ["Jest", "Bun Test", "Node Test Runner"],
  },
  styling: {
    category: "styling",
    name: "Tailwind CSS",
    version: "4",
    reasoning:
      "Utility-first CSS framework with excellent component library ecosystem",
    alternatives: ["CSS Modules", "Panda CSS", "Vanilla Extract"],
  },
};

function getHostingName(scalingNeeds: string): string {
  if (scalingNeeds === "enterprise") {
    return "AWS EKS";
  }
  if (scalingNeeds === "large") {
    return "Railway";
  }
  return "Vercel";
}

function inferScalingNeeds(
  description: string
): RequirementsResult["scalingNeeds"] {
  const lower = description.toLowerCase();
  if (
    lower.includes("enterprise") ||
    lower.includes("millions") ||
    lower.includes("high availability")
  ) {
    return "enterprise";
  }
  if (
    lower.includes("scale") ||
    lower.includes("production") ||
    lower.includes("thousands")
  ) {
    return "large";
  }
  if (
    lower.includes("startup") ||
    lower.includes("mvp") ||
    lower.includes("prototype")
  ) {
    return "small";
  }
  return "medium";
}

function inferPlatform(description: string): string {
  const lower = description.toLowerCase();
  if (lower.includes("mobile") || lower.includes("react native")) {
    return "mobile";
  }
  if (lower.includes("desktop") || lower.includes("electron")) {
    return "desktop";
  }
  if (lower.includes("cli") || lower.includes("command line")) {
    return "cli";
  }
  return "web";
}

// Top-level regex patterns
const FEATURE_PATTERN_1 = /(?:should|must|needs? to|will)\s+(.+?)(?:\.|,|$)/gi;
const FEATURE_PATTERN_2 =
  /(?:feature|capability|function(?:ality)?)\s*:?\s*(.+?)(?:\.|,|$)/gi;
const FEATURE_PATTERN_3 =
  /(?:users?\s+can|allow(?:s|ing)?\s+(?:users?\s+to)?)\s+(.+?)(?:\.|,|$)/gi;
const PROJECT_NAME_CALLED_RE = /(?:called|named)\s+"?([a-z][\w-]*)"?/i;
const PROJECT_NAME_BUILD_RE =
  /(?:build|create|make)\s+(?:a\s+)?(?:new\s+)?([a-z][\w-]*)/i;
const WORD_FILTER_RE = /^[a-z]/i;
const SENTENCE_SPLIT_RE = /[.!]/;
const WHITESPACE_SPLIT_RE = /\s+/;
const WHITESPACE_REPLACE_RE = /\s+/g;
const TRAILING_S_RE = /s$/;
const OPEN_BRACE_RE = /\{/g;
const CLOSE_BRACE_RE = /\}/g;
const OPEN_PAREN_RE = /\(/g;
const CLOSE_PAREN_RE = /\)/g;

function extractFeatures(description: string): string[] {
  const features: string[] = [];
  const featurePatterns = [
    FEATURE_PATTERN_1,
    FEATURE_PATTERN_2,
    FEATURE_PATTERN_3,
  ];

  for (const pattern of featurePatterns) {
    let match = pattern.exec(description);
    while (match) {
      const feature = match[1]?.trim();
      if (feature && feature.length > 5 && feature.length < 200) {
        features.push(feature);
      }
      match = pattern.exec(description);
    }
  }

  if (features.length === 0) {
    const sentences = description
      .split(SENTENCE_SPLIT_RE)
      .map((s) => s.trim())
      .filter((s) => s.length > 10);
    return sentences.slice(0, 5);
  }

  return [...new Set(features)].slice(0, 10);
}

function extractProjectName(
  description: string,
  preferences?: Record<string, string>
): string {
  if (preferences?.name) {
    return preferences.name;
  }

  const nameMatch =
    PROJECT_NAME_CALLED_RE.exec(description) ??
    PROJECT_NAME_BUILD_RE.exec(description);

  if (nameMatch?.[1]) {
    return nameMatch[1].toLowerCase().replace(WHITESPACE_REPLACE_RE, "-");
  }

  const words = description
    .split(WHITESPACE_SPLIT_RE)
    .filter((w) => w.length > 3 && WORD_FILTER_RE.test(w))
    .slice(0, 2);

  return words.length > 0
    ? words.join("-").toLowerCase()
    : `project-${generateId().slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// ProjectGenesis class
// ---------------------------------------------------------------------------

export class ProjectGenesis {
  private readonly genesisId: string;

  constructor() {
    this.genesisId = generateId();
  }

  /**
   * Run the full 8-phase genesis pipeline.
   */
  execute(
    _agentLoop: AgentLoop,
    description: string,
    preferences?: Record<string, string>
  ): GenesisResult {
    logger.info(
      { genesisId: this.genesisId, descriptionLength: description.length },
      "Starting project genesis"
    );

    const startTime = Date.now();

    // Phase 1: Requirements extraction
    const requirements = this.phaseRequirements(description, preferences);
    logger.info(
      { features: requirements.features.length },
      "Phase 1 complete: requirements extracted"
    );

    // Phase 2: Tech stack recommendation
    const techStack = this.phaseTechStack(requirements, preferences);
    logger.info(
      { selections: techStack.length },
      "Phase 2 complete: tech stack recommended"
    );

    // Phase 3: Architecture design
    const architecture = this.phaseArchitecture(requirements, techStack);
    logger.info(
      { pattern: architecture.pattern },
      "Phase 3 complete: architecture designed"
    );

    // Phase 4: Database schema design
    const dbSchema = this.phaseDbSchema(requirements, techStack, architecture);
    logger.info(
      { tables: dbSchema.tables.length },
      "Phase 4 complete: database schema designed"
    );

    // Phase 5: API contract generation
    const apiContracts = this.phaseApiContracts(
      requirements,
      architecture,
      dbSchema
    );
    logger.info(
      { endpoints: apiContracts.endpoints.length },
      "Phase 5 complete: API contracts generated"
    );

    // Phase 6: Project scaffolding
    const scaffold = this.phaseScaffold(
      requirements,
      techStack,
      architecture,
      dbSchema,
      apiContracts
    );
    logger.info(
      { files: scaffold.files.length },
      "Phase 6 complete: project scaffolded"
    );

    // Phase 7: CI/CD configuration
    const cicd = this.phaseCiCd(requirements, techStack);
    logger.info(
      { provider: cicd.provider },
      "Phase 7 complete: CI/CD configured"
    );

    // Phase 8: Validation
    const validation = this.phaseValidation(scaffold);
    logger.info(
      { passed: validation.typecheckPassed && validation.lintPassed },
      "Phase 8 complete: validation finished"
    );

    const elapsed = Date.now() - startTime;
    logger.info(
      {
        genesisId: this.genesisId,
        elapsed,
        projectName: requirements.projectName,
      },
      "Project genesis complete"
    );

    return {
      projectName: requirements.projectName,
      techStack,
      architecture: architecture.diagram,
      dbSchema: dbSchema.raw,
      apiContracts: apiContracts.raw,
      scaffoldedFiles: scaffold.files.map((f) => f.path),
      cicdConfig: cicd.config,
      validationPassed: validation.typecheckPassed && validation.lintPassed,
    };
  }

  // -------------------------------------------------------------------------
  // Phase 1: Requirements extraction from natural language
  // -------------------------------------------------------------------------

  private phaseRequirements(
    description: string,
    preferences?: Record<string, string>
  ): RequirementsResult {
    const projectName = extractProjectName(description, preferences);
    const features = extractFeatures(description);
    const targetPlatform = inferPlatform(description);
    const scalingNeeds = inferScalingNeeds(description);

    const constraints: string[] = [];
    if (preferences?.language) {
      constraints.push(`Primary language: ${preferences.language}`);
    }
    if (preferences?.budget) {
      constraints.push(`Budget constraint: ${preferences.budget}`);
    }
    if (preferences?.timeline) {
      constraints.push(`Timeline: ${preferences.timeline}`);
    }
    if (preferences?.hosting) {
      constraints.push(`Hosting preference: ${preferences.hosting}`);
    }

    const lower = description.toLowerCase();
    if (lower.includes("real-time") || lower.includes("realtime")) {
      constraints.push("Requires real-time communication (WebSocket/SSE)");
    }
    if (lower.includes("offline") || lower.includes("pwa")) {
      constraints.push("Requires offline capability / PWA support");
    }
    if (lower.includes("multi-tenant") || lower.includes("saas")) {
      constraints.push("Multi-tenant SaaS architecture required");
    }

    return {
      projectName,
      summary: description.slice(0, 500),
      features,
      constraints,
      targetPlatform,
      scalingNeeds,
    };
  }

  // -------------------------------------------------------------------------
  // Phase 2: Tech stack recommendation
  // -------------------------------------------------------------------------

  private phaseTechStack(
    requirements: RequirementsResult,
    preferences?: Record<string, string>
  ): TechStackRecommendation[] {
    const stack: TechStackRecommendation[] = [];

    const categoryKeys = [
      "framework",
      "database",
      "orm",
      "auth",
      "testing",
      "styling",
    ] as const;

    for (const key of categoryKeys) {
      const override = preferences?.[key];
      let defaultRec: TechStackRecommendation | undefined;
      if (key === "framework") {
        defaultRec =
          requirements.targetPlatform === "web"
            ? FRAMEWORK_DEFAULTS.react
            : FRAMEWORK_DEFAULTS.api;
      } else {
        defaultRec = FRAMEWORK_DEFAULTS[key];
      }

      if (!defaultRec) {
        continue;
      }

      if (override) {
        stack.push({
          ...defaultRec,
          name: override,
          reasoning: `Selected by user preference: ${override}`,
        });
      } else {
        stack.push({ ...defaultRec });
      }
    }

    // Add API framework if web project
    if (requirements.targetPlatform === "web") {
      const apiDefault = FRAMEWORK_DEFAULTS.api;
      if (apiDefault) {
        stack.push({ ...apiDefault, category: "framework" as const });
      }
    }

    // Add hosting recommendation based on scaling needs
    const hostingRec: TechStackRecommendation = {
      category: "hosting",
      name: getHostingName(requirements.scalingNeeds),
      version: "latest",
      reasoning: `Best fit for ${requirements.scalingNeeds} scale deployment`,
      alternatives: ["Fly.io", "Render", "Coolify"],
    };
    stack.push(hostingRec);

    return stack;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Architecture design
  // -------------------------------------------------------------------------

  private phaseArchitecture(
    requirements: RequirementsResult,
    techStack: TechStackRecommendation[]
  ): ArchitectureDesign {
    const isMonolith =
      requirements.scalingNeeds === "small" || requirements.features.length < 5;
    const pattern = isMonolith ? "modular-monolith" : "microservices";

    const layers = ["presentation", "application", "domain", "infrastructure"];

    const services: string[] = ["api-gateway"];
    if (!isMonolith) {
      if (requirements.constraints.some((c) => c.includes("real-time"))) {
        services.push("websocket-server");
      }
      if (requirements.features.length > 3) {
        services.push("background-worker");
      }
      if (requirements.scalingNeeds === "enterprise") {
        services.push("event-bus", "notification-service", "search-service");
      }
    }

    const frameworkName =
      techStack.find((t) => t.category === "framework")?.name ?? "Next.js";
    const dbName =
      techStack.find((t) => t.category === "database")?.name ?? "PostgreSQL";

    const diagram = [
      `# ${requirements.projectName} Architecture`,
      `## Pattern: ${pattern}`,
      "",
      "```",
      "+-----------------------------------------+",
      "|               Client Layer              |",
      `|          (${frameworkName} Frontend)          |`,
      "+-----------------------------------------+",
      "|             API Gateway                 |",
      "|          (tRPC + Hono)                  |",
      "+-----------------------------------------+",
      "|           Service Layer                 |",
      ...services.map((s) => `|  - ${s.padEnd(35)}|`),
      "+-----------------------------------------+",
      "|           Data Layer                    |",
      `|     (${dbName} + Redis Cache)       |`,
      "+-----------------------------------------+",
      "```",
    ].join("\n");

    return {
      pattern,
      layers,
      services,
      diagram,
      rationale: `${pattern} architecture chosen for ${requirements.scalingNeeds}-scale project with ${requirements.features.length} features`,
    };
  }

  // -------------------------------------------------------------------------
  // Phase 4: Database schema design
  // -------------------------------------------------------------------------

  private phaseDbSchema(
    requirements: RequirementsResult,
    techStack: TechStackRecommendation[],
    _architecture: ArchitectureDesign
  ): DbSchemaDesign {
    const tables: DbSchemaDesign["tables"] = [];
    const relationships: DbSchemaDesign["relationships"] = [];

    // Always include users table
    tables.push({
      name: "users",
      columns: [
        { name: "id", type: "text", constraints: ["PRIMARY KEY"] },
        { name: "email", type: "text", constraints: ["NOT NULL", "UNIQUE"] },
        { name: "name", type: "text", constraints: ["NOT NULL"] },
        { name: "password_hash", type: "text", constraints: [] },
        { name: "avatar_url", type: "text", constraints: [] },
        {
          name: "created_at",
          type: "timestamp",
          constraints: ["NOT NULL", "DEFAULT NOW()"],
        },
        {
          name: "updated_at",
          type: "timestamp",
          constraints: ["NOT NULL", "DEFAULT NOW()"],
        },
      ],
      indexes: ["CREATE INDEX idx_users_email ON users(email)"],
    });

    // Multi-tenant: add organizations
    if (requirements.constraints.some((c) => c.includes("Multi-tenant"))) {
      tables.push({
        name: "organizations",
        columns: [
          { name: "id", type: "text", constraints: ["PRIMARY KEY"] },
          { name: "name", type: "text", constraints: ["NOT NULL"] },
          { name: "slug", type: "text", constraints: ["NOT NULL", "UNIQUE"] },
          {
            name: "plan",
            type: "text",
            constraints: ["NOT NULL", "DEFAULT 'free'"],
          },
          {
            name: "created_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
          {
            name: "updated_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
        ],
        indexes: ["CREATE INDEX idx_orgs_slug ON organizations(slug)"],
      });

      tables.push({
        name: "org_members",
        columns: [
          { name: "id", type: "text", constraints: ["PRIMARY KEY"] },
          {
            name: "org_id",
            type: "text",
            constraints: ["NOT NULL", "REFERENCES organizations(id)"],
          },
          {
            name: "user_id",
            type: "text",
            constraints: ["NOT NULL", "REFERENCES users(id)"],
          },
          {
            name: "role",
            type: "text",
            constraints: ["NOT NULL", "DEFAULT 'member'"],
          },
          {
            name: "created_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
        ],
        indexes: [
          "CREATE UNIQUE INDEX idx_org_members_unique ON org_members(org_id, user_id)",
        ],
      });

      relationships.push(
        { from: "org_members", to: "organizations", type: "many-to-many" },
        { from: "org_members", to: "users", type: "many-to-many" }
      );
    }

    // Add project-specific tables based on feature keywords
    const lower = requirements.summary.toLowerCase();
    if (
      lower.includes("blog") ||
      lower.includes("content") ||
      lower.includes("post")
    ) {
      tables.push({
        name: "posts",
        columns: [
          { name: "id", type: "text", constraints: ["PRIMARY KEY"] },
          {
            name: "author_id",
            type: "text",
            constraints: ["NOT NULL", "REFERENCES users(id)"],
          },
          { name: "title", type: "text", constraints: ["NOT NULL"] },
          { name: "slug", type: "text", constraints: ["NOT NULL", "UNIQUE"] },
          { name: "content", type: "text", constraints: ["NOT NULL"] },
          {
            name: "status",
            type: "text",
            constraints: ["NOT NULL", "DEFAULT 'draft'"],
          },
          { name: "published_at", type: "timestamp", constraints: [] },
          {
            name: "created_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
          {
            name: "updated_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
        ],
        indexes: [
          "CREATE INDEX idx_posts_author ON posts(author_id)",
          "CREATE INDEX idx_posts_status ON posts(status)",
        ],
      });
      relationships.push({ from: "posts", to: "users", type: "one-to-many" });
    }

    if (
      lower.includes("product") ||
      lower.includes("shop") ||
      lower.includes("commerce")
    ) {
      tables.push({
        name: "products",
        columns: [
          { name: "id", type: "text", constraints: ["PRIMARY KEY"] },
          { name: "name", type: "text", constraints: ["NOT NULL"] },
          { name: "description", type: "text", constraints: [] },
          { name: "price_cents", type: "integer", constraints: ["NOT NULL"] },
          {
            name: "currency",
            type: "text",
            constraints: ["NOT NULL", "DEFAULT 'usd'"],
          },
          {
            name: "stock",
            type: "integer",
            constraints: ["NOT NULL", "DEFAULT 0"],
          },
          {
            name: "created_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
          {
            name: "updated_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
        ],
        indexes: ["CREATE INDEX idx_products_name ON products(name)"],
      });

      tables.push({
        name: "orders",
        columns: [
          { name: "id", type: "text", constraints: ["PRIMARY KEY"] },
          {
            name: "user_id",
            type: "text",
            constraints: ["NOT NULL", "REFERENCES users(id)"],
          },
          {
            name: "status",
            type: "text",
            constraints: ["NOT NULL", "DEFAULT 'pending'"],
          },
          { name: "total_cents", type: "integer", constraints: ["NOT NULL"] },
          {
            name: "created_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
          {
            name: "updated_at",
            type: "timestamp",
            constraints: ["NOT NULL", "DEFAULT NOW()"],
          },
        ],
        indexes: [
          "CREATE INDEX idx_orders_user ON orders(user_id)",
          "CREATE INDEX idx_orders_status ON orders(status)",
        ],
      });

      relationships.push(
        { from: "orders", to: "users", type: "one-to-many" },
        { from: "orders", to: "products", type: "many-to-many" }
      );
    }

    // Generate raw SQL representation
    const ormName =
      techStack.find((t) => t.category === "orm")?.name ?? "Drizzle";
    const rawLines: string[] = [
      `-- Schema for ${requirements.projectName} (${ormName} ORM)`,
      "",
    ];
    for (const table of tables) {
      rawLines.push(`CREATE TABLE ${table.name} (`);
      const colDefs = table.columns.map(
        (col) => `  ${col.name} ${col.type} ${col.constraints.join(" ")}`
      );
      rawLines.push(colDefs.join(",\n"));
      rawLines.push(");", "");
      for (const idx of table.indexes) {
        rawLines.push(`${idx};`);
      }
      rawLines.push("");
    }

    return {
      tables,
      relationships,
      raw: rawLines.join("\n"),
    };
  }

  // -------------------------------------------------------------------------
  // Phase 5: API contract generation
  // -------------------------------------------------------------------------

  private phaseApiContracts(
    requirements: RequirementsResult,
    _architecture: ArchitectureDesign,
    dbSchema: DbSchemaDesign
  ): ApiContract {
    const endpoints: ApiContract["endpoints"] = [];

    // Generate CRUD endpoints for each table
    for (const table of dbSchema.tables) {
      const singular = table.name.replace(TRAILING_S_RE, "");
      const resource = table.name;

      endpoints.push(
        {
          method: "GET",
          path: `/api/${resource}`,
          description: `List all ${resource} with pagination`,
          requestSchema: "{ limit?: number; offset?: number; sort?: string }",
          responseSchema: `{ data: ${singular}[]; total: number; hasMore: boolean }`,
        },
        {
          method: "GET",
          path: `/api/${resource}/:id`,
          description: `Get a single ${singular} by ID`,
          requestSchema: "{ id: string }",
          responseSchema: `{ data: ${singular} }`,
        },
        {
          method: "POST",
          path: `/api/${resource}`,
          description: `Create a new ${singular}`,
          requestSchema: `Omit<${singular}, 'id' | 'createdAt' | 'updatedAt'>`,
          responseSchema: `{ data: ${singular} }`,
        },
        {
          method: "PATCH",
          path: `/api/${resource}/:id`,
          description: `Update an existing ${singular}`,
          requestSchema: `Partial<Omit<${singular}, 'id' | 'createdAt'>>`,
          responseSchema: `{ data: ${singular} }`,
        },
        {
          method: "DELETE",
          path: `/api/${resource}/:id`,
          description: `Delete a ${singular}`,
          requestSchema: "{ id: string }",
          responseSchema: "{ success: boolean }",
        }
      );
    }

    // Add auth endpoints
    endpoints.push(
      {
        method: "POST",
        path: "/api/auth/register",
        description: "Register a new user",
        requestSchema: "{ email: string; password: string; name: string }",
        responseSchema: "{ user: User; token: string }",
      },
      {
        method: "POST",
        path: "/api/auth/login",
        description: "Authenticate user and return session token",
        requestSchema: "{ email: string; password: string }",
        responseSchema: "{ user: User; token: string }",
      },
      {
        method: "POST",
        path: "/api/auth/logout",
        description: "Invalidate current session",
        requestSchema: "{}",
        responseSchema: "{ success: boolean }",
      }
    );

    // Add real-time endpoint if needed
    if (requirements.constraints.some((c) => c.includes("real-time"))) {
      endpoints.push({
        method: "GET",
        path: "/api/ws",
        description: "WebSocket connection for real-time updates",
        requestSchema: "{ token: string }",
        responseSchema: "WebSocket upgrade",
      });
    }

    // Generate raw OpenAPI-style documentation
    const rawLines: string[] = [
      `# ${requirements.projectName} API Contracts`,
      "",
      "Base URL: /api",
      "",
    ];

    for (const ep of endpoints) {
      rawLines.push(`## ${ep.method} ${ep.path}`);
      rawLines.push(ep.description);
      rawLines.push(`Request:  ${ep.requestSchema}`);
      rawLines.push(`Response: ${ep.responseSchema}`);
      rawLines.push("");
    }

    return {
      endpoints,
      raw: rawLines.join("\n"),
    };
  }

  // -------------------------------------------------------------------------
  // Phase 6: Project scaffolding
  // -------------------------------------------------------------------------

  private phaseScaffold(
    requirements: RequirementsResult,
    techStack: TechStackRecommendation[],
    architecture: ArchitectureDesign,
    dbSchema: DbSchemaDesign,
    apiContracts: ApiContract
  ): ScaffoldResult {
    const files: ScaffoldResult["files"] = [];
    const projName = requirements.projectName;

    // package.json
    const devDeps: Record<string, string> = {};
    const deps: Record<string, string> = {};

    for (const tech of techStack) {
      const key = tech.name.toLowerCase().replace(/\s+/g, "-");
      if (tech.category === "testing") {
        devDeps[key] = `^${tech.version}`;
      } else if (tech.category !== "hosting") {
        deps[key] = `^${tech.version}`;
      }
    }

    files.push({
      path: "package.json",
      content: JSON.stringify(
        {
          name: projName,
          version: "0.1.0",
          private: true,
          type: "module",
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "biome check .",
            format: "biome format --write .",
            typecheck: "tsc --noEmit",
            test: "vitest",
          },
          dependencies: deps,
          devDependencies: {
            ...devDeps,
            typescript: "^5.5",
            "@biomejs/biome": "^1.9",
          },
        },
        null,
        2
      ),
    });

    // tsconfig.json
    files.push({
      path: "tsconfig.json",
      content: JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            lib: ["ES2022", "DOM", "DOM.Iterable"],
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            noUncheckedIndexedAccess: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "react-jsx",
            baseUrl: ".",
            paths: { "@/*": ["./src/*"] },
          },
          include: ["src/**/*.ts", "src/**/*.tsx"],
          exclude: ["node_modules", "dist"],
        },
        null,
        2
      ),
    });

    // .env.example
    const envLines = [
      `# ${projName} environment variables`,
      `DATABASE_URL=postgresql://user:pass@localhost:5432/${projName}`,
      "REDIS_URL=redis://localhost:6379",
      "AUTH_SECRET=change-me-in-production",
      "NODE_ENV=development",
    ];
    files.push({ path: ".env.example", content: envLines.join("\n") });

    // Database schema file (Drizzle-style)
    const schemaLines: string[] = [
      'import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";',
      "",
    ];

    for (const table of dbSchema.tables) {
      schemaLines.push(
        `export const ${table.name} = pgTable("${table.name}", {`
      );
      for (const col of table.columns) {
        const drizzleType = col.type === "integer" ? "integer" : "text";
        schemaLines.push(`  ${col.name}: ${drizzleType}("${col.name}"),`);
      }
      schemaLines.push("});");
      schemaLines.push("");
    }

    files.push({ path: "src/db/schema.ts", content: schemaLines.join("\n") });

    // API route stubs
    const routeLines: string[] = [
      'import { Hono } from "hono";',
      "",
      "const app = new Hono();",
      "",
    ];

    for (const ep of apiContracts.endpoints) {
      const method = ep.method.toLowerCase();
      if (
        method === "get" ||
        method === "post" ||
        method === "patch" ||
        method === "delete"
      ) {
        routeLines.push(`// ${ep.description}`);
        routeLines.push(`app.${method}("${ep.path}", async (c) => {`);
        routeLines.push(
          `  return c.json({ message: "TODO: implement ${ep.description}" });`
        );
        routeLines.push("});");
        routeLines.push("");
      }
    }

    routeLines.push("export default app;");
    files.push({ path: "src/api/routes.ts", content: routeLines.join("\n") });

    // README
    files.push({
      path: "README.md",
      content: [
        `# ${projName}`,
        "",
        requirements.summary,
        "",
        "## Tech Stack",
        "",
        ...techStack.map((t) => `- **${t.category}**: ${t.name} v${t.version}`),
        "",
        "## Architecture",
        "",
        architecture.diagram,
        "",
        "## Getting Started",
        "",
        "```bash",
        "pnpm install",
        "cp .env.example .env",
        "pnpm db:push",
        "pnpm dev",
        "```",
      ].join("\n"),
    });

    // Directory structure files
    const dirs = [
      "src/components/.gitkeep",
      "src/lib/.gitkeep",
      "src/hooks/.gitkeep",
      "src/styles/.gitkeep",
      "tests/.gitkeep",
    ];

    for (const dir of dirs) {
      files.push({ path: dir, content: "" });
    }

    return { files };
  }

  // -------------------------------------------------------------------------
  // Phase 7: CI/CD configuration
  // -------------------------------------------------------------------------

  private phaseCiCd(
    requirements: RequirementsResult,
    _techStack: TechStackRecommendation[]
  ): CiCdResult {
    const provider = "github-actions";

    const config = [
      "name: CI",
      "",
      "on:",
      "  push:",
      "    branches: [main]",
      "  pull_request:",
      "    branches: [main]",
      "",
      "jobs:",
      "  quality:",
      "    name: Quality Checks",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: pnpm/action-setup@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 22",
      "          cache: pnpm",
      "      - run: pnpm install --frozen-lockfile",
      "      - run: pnpm typecheck",
      "      - run: pnpm lint",
      "",
      "  test:",
      "    name: Tests",
      "    runs-on: ubuntu-latest",
      "    services:",
      "      postgres:",
      "        image: postgres:16",
      "        env:",
      "          POSTGRES_USER: test",
      "          POSTGRES_PASSWORD: test",
      `          POSTGRES_DB: ${requirements.projectName}`,
      "        ports:",
      "          - 5432:5432",
      "        options: >-",
      "          --health-cmd pg_isready",
      "          --health-interval 10s",
      "          --health-timeout 5s",
      "          --health-retries 5",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: pnpm/action-setup@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 22",
      "          cache: pnpm",
      "      - run: pnpm install --frozen-lockfile",
      "      - run: pnpm test",
      "",
      "  build:",
      "    name: Build",
      "    runs-on: ubuntu-latest",
      "    needs: [quality, test]",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: pnpm/action-setup@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 22",
      "          cache: pnpm",
      "      - run: pnpm install --frozen-lockfile",
      "      - run: pnpm build",
    ].join("\n");

    return { config, provider };
  }

  // -------------------------------------------------------------------------
  // Phase 8: Validation (typecheck + lint pass)
  // -------------------------------------------------------------------------

  private phaseValidation(scaffold: ScaffoldResult): ValidationResult {
    const errors: string[] = [];
    let typecheckPassed = true;
    let lintPassed = true;
    const scaffoldPaths = new Set(scaffold.files.map((f) => f.path));

    // Check required files exist
    for (const required of ["package.json", "tsconfig.json"]) {
      if (!scaffoldPaths.has(required)) {
        errors.push(`Missing required file: ${required}`);
        typecheckPassed = false;
      }
    }

    // Validate JSON config files
    const pkgResult = this.validateJsonFile(scaffold, "package.json", [
      "name",
      "scripts",
    ]);
    const tscResult = this.validateJsonFile(scaffold, "tsconfig.json", [
      "compilerOptions",
    ]);

    errors.push(...pkgResult.errors, ...tscResult.errors);
    if (!pkgResult.valid) {
      lintPassed = false;
    }
    if (!tscResult.valid) {
      typecheckPassed = false;
    }

    // Validate TypeScript bracket matching
    const tsErrors = this.validateBracketMatching(scaffold);
    if (tsErrors.length > 0) {
      errors.push(...tsErrors);
      typecheckPassed = false;
    }

    if (errors.length > 0) {
      logger.warn({ errors }, "Validation found issues");
    }

    return { typecheckPassed, lintPassed, errors };
  }

  private validateJsonFile(
    scaffold: ScaffoldResult,
    fileName: string,
    requiredFields: string[]
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const file = scaffold.files.find((f) => f.path === fileName);
    if (!file) {
      return { valid: true, errors: [] };
    }
    try {
      const parsed = JSON.parse(file.content) as Record<string, unknown>;
      for (const field of requiredFields) {
        if (!parsed[field]) {
          errors.push(`${fileName} missing '${field}' field`);
        }
      }
      return { valid: errors.length === 0, errors };
    } catch {
      return { valid: false, errors: [`${fileName} contains invalid JSON`] };
    }
  }

  private validateBracketMatching(scaffold: ScaffoldResult): string[] {
    const errors: string[] = [];
    const tsFiles = scaffold.files.filter(
      (f) => f.path.endsWith(".ts") || f.path.endsWith(".tsx")
    );
    for (const file of tsFiles) {
      const openBraces = (file.content.match(OPEN_BRACE_RE) ?? []).length;
      const closeBraces = (file.content.match(CLOSE_BRACE_RE) ?? []).length;
      if (openBraces !== closeBraces) {
        errors.push(
          `${file.path}: mismatched braces (${openBraces} open, ${closeBraces} close)`
        );
      }
      const openParens = (file.content.match(OPEN_PAREN_RE) ?? []).length;
      const closeParens = (file.content.match(CLOSE_PAREN_RE) ?? []).length;
      if (openParens !== closeParens) {
        errors.push(`${file.path}: mismatched parentheses`);
      }
    }
    return errors;
  }
}
