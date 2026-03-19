/**
 * GitHub Actions Integration
 *
 * Generates reusable GitHub Actions workflow configs
 * that trigger Prometheus agent tasks on PR events.
 */

export interface GitHubActionsConfig {
  apiKey: string;
  apiUrl: string;
  projectId: string;
  triggerOn: ("pull_request" | "push" | "issue_comment")[];
}

export function createGitHubActionsConfig(config: GitHubActionsConfig): string {
  const triggers = config.triggerOn
    .map((t) => {
      if (t === "pull_request") {
        return "  pull_request:\n    types: [opened, synchronize]";
      }
      if (t === "push") {
        return "  push:\n    branches: [main]";
      }
      if (t === "issue_comment") {
        return "  issue_comment:\n    types: [created]";
      }
      return "";
    })
    .join("\n");

  return `name: Prometheus AI Agent
on:
${triggers}

jobs:
  prometheus-review:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Submit PR for Prometheus review
        env:
          PROMETHEUS_API_KEY: \${{ secrets.PROMETHEUS_API_KEY }}
          PROMETHEUS_API_URL: ${config.apiUrl}
        run: |
          curl -X POST "\${PROMETHEUS_API_URL}/api/trpc/tasks.submit" \\
            -H "Authorization: Bearer \${PROMETHEUS_API_KEY}" \\
            -H "Content-Type: application/json" \\
            -d '{
              "json": {
                "projectId": "${config.projectId}",
                "title": "Review PR #\${{ github.event.pull_request.number }}",
                "description": "Review this pull request for code quality, security, and convention compliance.\\n\\nPR: \${{ github.event.pull_request.html_url }}\\nBranch: \${{ github.event.pull_request.head.ref }}\\nDescription: \${{ github.event.pull_request.body }}",
                "mode": "task"
              }
            }'
`;
}
