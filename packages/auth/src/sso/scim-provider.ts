import { createLogger } from "@prometheus/logger";

const logger = createLogger("auth:scim-provider");

// ---------------------------------------------------------------------------
// SCIM 2.0 Types (RFC 7643 / RFC 7644)
// ---------------------------------------------------------------------------

export interface SCIMConfig {
  /** Base URL of the SCIM endpoint (e.g. https://api.example.com/scim/v2) */
  baseUrl: string;
  /** Bearer token for authenticating SCIM requests */
  bearerToken: string;
}

export interface SCIMName {
  familyName: string;
  formatted?: string;
  givenName: string;
}

export interface SCIMEmail {
  primary?: boolean;
  type?: string;
  value: string;
}

export interface SCIMUser {
  /** Whether the user account is active */
  active: boolean;
  /** Display name */
  displayName: string;
  /** Email addresses */
  emails: SCIMEmail[];
  /** External ID from the identity provider */
  externalId?: string;
  /** Group memberships */
  groups?: { value: string; display: string }[];
  /** SCIM resource ID */
  id: string;
  /** SCIM metadata */
  meta?: {
    resourceType: string;
    created: string;
    lastModified: string;
  };
  /** Structured name */
  name: SCIMName;
  /** Unique username (often email) */
  userName: string;
}

export interface SCIMGroup {
  /** Group display name */
  displayName: string;
  /** External ID from the identity provider */
  externalId?: string;
  /** SCIM resource ID */
  id: string;
  /** Group members */
  members: { value: string; display: string }[];
  /** SCIM metadata */
  meta?: {
    resourceType: string;
    created: string;
    lastModified: string;
  };
}

export interface SCIMListResponse<T> {
  itemsPerPage: number;
  Resources: T[];
  schemas: string[];
  startIndex: number;
  totalResults: number;
}

export interface CreateSCIMUserParams {
  active?: boolean;
  displayName: string;
  emails: SCIMEmail[];
  externalId?: string;
  name: SCIMName;
  userName: string;
}

export interface UpdateSCIMUserParams {
  active?: boolean;
  displayName?: string;
  emails?: SCIMEmail[];
  name?: Partial<SCIMName>;
}

// ---------------------------------------------------------------------------
// SCIM 2.0 Provider
// ---------------------------------------------------------------------------

/**
 * SCIM 2.0 provisioning provider stub.
 *
 * Implements the SCIM 2.0 protocol (RFC 7643 / RFC 7644) for automated
 * user and group provisioning from identity providers like Okta, Azure AD,
 * and OneLogin.
 *
 * This implementation provides the correct interface and makes real HTTP
 * calls to a SCIM endpoint. In production, add proper error handling,
 * pagination support, and schema validation.
 */
export class SCIMProvider {
  private readonly config: SCIMConfig;

  constructor(config: SCIMConfig) {
    this.config = config;

    logger.info({ baseUrl: config.baseUrl }, "SCIM 2.0 provider initialized");
  }

  // -------------------------------------------------------------------------
  // User operations
  // -------------------------------------------------------------------------

  /**
   * List users with optional filtering and pagination.
   *
   * @param startIndex - 1-based index of the first result (default: 1)
   * @param count - Maximum number of results per page (default: 100)
   * @param filter - SCIM filter expression (e.g. `userName eq "user@example.com"`)
   */
  listUsers(
    startIndex = 1,
    count = 100,
    filter?: string
  ): Promise<SCIMListResponse<SCIMUser>> {
    const params = new URLSearchParams({
      startIndex: String(startIndex),
      count: String(count),
    });
    if (filter) {
      params.set("filter", filter);
    }

    logger.debug({ startIndex, count, filter }, "Listing SCIM users");

    return this.request<SCIMListResponse<SCIMUser>>(
      `/Users?${params.toString()}`,
      "GET"
    );
  }

  /**
   * Get a single user by their SCIM resource ID.
   */
  getUser(userId: string): Promise<SCIMUser> {
    logger.debug({ userId }, "Getting SCIM user");
    return this.request<SCIMUser>(`/Users/${userId}`, "GET");
  }

  /**
   * Create a new user via SCIM provisioning.
   */
  createUser(params: CreateSCIMUserParams): Promise<SCIMUser> {
    const body = {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
      userName: params.userName,
      displayName: params.displayName,
      name: params.name,
      emails: params.emails,
      active: params.active ?? true,
      externalId: params.externalId,
    };

    logger.info({ userName: params.userName }, "Creating SCIM user");
    return this.request<SCIMUser>("/Users", "POST", body);
  }

  /**
   * Update an existing user via SCIM PATCH.
   */
  updateUser(userId: string, params: UpdateSCIMUserParams): Promise<SCIMUser> {
    const operations: { op: string; path: string; value: unknown }[] = [];

    if (params.displayName !== undefined) {
      operations.push({
        op: "replace",
        path: "displayName",
        value: params.displayName,
      });
    }
    if (params.name !== undefined) {
      operations.push({ op: "replace", path: "name", value: params.name });
    }
    if (params.emails !== undefined) {
      operations.push({
        op: "replace",
        path: "emails",
        value: params.emails,
      });
    }
    if (params.active !== undefined) {
      operations.push({
        op: "replace",
        path: "active",
        value: params.active,
      });
    }

    const body = {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
      Operations: operations,
    };

    logger.info({ userId }, "Updating SCIM user");
    return this.request<SCIMUser>(`/Users/${userId}`, "PATCH", body);
  }

  /**
   * Delete (deprovision) a user.
   */
  async deleteUser(userId: string): Promise<void> {
    logger.info({ userId }, "Deleting SCIM user");
    await this.request<void>(`/Users/${userId}`, "DELETE");
  }

  // -------------------------------------------------------------------------
  // Group operations
  // -------------------------------------------------------------------------

  /**
   * List groups with optional filtering and pagination.
   */
  listGroups(
    startIndex = 1,
    count = 100,
    filter?: string
  ): Promise<SCIMListResponse<SCIMGroup>> {
    const params = new URLSearchParams({
      startIndex: String(startIndex),
      count: String(count),
    });
    if (filter) {
      params.set("filter", filter);
    }

    logger.debug({ startIndex, count, filter }, "Listing SCIM groups");

    return this.request<SCIMListResponse<SCIMGroup>>(
      `/Groups?${params.toString()}`,
      "GET"
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async request<T>(
    path: string,
    method: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.bearerToken}`,
      "Content-Type": "application/scim+json",
      Accept: "application/scim+json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { method, path, status: response.status, error: errorText },
        "SCIM request failed"
      );
      throw new SCIMError(
        `SCIM ${method} ${path} failed: ${response.status} - ${errorText}`
      );
    }

    // DELETE returns 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}

// ---------------------------------------------------------------------------
// Custom error
// ---------------------------------------------------------------------------

export class SCIMError extends Error {
  override readonly name = "SCIMError";
}
