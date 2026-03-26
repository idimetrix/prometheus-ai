// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectType =
  | "nodejs"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "unknown";

export interface PipelineConfig {
  buildSteps: string[];
  caching?: CacheConfig;
  deployTargets: DeployTarget[];
  envSecrets?: string[];
  nodeVersion?: string;
  projectType?: ProjectType;
  secrets: string[];
  services?: ServiceConfig[];
  testCommands: string[];
}

export interface DeployTarget {
  environment: string;
  name: string;
  provider?: "vercel" | "netlify" | "docker";
  url: string;
}

export interface CacheConfig {
  key: string;
  paths: string[];
}

export interface ServiceConfig {
  image: string;
  name: string;
  ports?: string[];
}

/**
 * Project detection result from analyzing file contents.
 */
export interface ProjectDetectionResult {
  buildCommands: string[];
  caching: CacheConfig;
  installCommand: string;
  projectType: ProjectType;
  runtimeVersion: string;
  testCommands: string[];
}

// ---------------------------------------------------------------------------
// Project Type Detection
// ---------------------------------------------------------------------------

/**
 * Detect project type based on a list of filenames present in the repo root.
 * Pass the output of `fs.readdir()` or a listing from the GitHub API.
 */
export function detectProjectType(files: string[]): ProjectDetectionResult {
  const fileSet = new Set(files);

  if (
    fileSet.has("package.json") ||
    fileSet.has("pnpm-lock.yaml") ||
    fileSet.has("yarn.lock")
  ) {
    return detectNodeProject(fileSet);
  }

  if (
    fileSet.has("requirements.txt") ||
    fileSet.has("pyproject.toml") ||
    fileSet.has("setup.py") ||
    fileSet.has("Pipfile")
  ) {
    return detectPythonProject(fileSet);
  }

  if (fileSet.has("go.mod")) {
    return {
      projectType: "go",
      runtimeVersion: "1.22",
      installCommand: "go mod download",
      buildCommands: ["go build ./..."],
      testCommands: ["go test ./..."],
      caching: { key: "go-mod", paths: ["~/go/pkg/mod"] },
    };
  }

  if (fileSet.has("Cargo.toml")) {
    return {
      projectType: "rust",
      runtimeVersion: "stable",
      installCommand: "cargo fetch",
      buildCommands: ["cargo build --release"],
      testCommands: ["cargo test"],
      caching: {
        key: "cargo-target",
        paths: ["target/", "~/.cargo/registry/"],
      },
    };
  }

  if (
    fileSet.has("pom.xml") ||
    fileSet.has("build.gradle") ||
    fileSet.has("build.gradle.kts")
  ) {
    const usesGradle =
      fileSet.has("build.gradle") || fileSet.has("build.gradle.kts");
    return {
      projectType: "java",
      runtimeVersion: "21",
      installCommand: usesGradle
        ? "./gradlew dependencies"
        : "mvn dependency:resolve",
      buildCommands: [
        usesGradle ? "./gradlew build" : "mvn package -DskipTests",
      ],
      testCommands: [usesGradle ? "./gradlew test" : "mvn test"],
      caching: usesGradle
        ? { key: "gradle", paths: ["~/.gradle/caches", "~/.gradle/wrapper"] }
        : { key: "maven", paths: ["~/.m2/repository"] },
    };
  }

  return {
    projectType: "unknown",
    runtimeVersion: "",
    installCommand: "",
    buildCommands: ["echo 'No build step configured'"],
    testCommands: ["echo 'No test step configured'"],
    caching: { key: "generic", paths: [] },
  };
}

function detectNodeProject(fileSet: Set<string>): ProjectDetectionResult {
  const usesPnpm =
    fileSet.has("pnpm-lock.yaml") || fileSet.has("pnpm-workspace.yaml");
  const usesYarn = fileSet.has("yarn.lock");
  const usesBun = fileSet.has("bun.lockb") || fileSet.has("bun.lock");

  let installCommand: string;
  let cachePaths: string[];
  let cacheKey: string;

  if (usesPnpm) {
    installCommand = "pnpm install --frozen-lockfile";
    cachePaths = ["node_modules/", ".pnpm-store/"];
    cacheKey = "pnpm";
  } else if (usesYarn) {
    installCommand = "yarn install --frozen-lockfile";
    cachePaths = ["node_modules/", ".yarn/cache/"];
    cacheKey = "yarn";
  } else if (usesBun) {
    installCommand = "bun install --frozen-lockfile";
    cachePaths = ["node_modules/"];
    cacheKey = "bun";
  } else {
    installCommand = "npm ci";
    cachePaths = ["node_modules/", "~/.npm"];
    cacheKey = "npm";
  }

  const _isMonorepo =
    fileSet.has("pnpm-workspace.yaml") ||
    fileSet.has("lerna.json") ||
    fileSet.has("nx.json") ||
    fileSet.has("turbo.json");
  let pm = "npm";
  if (usesPnpm) {
    pm = "pnpm";
  } else if (usesYarn) {
    pm = "yarn";
  } else if (usesBun) {
    pm = "bun";
  }

  const buildCommands = [`${pm} run build`];

  const testCommands = [`${pm} run test`];

  // If there's a turbo.json, prefer turbo
  if (fileSet.has("turbo.json") && usesPnpm) {
    buildCommands[0] = "pnpm run build";
    testCommands[0] = "pnpm run test";
  }

  return {
    projectType: "nodejs",
    runtimeVersion: "22",
    installCommand,
    buildCommands,
    testCommands,
    caching: { key: cacheKey, paths: cachePaths },
  };
}

