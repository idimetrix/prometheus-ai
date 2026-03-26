import type { SkillPack } from "./ecommerce";

export { DATA_PIPELINE_SKILL_PACK } from "./data-pipeline";
export type { SkillPack, SkillPattern } from "./ecommerce";
export { ECOMMERCE_SKILL_PACK } from "./ecommerce";
export { MOBILE_SKILL_PACK } from "./mobile";
export { SAAS_SKILL_PACK } from "./saas";

/**
 * Registry of all available domain skill packs.
 * Provides lookup by ID and category, and returns agent hints
 * for a given domain to inject into agent system prompts.
 */
export class SkillPackRegistry {
  private readonly packs = new Map<string, SkillPack>();

  constructor(packs?: SkillPack[]) {
    if (packs) {
      for (const pack of packs) {
        this.packs.set(pack.id, pack);
      }
    }
  }

  /** Register a skill pack in the registry */
  register(pack: SkillPack): void {
    this.packs.set(pack.id, pack);
  }

  /** Get a skill pack by ID */
  get(id: string): SkillPack | undefined {
    return this.packs.get(id);
  }

  /** List all registered skill packs */
  list(): SkillPack[] {
    return Array.from(this.packs.values());
  }

  /** Find skill packs matching any of the given tags */
  findByTags(tags: string[]): SkillPack[] {
    const lowerTags = new Set(tags.map((t) => t.toLowerCase()));
    return this.list().filter((pack) =>
      pack.tags.some((t) => lowerTags.has(t.toLowerCase()))
    );
  }

  /** Get agent hints for a specific domain and agent role */
  getAgentHints(packId: string, agentRole: string): string | null {
    const pack = this.packs.get(packId);
    if (!pack) {
      return null;
    }
    return pack.agentHints[agentRole] ?? null;
  }

  /** Get all patterns for a domain skill pack */
  getPatterns(packId: string): SkillPack["patterns"] {
    const pack = this.packs.get(packId);
    return pack?.patterns ?? [];
  }

  /** Get the total count of registered packs */
  get size(): number {
    return this.packs.size;
  }
}
