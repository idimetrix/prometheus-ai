/**
 * CI/CD Pipeline Generation Prompts — GAP-057
 *
 * Templates for generating GitHub Actions, GitLab CI, and other
 * CI/CD pipeline configurations based on project tech stack.
 */

export interface CIPipelineConfig {
  /** Additional steps to include */
  additionalSteps?: string[];
  /** Deploy target (vercel, netlify, docker, none) */
  deployTarget?: string;
  /** Primary language of the project */
  language: string;
  /** Node/Python/Go version to use */
  languageVersion?: string;
  /** Package manager (npm, pnpm, yarn, pip, cargo, go) */
  packageManager: string;
  /** CI provider to generate for */
  provider: "github-actions" | "gitlab-ci" | "circle-ci";
}

/**
 * Generate a GitHub Actions CI workflow for a project.
 */
export function generateGitHubActionsWorkflow(
  config: CIPipelineConfig
): string {
  const { language, packageManager, languageVersion, deployTarget } = config;

  if (language === "typescript" || language === "javascript") {
    return generateNodeWorkflow(packageManager, languageVersion, deployTarget);
  }
  if (language === "python") {
    return generatePythonWorkflow(languageVersion, deployTarget);
  }
  if (language === "go") {
    return generateGoWorkflow(languageVersion);
  }
  if (language === "rust") {
    return generateRustWorkflow();
  }

  return generateGenericWorkflow(language, packageManager);
}

function runPrefix(pm: string): string {
  if (pm === "pnpm") {
    return "pnpm";
  }
  if (pm === "yarn") {
    return "yarn";
  }
  return "npm run";
}

function testPrefix(pm: string): string {
  if (pm === "pnpm") {
    return "pnpm";
  }
  if (pm === "yarn") {
    return "yarn";
  }
  return "npm";
}

function generateNodeWorkflow(
  pm: string,
  version?: string,
  deploy?: string
): string {
  const nodeVersion = version ?? "20";
  let installCmd = "npm ci";
  if (pm === "pnpm") {
    installCmd = "pnpm install --frozen-lockfile";
  } else if (pm === "yarn") {
    installCmd = "yarn install --frozen-lockfile";
  }

  let deployStep = "";
  if (deploy === "vercel") {
    deployStep = `
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: amondnet/vercel-action@v25
        with:
          vercel-token: \${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: --prod`;
  }

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '${nodeVersion}'${pm === "pnpm" ? "\n      - uses: pnpm/action-setup@v4" : ""}
      - run: ${installCmd}
      - run: ${runPrefix(pm)} typecheck
      - run: ${runPrefix(pm)} lint
      - run: ${testPrefix(pm)} test
      - run: ${runPrefix(pm)} build
${deployStep}`;
}

function generatePythonWorkflow(version?: string, _deploy?: string): string {
  const pyVersion = version ?? "3.12";
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '${pyVersion}'
      - run: pip install -r requirements.txt
      - run: pip install ruff pytest
      - run: ruff check .
      - run: pytest --tb=short -q`;
}

function generateGoWorkflow(version?: string): string {
  const goVersion = version ?? "1.22";
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: '${goVersion}'
      - run: go vet ./...
      - run: go test -race ./...
      - run: go build ./...`;
}

function generateRustWorkflow(): string {
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo fmt --check
      - run: cargo clippy -- -D warnings
      - run: cargo test
      - run: cargo build --release`;
}

function generateGenericWorkflow(language: string, pm: string): string {
  return `name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # Configure ${language} environment
      # - run: ${pm} install
      # - run: ${pm} test
      # - run: ${pm} build`;
}

/**
 * Prompt for the agent to generate a CI pipeline.
 */
export const CI_GENERATION_PROMPT = `Generate a CI/CD pipeline configuration for this project. The pipeline should include:

1. **Lint** - Code style and formatting checks
2. **Type Check** - Static type analysis (if applicable)
3. **Test** - Unit and integration tests
4. **Build** - Verify the project compiles/builds
5. **Deploy** - Deploy to the configured target (if applicable)

Use caching where possible to speed up CI runs. Pin action versions for security.
Generate the complete YAML file content.`;
