/**
 * GitLab CI Integration
 *
 * Generates GitLab CI config snippets for Prometheus agent integration.
 */

export interface GitLabCIConfig {
  apiKey: string;
  apiUrl: string;
  projectId: string;
}

export function createGitLabCIConfig(config: GitLabCIConfig): string {
  return `prometheus-review:
  stage: review
  image: curlimages/curl:latest
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - |
      curl -X POST "${config.apiUrl}/api/trpc/tasks.submit" \\
        -H "Authorization: Bearer ${config.apiKey}" \\
        -H "Content-Type: application/json" \\
        -d '{
          "json": {
            "projectId": "${config.projectId}",
            "title": "Review MR !'$CI_MERGE_REQUEST_IID'",
            "description": "Review this merge request for code quality and security.",
            "mode": "task"
          }
        }'
`;
}
