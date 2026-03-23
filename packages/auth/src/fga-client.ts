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

  async deleteTuples(tuples: AuthorizationTuple[]): Promise<void> {
    const body: WriteTuplesRequest & { authorization_model_id?: string } = {
      deletes: tuples,
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

// ---------------------------------------------------------------------------
// Project-level RBAC helpers
// ---------------------------------------------------------------------------

/** Role-to-relation mapping for project permissions */
const PROJECT_ROLE_RELATIONS: Record<string, string[]> = {
  viewer: ["reader"],
  editor: ["reader", "writer"],
  admin: ["reader", "writer", "admin"],
};

/** Permission-to-relation mapping for permission checks */
const PROJECT_PERMISSION_RELATION: Record<string, string> = {
  read: "reader",
  write: "writer",
  admin: "admin",
};

// Singleton FGA client for the helper functions
let _defaultClient: FgaClient | undefined;

function getDefaultClient(): FgaClient {
  if (!_defaultClient) {
    _defaultClient = new FgaClient();
  }
  return _defaultClient;
}

/**
 * Check whether a user has a specific permission on a project.
 *
 * Maps permission names to FGA relations:
 * - `read`  → `reader`
 * - `write` → `writer`
 * - `admin` → `admin`
 */
export async function checkProjectPermission(
  userId: string,
  projectId: string,
  permission: "read" | "write" | "admin"
): Promise<boolean> {
  const client = getDefaultClient();
  const relation = PROJECT_PERMISSION_RELATION[permission] ?? permission;

  const result = await client.check(
    `user:${userId}`,
    relation,
    `project:${projectId}`
  );

  return result.allowed;
}

/**
 * Grant a project-level role to a user.
 *
 * Roles are hierarchical:
 * - `viewer` grants `read`
 * - `editor` grants `read` + `write`
 * - `admin`  grants `read` + `write` + `admin`
 *
 * This writes all the necessary FGA tuples for the role.
 */
export async function grantProjectPermission(
  userId: string,
  projectId: string,
  role: "viewer" | "editor" | "admin"
): Promise<void> {
  const client = getDefaultClient();
  const relations = PROJECT_ROLE_RELATIONS[role] ?? ["read"];

  const tuples: AuthorizationTuple[] = relations.map((relation) => ({
    user: `user:${userId}`,
    relation,
    object: `project:${projectId}`,
  }));

  await client.write(tuples);
}

/**
 * Revoke all project-level permissions for a user.
 *
 * Removes all relation tuples (reader, writer, admin) between the user
 * and the project.
 */
export async function revokeProjectPermission(
  userId: string,
  projectId: string
): Promise<void> {
  const client = getDefaultClient();

  const allRelations = ["reader", "writer", "admin"];
  const tuples: AuthorizationTuple[] = allRelations.map((relation) => ({
    user: `user:${userId}`,
    relation,
    object: `project:${projectId}`,
  }));

  await client.deleteTuples(tuples);
}
