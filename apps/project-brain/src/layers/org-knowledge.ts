/**
 * Phase 7.3: Org-wide Knowledge Layer.
 *
 * Enables semantic search across all projects within an organization.
 * Respects per-project privacy opt-out settings.
 */
import { codeEmbeddings, db, projects } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq, inArray, sql } from "drizzle-orm";

const logger = createLogger("project-brain:org-knowledge");

export interface OrgSearchResult {
  content: string;
  filePath: string;
  projectId: string;
  projectName: string;
  score: number;
}

/**
 * OrgKnowledgeLayer provides organization-scoped semantic search
 * across all projects, with per-project privacy opt-out.
 */
export class OrgKnowledgeLayer {
  /**
   * Search across all projects in an organization using semantic similarity.
   * Projects with org knowledge sharing disabled are excluded.
   */
  async searchAcrossProjects(
    orgId: string,
    query: string,
    limit = 10
  ): Promise<OrgSearchResult[]> {
    // Get all projects in the org that haven't opted out
    const orgProjects = await db
      .select({
        id: projects.id,
        name: projects.name,
      })
      .from(projects)
      .where(eq(projects.orgId, orgId));

    if (orgProjects.length === 0) {
      logger.debug({ orgId }, "No projects found for org");
      return [];
    }

    // Filter out projects that have opted out of org-wide knowledge sharing
    const eligibleProjects = await this.filterOptedInProjects(orgProjects);

    if (eligibleProjects.length === 0) {
      logger.debug({ orgId }, "All projects have opted out of org knowledge");
      return [];
    }

    const projectIds = eligibleProjects.map((p) => p.id);
    const projectNameMap = new Map(eligibleProjects.map((p) => [p.id, p.name]));

    // Generate query embedding via model-router
    const embedding = await this.generateEmbedding(query);

    try {
      const results = await db
        .select({
          projectId: codeEmbeddings.projectId,
          filePath: codeEmbeddings.filePath,
          content: codeEmbeddings.content,
          similarity: sql<number>`1 - (${codeEmbeddings.embedding} <=> ${JSON.stringify(embedding)}::vector)`,
        })
        .from(codeEmbeddings)
        .where(inArray(codeEmbeddings.projectId, projectIds))
        .orderBy(
          sql`${codeEmbeddings.embedding} <=> ${JSON.stringify(embedding)}::vector`
        )
        .limit(limit);

      return results.map((r) => ({
        projectId: r.projectId,
        projectName: projectNameMap.get(r.projectId) ?? "Unknown",
        filePath: r.filePath,
        content: r.content,
        score: Math.max(0, Math.min(1, r.similarity)),
      }));
    } catch (err) {
      logger.warn({ orgId, err }, "Org-wide semantic search failed");
      return [];
    }
  }

  /**
   * Filter projects that have not opted out of org-wide knowledge sharing.
   * Checks the project_configs table for a sharing flag.
   */
  private async filterOptedInProjects(
    orgProjects: Array<{ id: string; name: string }>
  ): Promise<Array<{ id: string; name: string }>> {
    // By default all projects are opted in.
    // Projects can opt out via a project config setting.
    try {
      const projectConfigs = await db.execute(
        sql`SELECT project_id FROM project_configs
            WHERE key = 'org_knowledge_sharing'
            AND value = 'disabled'
            AND project_id = ANY(${orgProjects.map((p) => p.id)})`
      );

      const optedOutIds = new Set(
        (projectConfigs as unknown as Array<{ project_id: string }>).map(
          (r) => r.project_id
        )
      );

      return orgProjects.filter((p) => !optedOutIds.has(p.id));
    } catch {
      // If project_configs table doesn't exist, all projects are eligible
      return orgProjects;
    }
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    const modelRouterUrl =
      process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";

    const response = await fetch(`${modelRouterUrl}/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: text }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`Embedding generation failed: HTTP ${response.status}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    if (!data.embedding?.length) {
      throw new Error("Empty embedding returned");
    }

    return data.embedding;
  }
}
