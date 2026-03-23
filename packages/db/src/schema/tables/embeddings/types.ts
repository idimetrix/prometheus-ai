import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { codeEmbeddings, fileIndexes } from "./embeddings";

export const insertCodeEmbeddingSchema = createInsertSchema(codeEmbeddings);
export const selectCodeEmbeddingSchema = createSelectSchema(codeEmbeddings);
export type CodeEmbedding = typeof codeEmbeddings.$inferSelect;
export type NewCodeEmbedding = typeof codeEmbeddings.$inferInsert;

export const insertFileIndexSchema = createInsertSchema(fileIndexes);
export const selectFileIndexSchema = createSelectSchema(fileIndexes);
export type FileIndex = typeof fileIndexes.$inferSelect;
export type NewFileIndex = typeof fileIndexes.$inferInsert;
