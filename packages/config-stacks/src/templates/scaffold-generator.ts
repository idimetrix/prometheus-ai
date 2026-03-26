/**
 * Scaffold Generator (GAP-025)
 *
 * Generates project scaffolding blueprints from tech stack presets.
 * The blueprint is a structured plan an agent can follow to create
 * a working project from scratch, including:
 * - Directory structure
 * - File list with descriptions
 * - Dependency installation commands
 * - Configuration files
 * - Agent execution steps
 */

import {
  EXTENDED_PRESETS,
  getExtendedPreset,
  type TechStackPresetExtended,
} from "../presets/index";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScaffoldBlueprint {
  /** Hints for agent roles working on this project */
  agentHints: Record<string, string>;

  /** Agent execution steps (ordered) */
  agentSteps: AgentStep[];

  /** Description of what this project will be */
  description: string;

  /** Directory structure as path -> description map */
  directories: Record<string, string>;

  /** Environment variables needed (key -> description) */
  envVars: Record<string, string>;

  /** Files to create: path -> description/purpose */
  files: Record<string, string>;
  /** Unique ID for this blueprint */
  id: string;

  /** Preset used to generate this blueprint */
  presetId: string;

  /** Human-readable project name */
  projectName: string;

  /** Ordered list of setup commands to run */
  setupCommands: string[];

  /** Validation checks to run after scaffolding */
  validationChecks: string[];
}

export interface AgentStep {
  /** Files this step creates or modifies */
  affectedFiles: string[];

  /** Which agent role should handle this */
  agentRole: string;

  /** Detailed description of what to do */
  description: string;

  /** Step name */
  name: string;
  /** Step order (1-based) */
  order: number;
}

// ---------------------------------------------------------------------------
// Template generation for each preset type
// ---------------------------------------------------------------------------

function generateNextjsBlueprint(
  projectName: string,
  preset: TechStackPresetExtended
): Partial<ScaffoldBlueprint> {
  return {
    setupCommands: [
      `pnpm create next-app@latest ${projectName} --typescript --tailwind --eslint --app --src-dir`,
      `cd ${projectName} && pnpm add ${Object.entries(
        preset.dependencies.runtime
      )
        .map(([k, v]) => `${k}@${v}`)
        .join(" ")}`,
      `cd ${projectName} && pnpm add -D ${Object.entries(
        preset.dependencies.dev
      )
        .map(([k, v]) => `${k}@${v}`)
        .join(" ")}`,
    ],
    directories: {
      "src/app": "Next.js App Router pages and layouts",
      "src/components": "Shared React components",
      "src/lib": "Utility functions and client setup",
      "src/server": "Server-side code (tRPC, DB)",
      "src/server/db": "Database schema and migrations",
      "src/server/trpc": "tRPC router definitions",
    },
    envVars: {
      DATABASE_URL: "PostgreSQL connection string",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "Clerk frontend key",
      CLERK_SECRET_KEY: "Clerk backend secret",
    },
    validationChecks: [
      "pnpm build completes without errors",
      "pnpm typecheck passes",
      "pnpm dev starts and http://localhost:3000 responds with 200",
      "Database tables created via pnpm db:push",
    ],
  };
}

function generateDjangoReactBlueprint(
  projectName: string,
  preset: TechStackPresetExtended
): Partial<ScaffoldBlueprint> {
  return {
    setupCommands: [
      `mkdir -p ${projectName}/{backend,frontend}`,
      `cd ${projectName}/backend && python -m venv .venv && source .venv/bin/activate && pip install ${Object.keys(preset.dependencies.runtime).join(" ")}`,
      `cd ${projectName}/backend && django-admin startproject config .`,
      `cd ${projectName}/frontend && pnpm create vite . --template react-ts`,
    ],
    directories: {
      "backend/config": "Django project configuration",
      "backend/apps/core": "Core Django application",
      "backend/apps/core/migrations": "Database migrations",
      "frontend/src": "React application source",
      "frontend/src/api": "API client and types",
      "frontend/src/components": "React components",
    },
    envVars: {
      DATABASE_URL: "PostgreSQL connection string",
      DJANGO_SECRET_KEY: "Django secret key",
      DJANGO_DEBUG: "Debug mode (True/False)",
      CORS_ALLOWED_ORIGINS: "Allowed frontend origins",
    },
    validationChecks: [
      "Django migrations apply without errors",
      "Django dev server starts on port 8000",
      "Frontend builds without errors",
      "API health check responds with 200",
    ],
  };
}

