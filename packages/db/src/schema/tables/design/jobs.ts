import { index, integer, pgTable, real, text } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { chatConversations } from "../chat/conversations";
import { designUploads } from "./uploads";

/**
 * Design-to-code jobs track the pipeline from image upload through
 * code generation, visual comparison, and iterative refinement.
 */
export const designToCodeJobs = pgTable(
  "design_to_code_jobs",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `dtc_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    designUploadId: text("design_upload_id")
      .notNull()
      .references(() => designUploads.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").references(
      () => chatConversations.id,
      { onDelete: "set null" }
    ),
    /** Status: pending, analyzing, generating, refining, completed, failed */
    status: text("status").notNull().default("pending"),
    /** ID of the generated component in the components table */
    generatedComponentId: text("generated_component_id"),
    /** Number of refinement iterations completed */
    iterations: integer("iterations").notNull().default(0),
    /** Visual similarity score (0-1) between original and generated */
    finalDiffScore: real("final_diff_score"),
    /** Generated code output */
    generatedCode: text("generated_code"),
    /** Framework used: react, vue, svelte, html */
    framework: text("framework").default("react"),
    ...timestamps,
  },
  (table) => [
    index("design_to_code_jobs_upload_id_idx").on(table.designUploadId),
    index("design_to_code_jobs_status_idx").on(table.status),
    index("design_to_code_jobs_conversation_id_idx").on(table.conversationId),
  ]
);

export type DesignToCodeJob = typeof designToCodeJobs.$inferSelect;
export type NewDesignToCodeJob = typeof designToCodeJobs.$inferInsert;
