import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";

/**
 * Design uploads store images (screenshots, mockups, Figma exports)
 * that serve as input for the image-to-code pipeline.
 */
export const designUploads = pgTable(
  "design_uploads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `dsu_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    /** MinIO storage URL for the uploaded image */
    storageUrl: text("storage_url").notNull(),
    thumbnailUrl: text("thumbnail_url"),
    originalFilename: text("original_filename"),
    mimeType: text("mime_type"),
    width: integer("width"),
    height: integer("height"),
    /** Figma file key for direct Figma integration */
    figmaFileKey: text("figma_file_key"),
    /** Figma node ID for specific component */
    figmaNodeId: text("figma_node_id"),
    /** Extracted design tokens (colors, typography, spacing) */
    extractedTokens: jsonb("extracted_tokens").$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (table) => [
    index("design_uploads_org_id_idx").on(table.orgId),
    index("design_uploads_user_id_idx").on(table.userId),
    index("design_uploads_project_id_idx").on(table.projectId),
  ]
);

export type DesignUpload = typeof designUploads.$inferSelect;
export type NewDesignUpload = typeof designUploads.$inferInsert;