function generateRailsBlueprint(
  projectName: string,
  _preset: TechStackPresetExtended
): Partial<ScaffoldBlueprint> {
  return {
    setupCommands: [
      `rails new ${projectName} --database=postgresql --css=tailwind --skip-jbuilder`,
      `cd ${projectName} && bundle add devise hotwire-rails`,
      `cd ${projectName} && rails generate devise:install`,
    ],
    directories: {
      "app/models": "Active Record models",
      "app/controllers": "Rails controllers",
      "app/views": "ERB/Hotwire views",
      "app/javascript": "Stimulus controllers and Turbo streams",
      "db/migrate": "Database migrations",
      spec: "RSpec test files",
    },
    envVars: {
      DATABASE_URL: "PostgreSQL connection string",
      RAILS_MASTER_KEY: "Rails master encryption key",
      RAILS_ENV: "Environment (development/production)",
    },
    validationChecks: [
      "rails db:migrate runs without errors",
      "rails server starts on port 3000",
      "rspec passes with 0 failures",
      "rails routes lists expected endpoints",
    ],
  };
}

function generateFlutterBlueprint(
  projectName: string,
  _preset: TechStackPresetExtended
): Partial<ScaffoldBlueprint> {
  return {
    setupCommands: [
      `flutter create ${projectName}`,
      `cd ${projectName} && flutter pub add riverpod go_router dio freezed_annotation json_annotation`,
      `cd ${projectName} && flutter pub add -d build_runner freezed json_serializable`,
    ],
    directories: {
      lib: "Dart source code",
      "lib/features": "Feature-based modules",
      "lib/core": "Shared utilities and themes",
      "lib/models": "Data models",
      test: "Widget and unit tests",
    },
    envVars: {
      API_BASE_URL: "Backend API base URL",
      SUPABASE_URL: "Supabase project URL",
      SUPABASE_ANON_KEY: "Supabase anonymous key",
    },
    validationChecks: [
      "flutter analyze finds no issues",
      "flutter test passes",
      "flutter build apk --debug succeeds",
    ],
  };
}

function generateGoBlueprint(
  projectName: string,
  _preset: TechStackPresetExtended
): Partial<ScaffoldBlueprint> {
  return {
    setupCommands: [
      `mkdir -p ${projectName} && cd ${projectName} && go mod init github.com/org/${projectName}`,
      `cd ${projectName} && go get github.com/go-chi/chi/v5 github.com/jackc/pgx/v5`,
    ],
    directories: {
      cmd: "Application entry points",
      internal: "Private application code",
      "internal/handler": "HTTP handlers",
      "internal/model": "Domain models",
      "internal/store": "Database access layer",
      "internal/middleware": "HTTP middleware",
    },
    envVars: {
      DATABASE_URL: "PostgreSQL connection string",
      PORT: "HTTP server port",
      JWT_SECRET: "JWT signing secret",
    },
    validationChecks: [
      "go build ./... succeeds",
      "go test ./... passes",
      "go vet ./... reports no issues",
    ],
  };
}

// ---------------------------------------------------------------------------
// Default blueprint for presets without specific generators
// ---------------------------------------------------------------------------

