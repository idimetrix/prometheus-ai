import { z } from "zod";

export const marketplaceCategorySchema = z.enum([
  "button",
  "form",
  "layout",
  "navigation",
  "data-display",
  "feedback",
  "overlay",
  "chart",
  "other",
]);

export const listMarketplaceSchema = z.object({
  search: z.string().optional(),
  category: marketplaceCategorySchema.optional(),
  sortBy: z.enum(["downloads", "rating", "newest"]).default("downloads"),
  limit: z.number().int().min(1).max(100).default(24),
  cursor: z.string().optional(),
});

export const getMarketplaceComponentSchema = z.object({
  componentId: z.string().min(1),
});

export const publishMarketplaceComponentSchema = z.object({
  name: z.string().min(1).max(100),
  displayName: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: marketplaceCategorySchema.optional(),
  tags: z.array(z.string().max(50)).max(10).optional(),
  code: z.string().min(1).max(100_000),
  language: z.string().default("tsx"),
  dependencies: z.array(z.string().max(200)).max(50).optional(),
  previewImageUrl: z.string().url().optional(),
  demoUrl: z.string().url().optional(),
  isPublic: z.boolean().default(true),
  version: z.string().default("1.0.0"),
});

export const updateMarketplaceComponentSchema = z.object({
  componentId: z.string().min(1),
  data: publishMarketplaceComponentSchema.partial(),
});

export const unpublishMarketplaceComponentSchema = z.object({
  componentId: z.string().min(1),
});

export const installMarketplaceComponentSchema = z.object({
  componentId: z.string().min(1),
});

export const reviewMarketplaceComponentSchema = z.object({
  componentId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

export const myMarketplaceComponentsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(24),
  cursor: z.string().optional(),
});

export type ListMarketplaceInput = z.infer<typeof listMarketplaceSchema>;
export type GetMarketplaceComponentInput = z.infer<
  typeof getMarketplaceComponentSchema
>;
export type PublishMarketplaceComponentInput = z.infer<
  typeof publishMarketplaceComponentSchema
>;
export type UpdateMarketplaceComponentInput = z.infer<
  typeof updateMarketplaceComponentSchema
>;
export type UnpublishMarketplaceComponentInput = z.infer<
  typeof unpublishMarketplaceComponentSchema
>;
export type InstallMarketplaceComponentInput = z.infer<
  typeof installMarketplaceComponentSchema
>;
export type ReviewMarketplaceComponentInput = z.infer<
  typeof reviewMarketplaceComponentSchema
>;
export type MyMarketplaceComponentsInput = z.infer<
  typeof myMarketplaceComponentsSchema
>;
