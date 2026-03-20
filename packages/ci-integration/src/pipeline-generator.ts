// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  buildSteps: string[];
  deployTargets: DeployTarget[];
  nodeVersion?: string;
  secrets: string[];
  testCommands: string[];
}

export interface DeployTarget {
  environment: string;
  name: string;
  url: string;
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
   * Generate a GitHub Actions workflow YAML.
   */
  generateGitHubActions(config: PipelineConfig): string {
    const nodeVersion = config.nodeVersion ?? "22";

    const buildSteps = config.buildSteps
      .map((step) => `      - name: ${step}\n        run: ${step}`)
      .join("\n");

    const testSteps = config.testCommands
      .map((cmd) => `      - name: Test — ${cmd}\n        run: ${cmd}`)
      .join("\n");

    const deployJobs = config.deployTargets
      .map(
        (target) => `
  deploy-${target.name}:
    needs: [build, test]
    runs-on: ubuntu-latest
    environment: ${target.environment}
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to ${target.name}
        run: echo "Deploying to ${target.url}"
        env:
${config.secrets.map((s) => `          ${s}: \${{ secrets.${s} }}`).join("\n")}`
      )
      .join("\n");

    return `name: CI/CD Pipeline
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
          node-version: "${nodeVersion}"
      - uses: pnpm/action-setup@v4
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
${buildSteps}

  test:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "${nodeVersion}"
      - uses: pnpm/action-setup@v4
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
${testSteps}
${deployJobs}
`;
  }

  /**
   * Generate a GitLab CI configuration YAML.
   */
  generateGitLabCI(config: PipelineConfig): string {
    const nodeImage = `node:${config.nodeVersion ?? "22"}-alpine`;

    const buildScript = config.buildSteps
      .map((step) => `    - ${step}`)
      .join("\n");

    const testScript = config.testCommands
      .map((cmd) => `    - ${cmd}`)
      .join("\n");

    const deployStages = config.deployTargets
      .map(
        (target) => `
deploy-${target.name}:
  stage: deploy
  environment:
    name: ${target.environment}
    url: ${target.url}
  script:
    - echo "Deploying to ${target.name}"
  only:
    - main`
      )
      .join("\n");

    return `image: ${nodeImage}

stages:
  - build
  - test
  - deploy

before_script:
  - corepack enable
  - pnpm install --frozen-lockfile

build:
  stage: build
  script:
${buildScript}

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
    const nodeVersion = config.nodeVersion ?? "22";

    const buildSteps = config.buildSteps
      .map((step) => `          - run: ${step}`)
      .join("\n");

    const testSteps = config.testCommands
      .map((cmd) => `          - run: ${cmd}`)
      .join("\n");

    const deployJobs = config.deployTargets
      .map(
        (target) => `
    deploy-${target.name}:
      docker:
        - image: cimg/node:${nodeVersion}
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
      - image: cimg/node:${nodeVersion}
    steps:
      - checkout
      - run: corepack enable && pnpm install --frozen-lockfile
${buildSteps}

  test:
    docker:
      - image: cimg/node:${nodeVersion}
    steps:
      - checkout
      - run: corepack enable && pnpm install --frozen-lockfile
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