function detectPythonProject(fileSet: Set<string>): ProjectDetectionResult {
  const usesPoetry = fileSet.has("poetry.lock");
  const usesPipenv = fileSet.has("Pipfile");
  const usesUv = fileSet.has("uv.lock");

  let installCommand: string;
  if (usesPoetry) {
    installCommand = "pip install poetry && poetry install --no-interaction";
  } else if (usesPipenv) {
    installCommand = "pip install pipenv && pipenv install --deploy";
  } else if (usesUv) {
    installCommand = "pip install uv && uv sync";
  } else {
    installCommand = "pip install -r requirements.txt";
  }

  return {
    projectType: "python",
    runtimeVersion: "3.12",
    installCommand,
    buildCommands: ["echo 'Python project - no build step needed'"],
    testCommands: ["pytest"],
    caching: { key: "pip", paths: ["~/.cache/pip"] },
  };
}

// ---------------------------------------------------------------------------
// PipelineGenerator
// ---------------------------------------------------------------------------

/**
 * Generates CI/CD pipeline configuration files for GitHub Actions,
 * GitLab CI, and CircleCI from a unified config format.
 */
export class PipelineGenerator {
  /**
   * Auto-generate a PipelineConfig from a detected project type.
   */
  static fromDetection(
    detection: ProjectDetectionResult,
    deployTargets: DeployTarget[] = [],
    secrets: string[] = []
  ): PipelineConfig {
    return {
      projectType: detection.projectType,
      nodeVersion:
        detection.projectType === "nodejs"
          ? detection.runtimeVersion
          : undefined,
      buildSteps: [detection.installCommand, ...detection.buildCommands].filter(
        Boolean
      ),
      testCommands: detection.testCommands,
      deployTargets,
      secrets,
      caching: detection.caching,
    };
  }

