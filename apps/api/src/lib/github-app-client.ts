/**
 * GitHub App Client (GAP-023)
 *
 * Provides GitHub App authentication and API operations:
 * - JWT creation from app private key
 * - Installation access token management
 * - Check run creation and updates for task tracking
 * - Status API for reporting progress on commits
 */

import { createSign } from "node:crypto";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("api:github-app-client");

const GITHUB_API = "https://api.github.com";
const GITHUB_APP_ID = process.env.GITHUB_APP_ID ?? "";
const GITHUB_APP_PRIVATE_KEY = process.env.GITHUB_APP_PRIVATE_KEY ?? "";

// Cache installation tokens (they last 1 hour, we refresh at 50 min)
const tokenCache = new Map<number, { token: string; expiresAt: number }>();
const TOKEN_TTL_MS = 50 * 60 * 1000;

// ---------------------------------------------------------------------------
// JWT creation
// ---------------------------------------------------------------------------

/**
 * Create a JWT for GitHub App authentication.
 * The JWT is signed with the app private key and used to obtain
 * installation access tokens.
 */
export function createAppJWT(): string {
  if (!(GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY)) {
    throw new Error(
      "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY must be configured"
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - 60,
    exp: now + 10 * 60,
    iss: GITHUB_APP_ID,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString(
    "base64url"
  );
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url"
  );

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(GITHUB_APP_PRIVATE_KEY, "base64url");

  return `${signingInput}.${signature}`;
}

// ---------------------------------------------------------------------------
// Installation access tokens
// ---------------------------------------------------------------------------

/**
 * Get an installation access token for a given installation ID.
 * Tokens are cached for 50 minutes (they expire after 1 hour).
 */
export async function getInstallationToken(
  installationId: number
): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  const jwt = createAppJWT();
  const response = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Failed to get installation token (${response.status}): ${body.slice(0, 200)}`
    );
  }

  const data = (await response.json()) as { token: string; expires_at: string };
  const expiresAt = Date.now() + TOKEN_TTL_MS;

  tokenCache.set(installationId, { token: data.token, expiresAt });

  logger.info(
    { installationId },
    "Obtained GitHub App installation access token"
  );

  return data.token;
}

// ---------------------------------------------------------------------------
// Check runs
// ---------------------------------------------------------------------------

export interface CheckRunParams {
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out";
  headSha: string;
  installationId: number;
  name: string;
  repoFullName: string;
  status: "queued" | "in_progress" | "completed";
  summary?: string;
  taskId?: string;
  title?: string;
}

/**
 * Create a GitHub check run to report task progress on a commit.
 */
export async function createCheckRun(
  params: CheckRunParams
): Promise<number | null> {
  try {
    const token = await getInstallationToken(params.installationId);

    const body: Record<string, unknown> = {
      name: params.name,
      head_sha: params.headSha,
      status: params.status,
      external_id: params.taskId,
    };

    if (params.status === "completed" && params.conclusion) {
      body.conclusion = params.conclusion;
    }

    if (params.title || params.summary) {
      body.output = {
        title: params.title ?? params.name,
        summary: params.summary ?? "",
      };
    }

    const response = await fetch(
      `${GITHUB_API}/repos/${params.repoFullName}/check-runs`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      logger.warn(
        {
          status: response.status,
          repoFullName: params.repoFullName,
          error: errBody.slice(0, 200),
        },
        "Failed to create check run"
      );
      return null;
    }

    const data = (await response.json()) as { id: number };

    logger.info(
      {
        checkRunId: data.id,
        repoFullName: params.repoFullName,
        headSha: params.headSha,
        status: params.status,
      },
      "Check run created"
    );

    return data.id;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to create check run");
    return null;
  }
}

/**
 * Update an existing GitHub check run.
 */
export async function updateCheckRun(params: {
  checkRunId: number;
  conclusion?: "success" | "failure" | "neutral" | "cancelled" | "timed_out";
  installationId: number;
  repoFullName: string;
  status: "queued" | "in_progress" | "completed";
  summary?: string;
  title?: string;
}): Promise<boolean> {
  try {
    const token = await getInstallationToken(params.installationId);

    const body: Record<string, unknown> = {
      status: params.status,
    };

    if (params.status === "completed" && params.conclusion) {
      body.conclusion = params.conclusion;
    }

    if (params.title || params.summary) {
      body.output = {
        title: params.title ?? "Prometheus AI",
        summary: params.summary ?? "",
      };
    }

    const response = await fetch(
      `${GITHUB_API}/repos/${params.repoFullName}/check-runs/${params.checkRunId}`,
      {
        method: "PATCH",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      logger.warn(
        {
          status: response.status,
          checkRunId: params.checkRunId,
          error: errBody.slice(0, 200),
        },
        "Failed to update check run"
      );
      return false;
    }

    logger.info(
      {
        checkRunId: params.checkRunId,
        status: params.status,
        conclusion: params.conclusion,
      },
      "Check run updated"
    );

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to update check run");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Commit status
// ---------------------------------------------------------------------------

/**
 * Create a commit status to report build/deploy progress.
 */
export async function createCommitStatus(params: {
  context: string;
  description: string;
  installationId: number;
  repoFullName: string;
  sha: string;
  state: "error" | "failure" | "pending" | "success";
  targetUrl?: string;
}): Promise<boolean> {
  try {
    const token = await getInstallationToken(params.installationId);

    const body: Record<string, unknown> = {
      state: params.state,
      description: params.description.slice(0, 140),
      context: params.context,
    };

    if (params.targetUrl) {
      body.target_url = params.targetUrl;
    }

    const response = await fetch(
      `${GITHUB_API}/repos/${params.repoFullName}/statuses/${params.sha}`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      logger.warn(
        { status: response.status, sha: params.sha },
        "Failed to create commit status"
      );
      return false;
    }

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Failed to create commit status");
    return false;
  }
}
