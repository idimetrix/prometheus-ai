const DEFAULT_API_URL = "http://localhost:4000";

export class APIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.baseUrl = process.env.PROMETHEUS_API_URL ?? DEFAULT_API_URL;
    this.apiKey = process.env.PROMETHEUS_API_KEY ?? "";
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  async submitTask(params: {
    title: string;
    description?: string;
    projectId: string;
    mode?: string;
  }): Promise<{ taskId: string; sessionId: string }> {
    const response = await fetch(`${this.baseUrl}/api/trpc/tasks.submit`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        json: {
          title: params.title,
          description: params.description,
          projectId: params.projectId,
          mode: params.mode ?? "task",
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      result: { data: { json: { taskId: string; sessionId: string } } };
    };
    return data.result.data.json;
  }

  streamSession(
    sessionId: string,
    onEvent: (event: { type: string; data: unknown }) => void
  ): { close: () => void } {
    const url = `${this.baseUrl}/api/sse/${sessionId}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        onEvent(parsed);
      } catch {
        // Ignore malformed events
      }
    };

    eventSource.onerror = () => {
      // Reconnection is handled by EventSource
    };

    return {
      close: () => eventSource.close(),
    };
  }

  async getStatus(): Promise<{
    activeAgents: number;
    queueDepth: number;
    services: Record<string, boolean>;
  }> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return (await response.json()) as {
      activeAgents: number;
      queueDepth: number;
      services: Record<string, boolean>;
    };
  }
}