  /**
   * Generate a GitHub Actions workflow YAML with caching, matrix builds, and deploy steps.
   */
  generateGitHubActions(config: PipelineConfig): string {
    const projectType = config.projectType ?? "nodejs";
    const nodeVersion = config.nodeVersion ?? "22";

    let setupSteps: string;
    let cacheSteps: string;

    switch (projectType) {
      case "nodejs": {
        setupSteps = `      - uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"
      - uses: pnpm/action-setup@v4
        if: hashFiles('pnpm-lock.yaml') != ''`;
        cacheSteps = config.caching
          ? `      - uses: actions/cache@v4
        with:
          path: |
${config.caching.paths.map((p) => `            ${p}`).join("\n")}
          key: \${{ runner.os }}-${config.caching.key}-\${{ hashFiles('**/pnpm-lock.yaml', '**/package-lock.json', '**/yarn.lock') }}
          restore-keys: |
            \${{ runner.os }}-${config.caching.key}-`
          : "";
        break;
      }
      case "python": {
        setupSteps = `      - uses: actions/setup-python@v5
        with:
          python-version: "${config.nodeVersion ?? "3.12"}"`;
        cacheSteps = `      - uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: \${{ runner.os }}-pip-\${{ hashFiles('**/requirements*.txt', '**/pyproject.toml', '**/Pipfile.lock') }}`;
        break;
      }
      case "go": {
        setupSteps = `      - uses: actions/setup-go@v5
        with:
          go-version: "1.22"`;
        cacheSteps = `      - uses: actions/cache@v4
        with:
          path: |
            ~/go/pkg/mod
            ~/.cache/go-build
          key: \${{ runner.os }}-go-\${{ hashFiles('**/go.sum') }}`;
        break;
      }
      case "rust": {
        setupSteps = "      - uses: dtolnay/rust-toolchain@stable";
        cacheSteps = `      - uses: actions/cache@v4
        with:
          path: |
            ~/.cargo/registry
            ~/.cargo/git
            target
          key: \${{ runner.os }}-cargo-\${{ hashFiles('**/Cargo.lock') }}`;
        break;
      }
      case "java": {
        setupSteps = `      - uses: actions/setup-java@v4
        with:
          java-version: "21"
          distribution: "temurin"`;
        cacheSteps = config.caching
          ? `      - uses: actions/cache@v4
        with:
          path: |
${config.caching.paths.map((p) => `            ${p}`).join("\n")}
          key: \${{ runner.os }}-${config.caching.key}-\${{ hashFiles('**/pom.xml', '**/build.gradle*') }}`
          : "";
        break;
      }
      default: {
        setupSteps = "";
        cacheSteps = "";
      }
    }

    const buildSteps = config.buildSteps
      .map((step) => `      - name: ${step}\n        run: ${step}`)
      .join("\n");

    const testSteps = config.testCommands
      .map((cmd) => `      - name: Test — ${cmd}\n        run: ${cmd}`)
      .join("\n");

    const deployJobs = config.deployTargets
      .map((target) => {
        const deployStep = generateDeployStep(target, config.secrets);
        return `
  deploy-${target.name}:
    needs: [build, test]
    runs-on: ubuntu-latest
    environment: ${target.environment}
    steps:
      - uses: actions/checkout@v4
${deployStep}`;
      })
      .join("\n");

    const servicesBlock = config.services?.length
      ? `    services:\n${config.services.map((s) => `      ${s.name}:\n        image: ${s.image}${s.ports?.length ? `\n        ports:\n${s.ports.map((p) => `          - ${p}`).join("\n")}` : ""}`).join("\n")}`
      : "";

    return `name: CI/CD Pipeline
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  CI: true

jobs:
  build:
    runs-on: ubuntu-latest
${servicesBlock}
    steps:
      - uses: actions/checkout@v4
${setupSteps}
${cacheSteps}
${buildSteps}

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${setupSteps}
${cacheSteps}
${testSteps}
${deployJobs}
`;
  }

  /**
   * Generate a GitLab CI configuration YAML with caching and deploy stages.
   */
  generateGitLabCI(config: PipelineConfig): string {
    const projectType = config.projectType ?? "nodejs";

    let image: string;
    switch (projectType) {
      case "nodejs":
        image = `node:${config.nodeVersion ?? "22"}-alpine`;
        break;
      case "python":
        image = "python:3.12-slim";
        break;
      case "go":
        image = "golang:1.22-alpine";
        break;
      case "rust":
        image = "rust:latest";
        break;
      case "java":
        image = "eclipse-temurin:21-jdk";
        break;
      default:
        image = "ubuntu:latest";
    }

    const cacheBlock = config.caching
      ? `
cache:
  key: ${config.caching.key}-\${CI_COMMIT_REF_SLUG}
  paths:
${config.caching.paths.map((p) => `    - ${p}`).join("\n")}`
      : "";

    const beforeScript = getGitLabBeforeScript(projectType);

    const buildScript = config.buildSteps
      .map((step) => `    - ${step}`)
      .join("\n");

    const testScript = config.testCommands
      .map((cmd) => `    - ${cmd}`)
      .join("\n");

    const deployStages = config.deployTargets
      .map((target) => {
        const deployScript = getGitLabDeployScript(target);
        return `
deploy-${target.name}:
  stage: deploy
  environment:
    name: ${target.environment}
    url: ${target.url}
  script:
${deployScript}
  rules:
    - if: $CI_COMMIT_BRANCH == "main"`;
      })
      .join("\n");

    return `image: ${image}

stages:
  - build
  - test
  - deploy
${cacheBlock}

before_script:
${beforeScript}

build:
  stage: build
  script:
${buildScript}
  artifacts:
    paths:
      - dist/
      - build/
    expire_in: 1 hour

test:
  stage: test
  script:
${testScript}
${deployStages}
`;
  }

