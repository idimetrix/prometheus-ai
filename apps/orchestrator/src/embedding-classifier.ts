import { createLogger } from "@prometheus/logger";
import { modelRouterClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:embedding-classifier");

/**
 * Role descriptions used to generate reference embeddings for
 * cosine-similarity-based task classification.
 */
const ROLE_DESCRIPTIONS: Record<string, string> = {
  discovery:
    "Requirements gathering, user story elicitation, acceptance criteria definition, scope analysis, stakeholder interviews, SRS document creation",
  architect:
    "System architecture design, blueprint creation, data model schema, tech stack selection, ADR writing, API contract definition, system design",
  planner:
    "Sprint planning, roadmap creation, milestone scheduling, backlog grooming, epic breakdown, task estimation, timeline management",
  frontend_coder:
    "React component development, UI/UX implementation, page layout, form building, CSS styling, Tailwind, Next.js pages, dashboard creation, modal and sidebar components",
  backend_coder:
    "API endpoint development, tRPC router creation, database query writing, migration scripts, service layer implementation, middleware, CRUD operations, webhook handling",
  test_engineer:
    "Test writing, unit tests, integration tests, E2E tests with Playwright, test coverage analysis, Vitest specs, assertion design, test fixture creation",
  security_auditor:
    "Security audit, OWASP vulnerability scanning, XSS prevention, CSRF protection, SQL injection detection, authentication review, penetration testing, CVE analysis",
  deploy_engineer:
    "Deployment configuration, Docker containerization, Kubernetes manifests, CI/CD pipeline setup, GitHub Actions, Helm charts, SSL/TLS configuration, Traefik/Nginx setup",
  integration_coder:
    "System integration, API connection wiring, data binding, real-time communication, service-to-service calls, webhook integration, event-driven architecture",
};

interface EmbeddingApiResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
}

/**
 * Cache for role description embeddings. Lazily populated on first use
 * by calling the model-router embedding endpoint.
 */
class RoleEmbeddingCache {
  private readonly cache = new Map<string, number[]>();
  private initialized = false;
  private initializing: Promise<void> | null = null;

  async ensureInitialized(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    if (this.initializing) {
      await this.initializing;
      return this.initialized;
    }

    this.initializing = this.loadRoleEmbeddings();
    await this.initializing;
    this.initializing = null;
    return this.initialized;
  }

  private async loadRoleEmbeddings(): Promise<void> {
    logger.info("Loading role embeddings from model-router");

    for (const [role, description] of Object.entries(ROLE_DESCRIPTIONS)) {
      try {
        const response = await modelRouterClient.post<EmbeddingApiResponse>(
          "/v1/embeddings",
          { input: description }
        );

        const embedding = response.data.data[0]?.embedding;
        if (embedding && embedding.length > 0) {
          this.cache.set(role, embedding);
          logger.debug(
            { role, dimensions: embedding.length },
            "Cached role embedding"
          );
        } else {
          logger.warn({ role }, "Empty embedding returned for role");
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { role, error: msg },
          "Failed to generate embedding for role"
        );
      }
    }

    if (this.cache.size > 0) {
      this.initialized = true;
      logger.info(
        {
          cachedRoles: this.cache.size,
          totalRoles: Object.keys(ROLE_DESCRIPTIONS).length,
        },
        "Role embedding cache initialized"
      );
    } else {
      logger.warn(
        "No role embeddings could be loaded — embedding classifier unavailable"
      );
    }
  }

  getRoleEmbedding(role: string): number[] | undefined {
    return this.cache.get(role);
  }

  getAllRoles(): string[] {
    return Array.from(this.cache.keys());
  }

  /** Force reload of all role embeddings (e.g., after model change) */
  invalidate(): void {
    this.cache.clear();
    this.initialized = false;
    this.initializing = null;
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Assumes vectors are the same length.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    const valA = a[i] as number;
    const valB = b[i] as number;
    dotProduct += valA * valB;
    normA += valA * valA;
    normB += valB * valB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) {
    return 0;
  }
  return dotProduct / denominator;
}

export interface ClassificationResult {
  confidence: number;
  reasoning: string;
  role: string;
}

const roleEmbeddingCache = new RoleEmbeddingCache();

/**
 * Classify a task description by computing its embedding and comparing
 * against pre-cached role description embeddings using cosine similarity.
 *
 * Returns the best matching role with confidence score. When the gap
 * between the top two matches is less than 0.15, marks the result as
 * "ambiguous" to signal that LLM disambiguation should be used.
 */
export async function classifyTask(
  description: string
): Promise<ClassificationResult> {
  const ready = await roleEmbeddingCache.ensureInitialized();
  if (!ready) {
    throw new Error(
      "Embedding classifier unavailable: role embeddings could not be loaded"
    );
  }

  // Get embedding for the task description
  const response = await modelRouterClient.post<EmbeddingApiResponse>(
    "/v1/embeddings",
    { input: description }
  );

  const taskEmbedding = response.data.data[0]?.embedding;
  if (!taskEmbedding || taskEmbedding.length === 0) {
    throw new Error("Failed to generate embedding for task description");
  }

  // Compare against all role embeddings
  const scores: Array<{ role: string; score: number }> = [];

  for (const role of roleEmbeddingCache.getAllRoles()) {
    const roleEmbedding = roleEmbeddingCache.getRoleEmbedding(role);
    if (!roleEmbedding) {
      continue;
    }

    const score = cosineSimilarity(taskEmbedding, roleEmbedding);
    scores.push({ role, score });
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  if (scores.length === 0) {
    throw new Error("No role embeddings available for comparison");
  }

  const best = scores[0] as { role: string; score: number };
  const second = scores[1] as { role: string; score: number } | undefined;

  // Check if result is ambiguous (gap between top-2 < 0.15)
  const gap = second ? best.score - second.score : 1;
  const isAmbiguous = gap < 0.15;

  if (isAmbiguous && second) {
    logger.info(
      {
        top: best.role,
        topScore: best.score.toFixed(4),
        second: second.role,
        secondScore: second.score.toFixed(4),
        gap: gap.toFixed(4),
      },
      "Ambiguous classification — LLM disambiguation recommended"
    );

    return {
      role: "ambiguous",
      confidence: best.score,
      reasoning: `Ambiguous: "${best.role}" (${best.score.toFixed(3)}) vs "${second.role}" (${second.score.toFixed(3)}), gap=${gap.toFixed(3)} < 0.15 threshold`,
    };
  }

  logger.info(
    {
      role: best.role,
      confidence: best.score.toFixed(4),
      gap: gap.toFixed(4),
    },
    "Task classified via embedding similarity"
  );

  return {
    role: best.role,
    confidence: best.score,
    reasoning: `Embedding similarity: "${best.role}" scored ${best.score.toFixed(3)}${second ? `, next="${second.role}" at ${second.score.toFixed(3)}` : ""}`,
  };
}

/** Invalidate the role embedding cache (e.g., when embedding model changes) */
export function invalidateRoleEmbeddingCache(): void {
  roleEmbeddingCache.invalidate();
}
