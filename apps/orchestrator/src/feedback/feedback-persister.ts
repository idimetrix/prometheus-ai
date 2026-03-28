import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:feedback-persister");

export interface CorrectionInput {
  after: string;
  before: string;
  category:
    | "style"
    | "logic"
    | "performance"
    | "security"
    | "naming"
    | "library"
    | "pattern";
  projectId: string;
  sessionId: string;
  userMessage: string;
}

export interface LearnedConvention {
  confidence: number;
  rule: string;
}

interface Database {
  execute: (query: string, params: unknown[]) => Promise<unknown>;
  query: <T>(query: string, params: unknown[]) => Promise<T[]>;
}

/**
 * Persists user corrections to the project brain for future prompt injection.
 * When a user corrects the agent mid-session, this class extracts the convention
 * rule and stores it in both agent_memories (procedural memory) and project_rules.
 */
export class FeedbackPersister {
  private readonly db: Database;
  private readonly projectBrainUrl: string;

  constructor(db: Database, projectBrainUrl: string) {
    this.db = db;
    this.projectBrainUrl = projectBrainUrl;
  }

  /**
   * When user corrects agent (e.g., "use Zustand not Redux"):
   * 1. Store in agent_memories table as procedural memory
   * 2. Extract convention rule
   * 3. Store in project_rules table for future prompt injection
   */
  async persistCorrection(correction: CorrectionInput): Promise<void> {
    const memoryId = generateId("mem");
    const ruleId = generateId("rul");

    // Extract a convention rule from the correction
    const rule = this.extractRule(correction);

    try {
      // 1. Store in agent_memories as procedural memory
      await this.db.execute(
        `INSERT INTO agent_memories (id, project_id, session_id, type, content, category, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          memoryId,
          correction.projectId,
          correction.sessionId,
          "procedural",
          JSON.stringify({
            userMessage: correction.userMessage,
            before: correction.before,
            after: correction.after,
            category: correction.category,
          }),
          correction.category,
          0.8,
        ]
      );

      // 2. Store in project_rules for future prompt injection
      await this.db.execute(
        `INSERT INTO project_rules (id, project_id, rule, category, source, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          ruleId,
          correction.projectId,
          rule,
          correction.category,
          "user_correction",
          0.8,
        ]
      );

      // 3. Notify project brain about the new convention
      await this.notifyProjectBrain(correction.projectId, rule);

      logger.info(
        {
          memoryId,
          ruleId,
          projectId: correction.projectId,
          category: correction.category,
        },
        "Correction persisted"
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          projectId: correction.projectId,
        },
        "Failed to persist correction"
      );
      throw error;
    }
  }

  /**
   * Get all learned conventions for a project.
   */
  async getLearnedConventions(projectId: string): Promise<LearnedConvention[]> {
    try {
      const rules = await this.db.query<{
        confidence: number;
        rule: string;
      }>(
        `SELECT rule, confidence FROM project_rules
         WHERE project_id = $1 AND source = 'user_correction'
         ORDER BY confidence DESC, created_at DESC`,
        [projectId]
      );

      return rules.map((r) => ({
        rule: r.rule,
        confidence: r.confidence,
      }));
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          projectId,
        },
        "Failed to fetch learned conventions"
      );
      return [];
    }
  }

  private extractRule(correction: CorrectionInput): string {
    // Build a rule string from the correction context
    const categoryPrefix =
      correction.category.charAt(0).toUpperCase() +
      correction.category.slice(1);
    return `[${categoryPrefix}] ${correction.userMessage} (Before: "${correction.before.slice(0, 100)}" -> After: "${correction.after.slice(0, 100)}")`;
  }

  private async notifyProjectBrain(
    projectId: string,
    rule: string
  ): Promise<void> {
    try {
      await fetch(`${this.projectBrainUrl}/conventions/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, rule }),
      });
    } catch (error) {
      // Non-critical — log and continue
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          projectId,
        },
        "Failed to notify project brain about new convention"
      );
    }
  }
}
