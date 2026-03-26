/**
 * Simple fetch-based client for the Prometheus REST API v1.
 */

export interface CreateTaskResponse {
  sessionId: string;
  status: string;
  taskId: string;
}

export interface TaskStatusResponse {
  completedAt: string | null;
  prUrl: string | null;
  result: Record<string, unknown> | null;
  sessionId: string;
  status: string;
  taskId: string;
}

const TRAILING_SLASH_RE = /\/$/;

export class PrometheusApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(TRAILING_SLASH_RE, "");
    this.apiKey = apiKey;
  }

  /**
   * Create a new agent task via the CI trigger endpoint.
   */
  async createTask(params: {
    description: string;
    mode: string;
    projectId: string;
  }): Promise<CreateTaskResponse> {
    const response = await fetch(
      `${this.baseUrl}/webhooks/ci/${params.projectId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Webhook-Secret": this.apiKey,
        },
        body: JSON.stringify({
          event: "manual",
          description: params.description,
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to create task (HTTP ${response.status}): ${errorBody}`
      );
    }

    return (await response.json()) as CreateTaskResponse;
  }

  /**
   * Get the current status of a task.
   */
  async getTask(taskId: string): Promise<TaskStatusResponse> {
    const response = await fetch(`${this.baseUrl}/trpc/tasks.get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ json: { taskId } }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `Failed to get task (HTTP ${response.status}): ${errorBody}`
      );
    }

    const data = (await response.json()) as {
      result: { data: { json: TaskStatusResponse } };
    };
    return data.result.data.json;
  }

  /**
   * Poll a task until it reaches a terminal state or timeout.
   */
  async pollUntilComplete(
    taskId: string,
    timeoutMs: number
  ): Promise<TaskStatusResponse> {
    const startTime = Date.now();
    const pollIntervalMs = 5000;
    const terminalStatuses = new Set([
      "completed",
      "failed",
      "cancelled",
      "error",
    ]);

    while (Date.now() - startTime < timeoutMs) {
      const task = await this.getTask(taskId);

      if (terminalStatuses.has(task.status)) {
        return task;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(
      `Task ${taskId} did not complete within ${timeoutMs / 1000}s timeout`
    );
  }
}