function generateDefaultBlueprint(
  projectName: string,
  _preset: TechStackPresetExtended
): Partial<ScaffoldBlueprint> {
  return {
    setupCommands: [`mkdir -p ${projectName}`, `cd ${projectName}`],
    directories: {
      src: "Application source code",
      tests: "Test files",
      config: "Configuration files",
    },
    envVars: {
      DATABASE_URL: "Database connection string",
    },
    validationChecks: ["Project builds successfully", "Tests pass"],
  };
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/** Regex to split on whitespace for keyword matching */
const WHITESPACE_RE = /\s+/;

const PRESET_GENERATORS: Record<
  string,
  (name: string, preset: TechStackPresetExtended) => Partial<ScaffoldBlueprint>
> = {
  "nextjs-fullstack": generateNextjsBlueprint,
  "django-react": generateDjangoReactBlueprint,
  rails: generateRailsBlueprint,
  flutter: generateFlutterBlueprint,
  "go-htmx": generateGoBlueprint,
  "rust-axum": generateDefaultBlueprint,
  "react-native": generateFlutterBlueprint,
  "laravel-vue": generateDefaultBlueprint,
};

/**
 * Generate a project scaffolding blueprint from a preset ID.
 */
export function generateScaffoldBlueprint(
  presetId: string,
  projectName: string,
  description?: string
): ScaffoldBlueprint | null {
  const preset = getExtendedPreset(presetId);
  if (!preset) {
    return null;
  }

  const generator = PRESET_GENERATORS[presetId] ?? generateDefaultBlueprint;
  const specific = generator(projectName, preset);

  // Build agent steps from the preset's file templates
  const agentSteps: AgentStep[] = [
    {
      order: 1,
      name: "Initialize project",
      description: `Run setup commands to bootstrap the ${preset.name} project`,
      agentRole: "deploy_engineer",
      affectedFiles: ["package.json", "tsconfig.json"],
    },
    {
      order: 2,
      name: "Create project structure",
      description: `Create directory structure and initial configuration files for ${preset.name}`,
      agentRole: "architect",
      affectedFiles: Object.keys(specific.directories ?? {}),
    },
    {
      order: 3,
      name: "Implement core files",
      description: "Generate the core application files from templates",
      agentRole: "backend_coder",
      affectedFiles: Object.keys(preset.fileTemplates),
    },
    {
      order: 4,
      name: "Configure environment",
      description: "Set up environment variables and configuration",
      agentRole: "deploy_engineer",
      affectedFiles: [".env.example", ".env"],
    },
    {
      order: 5,
      name: "Validate scaffolding",
      description:
        "Run validation checks to ensure the project builds and tests pass",
      agentRole: "test_engineer",
      affectedFiles: [],
    },
  ];

  return {
    id: `scaffold-${presetId}-${Date.now()}`,
    presetId,
    projectName,
    description:
      description ?? `New ${preset.name} project: ${preset.description}`,
    setupCommands: specific.setupCommands ?? [],
    directories: specific.directories ?? {},
    files: preset.fileTemplates,
    envVars: specific.envVars ?? {},
    agentSteps,
    agentHints: preset.agentHints,
    validationChecks: specific.validationChecks ?? [],
  };
}

/**
 * List all available scaffold template IDs.
 */
export function listScaffoldTemplates(): Array<{
  id: string;
  name: string;
  description: string;
  languages: string[];
}> {
  return Object.values(EXTENDED_PRESETS).map((preset) => ({
    id: preset.id,
    name: preset.name,
    description: preset.description,
    languages: preset.languages,
  }));
}

/**
 * Get a scaffold template by matching a natural language query.
 * Matches against name, description, languages, and frameworks.
 */
export function matchScaffoldTemplate(
  query: string
): TechStackPresetExtended | null {
  const lower = query.toLowerCase();

  // Exact ID match first
  const exactMatch = getExtendedPreset(lower);
  if (exactMatch) {
    return exactMatch;
  }

  // Score each preset by keyword overlap
  let bestPreset: TechStackPresetExtended | null = null;
  let bestScore = 0;

  for (const preset of Object.values(EXTENDED_PRESETS)) {
    let score = 0;
    const searchable = [
      preset.name,
      preset.description,
      ...preset.languages,
      ...preset.frameworks,
    ]
      .join(" ")
      .toLowerCase();

    for (const word of lower.split(WHITESPACE_RE)) {
      if (word.length >= 2 && searchable.includes(word)) {
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPreset = preset;
    }
  }

  return bestScore > 0 ? bestPreset : null;
}
