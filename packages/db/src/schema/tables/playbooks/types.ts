import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { playbookRuns } from "./playbook-runs";
import { playbooks } from "./playbooks";

export const insertPlaybookSchema = createInsertSchema(playbooks);
export const selectPlaybookSchema = createSelectSchema(playbooks);
export type Playbook = typeof playbooks.$inferSelect;
export type NewPlaybook = typeof playbooks.$inferInsert;

export const insertPlaybookRunSchema = createInsertSchema(playbookRuns);
export const selectPlaybookRunSchema = createSelectSchema(playbookRuns);
export type PlaybookRun = typeof playbookRuns.$inferSelect;
export type NewPlaybookRun = typeof playbookRuns.$inferInsert;
