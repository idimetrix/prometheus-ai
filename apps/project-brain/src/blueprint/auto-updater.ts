import { blueprints, db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, desc, eq } from "drizzle-orm";

const logger = createLogger("project-brain:blueprint:auto-updater");

export interface BlueprintUpdateProposal {
  change: string;
  reasoning: string;
  riskLevel: "low" | "medium" | "high";
  section: string;
  sourceAgent: string;
}

export interface BlueprintVersion {
  content: string;
  createdAt: Date;
  createdBy: string;
  diff: string;
  id: string;
  projectId: string;
  version: number;
}

/**
 * BlueprintAutoUpdater manages the living blueprint that evolves as agents
 * discover new conventions and patterns. Low-risk updates auto-apply;
 * high-risk ones require user checkpoint approval.
 */
export class BlueprintAutoUpdater {
  private readonly eventPublisher = new EventPublisher();

  /**
   * Propose an update to the blueprint.
   * Low-risk updates are auto-applied; high-risk require approval.
   */
  async proposeUpdate(
    projectId: string,
    sessionId: string,
    proposal: BlueprintUpdateProposal
  ): Promise<{
    applied: boolean;
    requiresApproval: boolean;
    versionId?: string;
  }> {
    logger.info(
      {
        projectId,
        section: proposal.section,
        riskLevel: proposal.riskLevel,
        sourceAgent: proposal.sourceAgent,
      },
      "Blueprint update proposed"
    );

    if (proposal.riskLevel === "high") {
      // Publish checkpoint for approval
      await this.eventPublisher.publishSessionEvent(sessionId, {
        type: QueueEvents.CHECKPOINT,
        data: {
          event: "blueprint_update_proposed",
          proposal,
          message: `Agent ${proposal.sourceAgent} proposes a high-risk blueprint change to section "${proposal.section}": ${proposal.change}`,
        },
        timestamp: new Date().toISOString(),
      });

      return { applied: false, requiresApproval: true };
    }

    // Auto-apply low and medium risk updates
    const versionId = await this.applyUpdate(projectId, proposal);

    // Notify active agents about blueprint change
    await this.eventPublisher.publishSessionEvent(sessionId, {
      type: QueueEvents.PLAN_UPDATE,
      data: {
        event: "blueprint_updated",
        section: proposal.section,
        change: proposal.change,
        riskLevel: proposal.riskLevel,
        versionId,
      },
      timestamp: new Date().toISOString(),
    });

    return { applied: true, requiresApproval: false, versionId };
  }

  /**
   * Apply an update to the blueprint, creating a new version.
   */
  async applyUpdate(
    projectId: string,
    proposal: BlueprintUpdateProposal
  ): Promise<string> {
    // Load current blueprint
    const current = await db
      .select()
      .from(blueprints)
      .where(
        and(eq(blueprints.projectId, projectId), eq(blueprints.isActive, true))
      )
      .limit(1);

    const currentContent =
      typeof current[0]?.content === "string" ? current[0].content : "";
    const currentVersionNum = current[0]?.version
      ? Number.parseInt(current[0].version, 10)
      : 0;
    const nextVersion = currentVersionNum + 1;

    // Apply the change to the appropriate section
    const updatedContent = this.applyChangeToSection(
      currentContent,
      proposal.section,
      proposal.change
    );

    const versionId = generateId("bpv");

    // Deactivate current blueprint
    if (current[0]) {
      await db
        .update(blueprints)
        .set({ isActive: false })
        .where(eq(blueprints.id, current[0].id));
    }

    // Create new version (version column is text in schema)
    await db.insert(blueprints).values({
      id: versionId,
      projectId,
      content: updatedContent,
      version: String(nextVersion),
      isActive: true,
    });

    logger.info(
      {
        projectId,
        versionId,
        version: nextVersion,
        section: proposal.section,
      },
      "Blueprint updated"
    );

    return versionId;
  }

  /**
   * Get blueprint version history for a project.
   */
  async getVersionHistory(
    projectId: string,
    limit = 10
  ): Promise<
    Array<{
      id: string;
      version: string;
      isActive: boolean;
      createdAt: Date | null;
    }>
  > {
    const versions = await db
      .select({
        id: blueprints.id,
        version: blueprints.version,
        isActive: blueprints.isActive,
        createdAt: blueprints.createdAt,
      })
      .from(blueprints)
      .where(eq(blueprints.projectId, projectId))
      .orderBy(desc(blueprints.version))
      .limit(limit);

    return versions;
  }

  private applyChangeToSection(
    content: string,
    sectionName: string,
    change: string
  ): string {
    // Try to find the section and append the change
    const sectionRegex = new RegExp(
      `(## ${sectionName}[^\\n]*\\n)([\\s\\S]*?)(?=\\n## |$)`,
      "i"
    );
    const match = content.match(sectionRegex);

    if (match) {
      // Append to existing section
      const sectionBody = match[2] ?? "";
      const updatedSection = `${match[1]}${sectionBody.trimEnd()}\n- ${change}\n`;
      return content.replace(sectionRegex, updatedSection);
    }

    // Section not found, append at end
    return `${content}\n\n## ${sectionName}\n- ${change}\n`;
  }
}
