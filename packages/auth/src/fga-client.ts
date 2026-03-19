export interface AuthorizationTuple {
  object: string;
  relation: string;
  user: string;
}

export interface CheckResult {
  allowed: boolean;
  resolution?: string;
}

export interface ListObjectsResult {
  objects: string[];
}

interface WriteTuplesRequest {
  deletes?: AuthorizationTuple[];
  writes?: AuthorizationTuple[];
}

interface FgaClientConfig {
  apiUrl: string;
  modelId?: string;
  storeId: string;
}

export class FgaClient {
  private readonly apiUrl: string;
  private readonly storeId: string;
  private readonly modelId: string | undefined;

  constructor(config?: Partial<FgaClientConfig>) {
    this.apiUrl =
      config?.apiUrl ?? process.env.OPENFGA_API_URL ?? "http://localhost:8080";
    this.storeId = config?.storeId ?? process.env.OPENFGA_STORE_ID ?? "";
    this.modelId = config?.modelId ?? process.env.OPENFGA_MODEL_ID ?? undefined;
  }

  private get baseUrl(): string {
    return `${this.apiUrl}/stores/${this.storeId}`;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `OpenFGA request failed: ${response.status} ${response.statusText} - ${text}`
      );
    }

    return (await response.json()) as T;
  }

  async check(
    user: string,
    relation: string,
    object: string
  ): Promise<CheckResult> {
    const body: Record<string, unknown> = {
      tuple_key: { user, relation, object },
    };
    if (this.modelId) {
      body.authorization_model_id = this.modelId;
    }

    const result = await this.request<{
      allowed: boolean;
      resolution?: string;
    }>("/check", body);

    return {
      allowed: result.allowed,
      resolution: result.resolution,
    };
  }

  async write(tuples: AuthorizationTuple[]): Promise<void> {
    const body: WriteTuplesRequest & { authorization_model_id?: string } = {
      writes: tuples,
    };
    if (this.modelId) {
      body.authorization_model_id = this.modelId;
    }

    await this.request<Record<string, unknown>>("/write", body);
  }

  async listObjects(
    user: string,
    relation: string,
    type: string
  ): Promise<ListObjectsResult> {
    const body: Record<string, unknown> = {
      user,
      relation,
      type,
    };
    if (this.modelId) {
      body.authorization_model_id = this.modelId;
    }

    const result = await this.request<{ objects: string[] }>(
      "/list-objects",
      body
    );

    return { objects: result.objects };
  }
}
