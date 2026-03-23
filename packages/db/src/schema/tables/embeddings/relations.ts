import { relations } from "drizzle-orm";
import { projects } from "../projects/projects";
import { codeEmbeddings, fileIndexes } from "./embeddings";

export const codeEmbeddingsRelations = relations(codeEmbeddings, ({ one }) => ({
  project: one(projects, {
    fields: [codeEmbeddings.projectId],
    references: [projects.id],
  }),
}));

export const fileIndexesRelations = relations(fileIndexes, ({ one }) => ({
  project: one(projects, {
    fields: [fileIndexes.projectId],
    references: [projects.id],
  }),
}));
