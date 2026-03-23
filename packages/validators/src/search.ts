import { z } from "zod";

// ---------- Text search ----------
export const textSearchSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1).max(500),
  filePath: z.string().optional(),
  language: z.string().optional(),
  caseSensitive: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(200).default(50),
  includeContext: z.boolean().default(true),
  contextLines: z.number().int().min(0).max(10).default(3),
});

// ---------- Semantic search ----------
export const semanticSearchSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1).max(2000),
  topK: z.number().int().min(1).max(100).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
  filePath: z.string().optional(),
  language: z.string().optional(),
});

// ---------- File search ----------
export const fileSearchSchema = z.object({
  projectId: z.string().min(1),
  pattern: z.string().min(1).max(200),
  maxResults: z.number().int().min(1).max(500).default(100),
});

// ---------- Symbol search ----------
export const symbolSearchSchema = z.object({
  projectId: z.string().min(1),
  query: z.string().min(1).max(200),
  kind: z
    .enum([
      "function",
      "class",
      "interface",
      "type",
      "variable",
      "constant",
      "method",
      "all",
    ])
    .default("all"),
  maxResults: z.number().int().min(1).max(100).default(20),
});

// ---------- Output schemas ----------
export const textSearchResultSchema = z.object({
  filePath: z.string(),
  line: z.number(),
  column: z.number(),
  content: z.string(),
  contextBefore: z.array(z.string()),
  contextAfter: z.array(z.string()),
});

export const textSearchOutputSchema = z.object({
  results: z.array(textSearchResultSchema),
  totalMatches: z.number(),
  truncated: z.boolean(),
});

export const semanticSearchResultSchema = z.object({
  filePath: z.string(),
  chunkIndex: z.number(),
  content: z.string(),
  score: z.number(),
});

export const semanticSearchOutputSchema = z.object({
  results: z.array(semanticSearchResultSchema),
});

export const fileSearchResultSchema = z.object({
  filePath: z.string(),
  language: z.string().nullable(),
  loc: z.number().nullable(),
});

export const fileSearchOutputSchema = z.object({
  results: z.array(fileSearchResultSchema),
  totalMatches: z.number(),
});

export const symbolSearchResultSchema = z.object({
  name: z.string(),
  kind: z.string(),
  filePath: z.string(),
  line: z.number(),
});

export const symbolSearchOutputSchema = z.object({
  results: z.array(symbolSearchResultSchema),
});

// ---------- Types ----------
export type TextSearchInput = z.infer<typeof textSearchSchema>;
export type SemanticSearchInput = z.infer<typeof semanticSearchSchema>;
export type FileSearchInput = z.infer<typeof fileSearchSchema>;
export type SymbolSearchInput = z.infer<typeof symbolSearchSchema>;
export type TextSearchOutput = z.infer<typeof textSearchOutputSchema>;
export type SemanticSearchOutput = z.infer<typeof semanticSearchOutputSchema>;
export type FileSearchOutput = z.infer<typeof fileSearchOutputSchema>;
export type SymbolSearchOutput = z.infer<typeof symbolSearchOutputSchema>;