  /**
   * Generate a CircleCI configuration YAML.
   */
  generateCircleCI(config: PipelineConfig): string {
    const projectType = config.projectType ?? "nodejs";
    const nodeVersion = config.nodeVersion ?? "22";

    let dockerImage: string;
    switch (projectType) {
      case "nodejs":
        dockerImage = `cimg/node:${nodeVersion}`;
        break;
      case "python":
        dockerImage = "cimg/python:3.12";
        break;
      case "go":
        dockerImage = "cimg/go:1.22";
        break;
      case "rust":
        dockerImage = "cimg/rust:1.77";
        break;
      case "java":
        dockerImage = "cimg/openjdk:21.0";
        break;
      default:
        dockerImage = "cimg/base:current";
    }

    const buildSteps = config.buildSteps
      .map((step) => `          - run: ${step}`)
      .join("\n");

    const testSteps = config.testCommands
      .map((cmd) => `          - run: ${cmd}`)
      .join("\n");

    const cacheSteps = config.caching
      ? `          - save_cache:
              key: ${config.caching.key}-{{ checksum "package.json" }}
              paths:
${config.caching.paths.map((p) => `                - ${p}`).join("\n")}
          - restore_cache:
              keys:
                - ${config.caching.key}-{{ checksum "package.json" }}
                - ${config.caching.key}-`
      : "";

    const deployJobs = config.deployTargets
      .map(
        (target) => `
    deploy-${target.name}:
      docker:
        - image: ${dockerImage}
      steps:
        - checkout
        - run: echo "Deploying to ${target.url}"`
      )
      .join("\n");

    const workflowDeploy = config.deployTargets
      .map(
        (target) => `        - deploy-${target.name}:
            requires:
              - test
            filters:
              branches:
                only: main`
      )
      .join("\n");

    return `version: 2.1

jobs:
  build:
    docker:
      - image: ${dockerImage}
    steps:
      - checkout
${cacheSteps}
${buildSteps}

  test:
    docker:
      - image: ${dockerImage}
    steps:
      - checkout
${testSteps}
${deployJobs}

workflows:
  build-test-deploy:
    jobs:
      - build
      - test:
          requires:
            - build
${workflowDeploy}
`;
  }
}

// ---------------------------------------------------------------------------
// Helpers for deploy step generation
// ---------------------------------------------------------------------------

function generateDeployStep(target: DeployTarget, secrets: string[]): string {
  const secretEnvs = secrets.length
    ? `        env:\n${secrets.map((s) => `          ${s}: \${{ secrets.${s} }}`).join("\n")}`
    : "";

  switch (target.provider) {
    case "vercel":
      return `      - name: Deploy to Vercel (${target.name})
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: \${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: \${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: \${{ secrets.VERCEL_PROJECT_ID }}
          vercel-args: ${target.environment === "production" ? "--prod" : ""}
${secretEnvs}`;

    case "netlify":
      return `      - name: Deploy to Netlify (${target.name})
        uses: nwtgck/actions-netlify@v3
        with:
          publish-dir: "./dist"
          production-deploy: ${target.environment === "production" ? "true" : "false"}
          github-token: \${{ secrets.GITHUB_TOKEN }}
          deploy-message: "Deploy from GitHub Actions"
        env:
          NETLIFY_AUTH_TOKEN: \${{ secrets.NETLIFY_AUTH_TOKEN }}
          NETLIFY_SITE_ID: \${{ secrets.NETLIFY_SITE_ID }}
${secretEnvs}`;

    case "docker":
      return `      - name: Build and push Docker image (${target.name})
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: \${{ secrets.DOCKER_REGISTRY }}/${target.name}:\${{ github.sha }}
${secretEnvs}`;

    default:
      return `      - name: Deploy to ${target.name}
        run: echo "Deploying to ${target.url}"
${secretEnvs}`;
  }
}

function getGitLabBeforeScript(projectType: ProjectType): string {
  switch (projectType) {
    case "nodejs":
      return "  - corepack enable\n  - pnpm install --frozen-lockfile";
    case "python":
      return "  - pip install -r requirements.txt";
    case "go":
      return "  - go mod download";
    case "rust":
      return "  - cargo fetch";
    case "java":
      return "  - echo 'Java project'";
    default:
      return "  - echo 'Setup'";
  }
}

function getGitLabDeployScript(target: DeployTarget): string {
  switch (target.provider) {
    case "vercel":
      return `    - npm install -g vercel
    - vercel deploy ${target.environment === "production" ? "--prod" : ""} --token=$VERCEL_TOKEN --yes`;
    case "netlify":
      return `    - npm install -g netlify-cli
    - netlify deploy ${target.environment === "production" ? "--prod" : ""} --auth=$NETLIFY_AUTH_TOKEN --site=$NETLIFY_SITE_ID --dir=dist`;
    case "docker":
      return `    - docker build -t $DOCKER_REGISTRY/${target.name}:$CI_COMMIT_SHORT_SHA .
    - docker push $DOCKER_REGISTRY/${target.name}:$CI_COMMIT_SHORT_SHA`;
    default:
      return `    - echo "Deploying to ${target.name}"`;
  }
}
