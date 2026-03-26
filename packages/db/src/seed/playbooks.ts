/**
 * Built-in playbook seed data.
 * Each playbook includes step definitions, parameter definitions, and metadata.
 */
export const builtinPlaybooks = [
  {
    name: "Fix Lint Errors",
    description:
      "Run the project linter, auto-fix all fixable issues, review remaining errors, and commit the changes.",
    category: "code_quality" as const,
    tags: ["lint", "code-quality", "auto-fix"],
    steps: [
      {
        order: 1,
        title: "Run linter in check mode",
        description:
          "Execute the project linter (ESLint, Biome, etc.) to identify all lint errors and warnings.",
        expectedOutput: "List of lint errors with file paths and line numbers",
      },
      {
        order: 2,
        title: "Auto-fix all fixable issues",
        description:
          "Run the linter with --fix or equivalent flag to automatically resolve fixable issues.",
        expectedOutput: "Summary of auto-fixed issues",
      },
      {
        order: 3,
        title: "Review remaining errors",
        description:
          "Analyze remaining unfixable lint errors and apply manual fixes where possible.",
        expectedOutput: "All lint errors resolved or documented",
      },
      {
        order: 4,
        title: "Run linter again to verify",
        description: "Re-run the linter to confirm all issues are resolved.",
        expectedOutput: "Clean lint output with no errors",
      },
      {
        order: 5,
        title: "Commit changes",
        description:
          "Stage all modified files and create a commit with a descriptive message.",
        expectedOutput: "Git commit with lint fixes",
      },
    ],
    parameters: [
      {
        name: "target_path",
        type: "string" as const,
        description:
          "Directory or file path to lint (defaults to entire project)",
        required: false,
        default: ".",
      },
      {
        name: "fix_unsafe",
        type: "boolean" as const,
        description: "Whether to apply unsafe auto-fixes",
        required: false,
        default: false,
      },
    ],
  },
  {
    name: "Add API Endpoint",
    description:
      "Create a new tRPC or REST endpoint with input validation, error handling, and tests.",
    category: "feature" as const,
    tags: ["api", "endpoint", "trpc", "backend"],
    steps: [
      {
        order: 1,
        title: "Define input/output schemas",
        description:
          "Create Zod validation schemas for the endpoint's request and response types.",
        expectedOutput: "Zod schemas in the validators package",
      },
      {
        order: 2,
        title: "Create the router procedure",
        description:
          "Implement the tRPC procedure with proper authentication, input validation, and business logic.",
        expectedOutput: "Working tRPC procedure",
      },
      {
        order: 3,
        title: "Add database queries if needed",
        description:
          "Implement any required database queries using Drizzle ORM with proper RLS scoping.",
        expectedOutput: "Database queries with org_id scoping",
      },
      {
        order: 4,
        title: "Register the router",
        description:
          "Add the new router to the main app router if it is a new router file.",
        expectedOutput: "Router registered and accessible",
      },
      {
        order: 5,
        title: "Write unit tests",
        description:
          "Create tests covering success cases, validation errors, and authorization checks.",
        expectedOutput: "Passing test suite for the new endpoint",
      },
    ],
    parameters: [
      {
        name: "endpoint_name",
        type: "string" as const,
        description:
          "Name of the new endpoint (e.g., 'getUser', 'createProject')",
        required: true,
      },
      {
        name: "http_method",
        type: "select" as const,
        description: "HTTP method / tRPC type",
        required: true,
        default: "query",
        options: ["query", "mutation"],
      },
      {
        name: "requires_auth",
        type: "boolean" as const,
        description: "Whether the endpoint requires authentication",
        required: false,
        default: true,
      },
    ],
  },
  {
    name: "Add Database Table",
    description:
      "Create a new database table with Drizzle schema, relations, types, and migration.",
    category: "feature" as const,
    tags: ["database", "schema", "migration", "drizzle"],
    steps: [
      {
        order: 1,
        title: "Create table schema",
        description:
          "Define the table using Drizzle pgTable with columns, indexes, and foreign keys.",
        expectedOutput:
          "Table definition file in packages/db/src/schema/tables/",
      },
      {
        order: 2,
        title: "Define relations",
        description:
          "Create Drizzle relations for the new table connecting it to related tables.",
        expectedOutput: "Relations file with proper one/many definitions",
      },
      {
        order: 3,
        title: "Create types",
        description:
          "Generate insert/select schemas and TypeScript types using drizzle-zod.",
        expectedOutput:
          "Types file with insert/select schemas and inferred types",
      },
      {
        order: 4,
        title: "Export from index",
        description:
          "Add exports to the table directory index and the main tables index.",
        expectedOutput: "New table accessible from @prometheus/db",
      },
      {
        order: 5,
        title: "Generate migration",
        description: "Run pnpm db:generate to create the SQL migration file.",
        expectedOutput: "Migration file in drizzle/ directory",
      },
    ],
    parameters: [
      {
        name: "table_name",
        type: "string" as const,
        description: "Name of the new table (snake_case)",
        required: true,
      },
      {
        name: "has_org_scope",
        type: "boolean" as const,
        description: "Whether the table should have an org_id column for RLS",
        required: false,
        default: true,
      },
    ],
  },
  {
    name: "Upgrade Dependency",
    description:
      "Upgrade a specific package dependency, fix any breaking changes, and verify tests pass.",
    category: "devops" as const,
    tags: ["dependency", "upgrade", "maintenance"],
    steps: [
      {
        order: 1,
        title: "Check current version and changelog",
        description:
          "Identify the current version and review the changelog for breaking changes.",
        expectedOutput: "Current version and list of breaking changes",
      },
      {
        order: 2,
        title: "Upgrade the package",
        description:
          "Run pnpm update to upgrade the package to the target version.",
        expectedOutput: "Package upgraded in package.json and lockfile",
      },
      {
        order: 3,
        title: "Fix breaking changes",
        description:
          "Address any breaking API changes, deprecated features, or type incompatibilities.",
        expectedOutput: "All breaking changes resolved",
      },
      {
        order: 4,
        title: "Run type check",
        description:
          "Execute pnpm typecheck to verify TypeScript compilation succeeds.",
        expectedOutput: "No TypeScript errors",
      },
      {
        order: 5,
        title: "Run tests",
        description: "Execute the full test suite to verify nothing is broken.",
        expectedOutput: "All tests passing",
      },
      {
        order: 6,
        title: "Commit changes",
        description:
          "Create a commit with the dependency upgrade and any related fixes.",
        expectedOutput: "Commit with upgrade changes",
      },
    ],
    parameters: [
      {
        name: "package_name",
        type: "string" as const,
        description:
          "Name of the package to upgrade (e.g., 'react', '@trpc/server')",
        required: true,
      },
      {
        name: "target_version",
        type: "string" as const,
        description: "Target version to upgrade to (e.g., '19.0.0', 'latest')",
        required: false,
        default: "latest",
      },
    ],
  },
  {
    name: "Add Unit Tests",
    description:
      "Generate comprehensive unit tests for untested or under-tested files.",
    category: "testing" as const,
    tags: ["testing", "unit-tests", "coverage"],
    steps: [
      {
        order: 1,
        title: "Identify untested files",
        description:
          "Analyze the target directory to find files without corresponding test files.",
        expectedOutput: "List of files needing tests",
      },
      {
        order: 2,
        title: "Analyze function signatures",
        description:
          "Read each untested file and identify exported functions, their parameters, and return types.",
        expectedOutput: "Function inventory with types",
      },
      {
        order: 3,
        title: "Generate test files",
        description:
          "Create test files with describe/it blocks covering success cases, edge cases, and error cases.",
        expectedOutput: "Test files alongside source files",
      },
      {
        order: 4,
        title: "Run tests",
        description: "Execute the new tests to verify they pass.",
        expectedOutput: "All new tests passing",
      },
    ],
    parameters: [
      {
        name: "target_path",
        type: "string" as const,
        description: "Directory or file path to generate tests for",
        required: true,
      },
      {
        name: "test_framework",
        type: "select" as const,
        description: "Testing framework to use",
        required: false,
        default: "vitest",
        options: ["vitest", "jest"],
      },
    ],
  },
  {
    name: "Add E2E Tests",
    description:
      "Generate end-to-end tests for a feature using Playwright or Cypress.",
    category: "testing" as const,
    tags: ["testing", "e2e", "playwright", "integration"],
    steps: [
      {
        order: 1,
        title: "Identify user flows",
        description:
          "Analyze the feature and identify critical user flows to test.",
        expectedOutput: "List of user flow scenarios",
      },
      {
        order: 2,
        title: "Set up test fixtures",
        description: "Create test data fixtures and setup/teardown helpers.",
        expectedOutput: "Test fixtures and helpers",
      },
      {
        order: 3,
        title: "Write E2E test scenarios",
        description:
          "Implement E2E tests covering the identified user flows with assertions.",
        expectedOutput: "E2E test files with complete scenarios",
      },
      {
        order: 4,
        title: "Run E2E tests",
        description:
          "Execute the E2E tests to verify they pass against the running application.",
        expectedOutput: "All E2E tests passing",
      },
    ],
    parameters: [
      {
        name: "feature_name",
        type: "string" as const,
        description:
          "Name of the feature to test (e.g., 'user-login', 'project-creation')",
        required: true,
      },
      {
        name: "base_url",
        type: "string" as const,
        description: "Base URL of the application",
        required: false,
        default: "http://localhost:3000",
      },
    ],
  },
  {
    name: "Fix TypeScript Errors",
    description:
      "Identify and fix all TypeScript compilation errors across the project.",
    category: "code_quality" as const,
    tags: ["typescript", "type-safety", "compilation"],
    steps: [
      {
        order: 1,
        title: "Run type checker",
        description:
          "Execute pnpm typecheck to get the full list of TypeScript errors.",
        expectedOutput: "Complete list of TypeScript errors",
      },
      {
        order: 2,
        title: "Categorize errors",
        description:
          "Group errors by type (missing types, incompatible types, missing imports, etc.).",
        expectedOutput: "Categorized error list",
      },
      {
        order: 3,
        title: "Fix type errors",
        description:
          "Resolve each error by adding proper types, fixing imports, or updating interfaces.",
        expectedOutput: "All type errors resolved",
      },
      {
        order: 4,
        title: "Verify clean compilation",
        description: "Re-run pnpm typecheck to confirm zero errors.",
        expectedOutput: "Clean TypeScript compilation",
      },
      {
        order: 5,
        title: "Commit fixes",
        description:
          "Stage and commit all type fixes with a descriptive message.",
        expectedOutput: "Commit with type error fixes",
      },
    ],
    parameters: [
      {
        name: "target_package",
        type: "string" as const,
        description:
          "Specific package to fix (e.g., '@prometheus/api'). Leave empty for all.",
        required: false,
      },
    ],
  },
  {
    name: "Add Authentication",
    description:
      "Add authentication protection to an unprotected route or API endpoint.",
    category: "security" as const,
    tags: ["auth", "security", "middleware", "protection"],
    steps: [
      {
        order: 1,
        title: "Identify unprotected routes",
        description:
          "Scan the target path for routes/endpoints lacking authentication middleware.",
        expectedOutput: "List of unprotected routes",
      },
      {
        order: 2,
        title: "Add auth middleware",
        description:
          "Apply protectedProcedure or auth middleware to the identified routes.",
        expectedOutput: "Auth middleware applied to all routes",
      },
      {
        order: 3,
        title: "Add authorization checks",
        description:
          "Implement role-based or org-scoped authorization where appropriate.",
        expectedOutput: "Authorization checks in place",
      },
      {
        order: 4,
        title: "Handle unauthorized access",
        description:
          "Add proper error responses for unauthenticated and unauthorized requests.",
        expectedOutput: "Proper 401/403 error handling",
      },
      {
        order: 5,
        title: "Test auth flow",
        description:
          "Verify authentication works correctly for both allowed and denied access.",
        expectedOutput: "Auth tests passing",
      },
    ],
    parameters: [
      {
        name: "target_path",
        type: "string" as const,
        description: "Path to the route/endpoint to protect",
        required: true,
      },
      {
        name: "auth_type",
        type: "select" as const,
        description: "Type of authentication to add",
        required: false,
        default: "session",
        options: ["session", "api_key", "oauth"],
      },
    ],
  },
  {
    name: "Security Audit",
    description:
      "Run a comprehensive security scan, identify vulnerabilities, and apply fixes.",
    category: "security" as const,
    tags: ["security", "audit", "vulnerabilities", "scanning"],
    steps: [
      {
        order: 1,
        title: "Run dependency audit",
        description:
          "Execute pnpm audit to identify known vulnerabilities in dependencies.",
        expectedOutput: "Vulnerability report from dependency audit",
      },
      {
        order: 2,
        title: "Scan for hardcoded secrets",
        description:
          "Search codebase for hardcoded API keys, passwords, and tokens.",
        expectedOutput: "List of potential secrets found",
      },
      {
        order: 3,
        title: "Check for common vulnerabilities",
        description:
          "Analyze code for XSS, SQL injection, CSRF, and other OWASP top 10 issues.",
        expectedOutput: "Security vulnerability report",
      },
      {
        order: 4,
        title: "Fix critical issues",
        description:
          "Apply fixes for all critical and high-severity vulnerabilities.",
        expectedOutput: "Critical vulnerabilities resolved",
      },
      {
        order: 5,
        title: "Update vulnerable dependencies",
        description:
          "Upgrade dependencies with known CVEs to patched versions.",
        expectedOutput: "Dependencies updated to secure versions",
      },
      {
        order: 6,
        title: "Generate security report",
        description:
          "Create a summary of findings, fixes applied, and remaining items.",
        expectedOutput: "Security audit report",
      },
    ],
    parameters: [
      {
        name: "scan_level",
        type: "select" as const,
        description: "Depth of security scanning",
        required: false,
        default: "standard",
        options: ["quick", "standard", "deep"],
      },
      {
        name: "auto_fix",
        type: "boolean" as const,
        description: "Whether to automatically fix vulnerabilities",
        required: false,
        default: true,
      },
    ],
  },
  {
    name: "Add Error Handling",
    description:
      "Add comprehensive error handling to a module with proper logging and user-friendly messages.",
    category: "code_quality" as const,
    tags: ["error-handling", "logging", "reliability"],
    steps: [
      {
        order: 1,
        title: "Identify error-prone code",
        description:
          "Analyze the target module for functions lacking try-catch, unchecked promises, and missing validation.",
        expectedOutput: "List of code locations needing error handling",
      },
      {
        order: 2,
        title: "Add try-catch blocks",
        description:
          "Wrap error-prone operations in try-catch with typed error handling.",
        expectedOutput: "Try-catch blocks with proper error types",
      },
      {
        order: 3,
        title: "Add structured logging",
        description:
          "Add logger calls for errors with context (operation, input, stack trace).",
        expectedOutput: "Structured error logging in place",
      },
      {
        order: 4,
        title: "Create user-friendly error messages",
        description:
          "Map internal errors to user-facing messages using TRPCError or custom error classes.",
        expectedOutput: "Clean error messages for clients",
      },
      {
        order: 5,
        title: "Test error scenarios",
        description:
          "Write tests that verify error handling for edge cases and failure modes.",
        expectedOutput: "Error handling tests passing",
      },
    ],
    parameters: [
      {
        name: "target_path",
        type: "string" as const,
        description: "Path to the module to add error handling to",
        required: true,
      },
    ],
  },
  {
    name: "Refactor Component",
    description:
      "Refactor a React component for better structure, readability, and maintainability.",
    category: "refactoring" as const,
    tags: ["react", "refactoring", "components", "clean-code"],
    steps: [
      {
        order: 1,
        title: "Analyze component",
        description:
          "Review the component for code smells: excessive size, mixed concerns, prop drilling, etc.",
        expectedOutput: "List of improvement opportunities",
      },
      {
        order: 2,
        title: "Extract sub-components",
        description:
          "Break large components into smaller, focused sub-components.",
        expectedOutput: "Extracted sub-components with clear interfaces",
      },
      {
        order: 3,
        title: "Extract custom hooks",
        description:
          "Move complex state logic and side effects into custom hooks.",
        expectedOutput: "Custom hooks for business logic",
      },
      {
        order: 4,
        title: "Improve prop types",
        description:
          "Add or improve TypeScript interfaces for component props.",
        expectedOutput: "Well-typed component props",
      },
      {
        order: 5,
        title: "Verify functionality",
        description:
          "Ensure the refactored component behaves identically to the original.",
        expectedOutput: "No functional regressions",
      },
    ],
    parameters: [
      {
        name: "component_path",
        type: "string" as const,
        description: "Path to the component file to refactor",
        required: true,
      },
    ],
  },
  {
    name: "Add Loading States",
    description:
      "Add loading, error, and empty states to UI components for better user experience.",
    category: "feature" as const,
    tags: ["ui", "loading", "error-states", "ux"],
    steps: [
      {
        order: 1,
        title: "Identify components needing states",
        description:
          "Find components that fetch data but lack loading, error, or empty states.",
        expectedOutput: "List of components needing state improvements",
      },
      {
        order: 2,
        title: "Add loading skeletons",
        description:
          "Create skeleton loader components that match the layout of the loaded content.",
        expectedOutput: "Skeleton loaders for each component",
      },
      {
        order: 3,
        title: "Add error states",
        description:
          "Implement error boundary or inline error displays with retry options.",
        expectedOutput: "Error states with retry functionality",
      },
      {
        order: 4,
        title: "Add empty states",
        description:
          "Create meaningful empty states with call-to-action for components with no data.",
        expectedOutput: "Empty state illustrations and CTAs",
      },
      {
        order: 5,
        title: "Verify all states render",
        description:
          "Test that loading, error, and empty states render correctly.",
        expectedOutput: "All states verified and working",
      },
    ],
    parameters: [
      {
        name: "target_path",
        type: "string" as const,
        description: "Directory containing components to update",
        required: true,
      },
    ],
  },
  {
    name: "Setup CI Pipeline",
    description:
      "Create a GitHub Actions CI/CD pipeline with linting, testing, and deployment stages.",
    category: "devops" as const,
    tags: ["ci-cd", "github-actions", "automation", "devops"],
    steps: [
      {
        order: 1,
        title: "Create workflow file",
        description:
          "Create .github/workflows/ci.yml with trigger configuration for push and PR events.",
        expectedOutput: "GitHub Actions workflow file",
      },
      {
        order: 2,
        title: "Add lint and format job",
        description: "Configure a job that runs linting and formatting checks.",
        expectedOutput: "Lint/format CI job",
      },
      {
        order: 3,
        title: "Add type check job",
        description: "Configure a job that runs TypeScript type checking.",
        expectedOutput: "Type check CI job",
      },
      {
        order: 4,
        title: "Add test job",
        description:
          "Configure a job that runs the test suite with coverage reporting.",
        expectedOutput: "Test CI job with coverage",
      },
      {
        order: 5,
        title: "Add build job",
        description:
          "Configure a job that verifies the project builds successfully.",
        expectedOutput: "Build verification CI job",
      },
      {
        order: 6,
        title: "Add caching",
        description: "Configure dependency caching for faster CI runs.",
        expectedOutput: "CI with dependency caching",
      },
    ],
    parameters: [
      {
        name: "node_version",
        type: "string" as const,
        description: "Node.js version to use in CI",
        required: false,
        default: "20",
      },
      {
        name: "package_manager",
        type: "select" as const,
        description: "Package manager used in the project",
        required: false,
        default: "pnpm",
        options: ["pnpm", "npm", "yarn", "bun"],
      },
    ],
  },
  {
    name: "Add Docker Support",
    description:
      "Create a Dockerfile and docker-compose.yml to containerize the application.",
    category: "devops" as const,
    tags: ["docker", "containerization", "devops", "deployment"],
    steps: [
      {
        order: 1,
        title: "Create Dockerfile",
        description:
          "Create a multi-stage Dockerfile with build and production stages.",
        expectedOutput: "Optimized Dockerfile",
      },
      {
        order: 2,
        title: "Create .dockerignore",
        description:
          "Create a .dockerignore file to exclude unnecessary files from the build context.",
        expectedOutput: ".dockerignore file",
      },
      {
        order: 3,
        title: "Create docker-compose.yml",
        description:
          "Create a docker-compose configuration for local development with all services.",
        expectedOutput: "docker-compose.yml with service definitions",
      },
      {
        order: 4,
        title: "Configure environment variables",
        description:
          "Set up environment variable handling for containerized environments.",
        expectedOutput: "Environment configuration for Docker",
      },
      {
        order: 5,
        title: "Test container build",
        description:
          "Build and run the container to verify it works correctly.",
        expectedOutput: "Working container with the application",
      },
    ],
    parameters: [
      {
        name: "base_image",
        type: "string" as const,
        description: "Base Docker image to use",
        required: false,
        default: "node:20-alpine",
      },
      {
        name: "expose_port",
        type: "number" as const,
        description: "Port to expose from the container",
        required: false,
        default: 3000,
      },
    ],
  },
  {
    name: "Performance Audit",
    description:
      "Run performance analysis including bundle size, lighthouse score, and optimize bottlenecks.",
    category: "code_quality" as const,
    tags: ["performance", "optimization", "lighthouse", "bundle-size"],
    steps: [
      {
        order: 1,
        title: "Analyze bundle size",
        description:
          "Run bundle analyzer to identify large dependencies and chunks.",
        expectedOutput: "Bundle size report with breakdown",
      },
      {
        order: 2,
        title: "Identify performance bottlenecks",
        description:
          "Look for common performance issues: unnecessary re-renders, large imports, blocking scripts.",
        expectedOutput: "List of performance issues",
      },
      {
        order: 3,
        title: "Optimize imports",
        description:
          "Replace barrel imports with direct imports, tree-shake unused code.",
        expectedOutput: "Optimized import statements",
      },
      {
        order: 4,
        title: "Add code splitting",
        description:
          "Implement dynamic imports and lazy loading for route-level code splitting.",
        expectedOutput: "Code splitting implemented",
      },
      {
        order: 5,
        title: "Optimize images and assets",
        description:
          "Use proper image components, compress assets, and implement lazy loading.",
        expectedOutput: "Optimized assets and images",
      },
      {
        order: 6,
        title: "Measure improvements",
        description:
          "Re-run performance analysis to quantify the improvements made.",
        expectedOutput: "Before/after performance comparison",
      },
    ],
    parameters: [
      {
        name: "target_url",
        type: "string" as const,
        description: "URL to run lighthouse analysis against",
        required: false,
        default: "http://localhost:3000",
      },
      {
        name: "focus_area",
        type: "select" as const,
        description: "Primary area to focus optimization on",
        required: false,
        default: "all",
        options: ["all", "bundle_size", "runtime", "network"],
      },
    ],
  },
] as const;
