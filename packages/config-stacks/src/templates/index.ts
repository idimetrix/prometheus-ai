export type { ProjectTemplate, ScaffoldFile, TemplateCategory } from "./types";

import { DJANGO_HTMX_TEMPLATE } from "./django-htmx";
import { EXPRESS_API_TEMPLATE } from "./express-api";
import { FASTAPI_REACT_TEMPLATE } from "./fastapi-react";
import { GO_FIBER_TEMPLATE } from "./go-fiber";
import { MONOREPO_TURBO_TEMPLATE } from "./monorepo-turbo";
import { NEXTJS_TRPC_TEMPLATE } from "./nextjs-trpc";
import { REACT_NATIVE_TEMPLATE } from "./react-native";
import { RUST_AXUM_TEMPLATE } from "./rust-axum";
import type { ProjectTemplate } from "./types";

export { DJANGO_HTMX_TEMPLATE } from "./django-htmx";
export { EXPRESS_API_TEMPLATE } from "./express-api";
export { FASTAPI_REACT_TEMPLATE } from "./fastapi-react";
export { GO_FIBER_TEMPLATE } from "./go-fiber";
export { MONOREPO_TURBO_TEMPLATE } from "./monorepo-turbo";
export { NEXTJS_TRPC_TEMPLATE } from "./nextjs-trpc";
export { REACT_NATIVE_TEMPLATE } from "./react-native";
export { RUST_AXUM_TEMPLATE } from "./rust-axum";

/**
 * All available project templates indexed by ID.
 */
export const PROJECT_TEMPLATES: Record<string, ProjectTemplate> = {
  [NEXTJS_TRPC_TEMPLATE.id]: NEXTJS_TRPC_TEMPLATE,
  [FASTAPI_REACT_TEMPLATE.id]: FASTAPI_REACT_TEMPLATE,
  [EXPRESS_API_TEMPLATE.id]: EXPRESS_API_TEMPLATE,
  [DJANGO_HTMX_TEMPLATE.id]: DJANGO_HTMX_TEMPLATE,
  [GO_FIBER_TEMPLATE.id]: GO_FIBER_TEMPLATE,
  [RUST_AXUM_TEMPLATE.id]: RUST_AXUM_TEMPLATE,
  [REACT_NATIVE_TEMPLATE.id]: REACT_NATIVE_TEMPLATE,
  [MONOREPO_TURBO_TEMPLATE.id]: MONOREPO_TURBO_TEMPLATE,
};

/**
 * All templates as an array, sorted by name.
 */
export const PROJECT_TEMPLATES_LIST: ProjectTemplate[] = Object.values(
  PROJECT_TEMPLATES
).sort((a, b) => a.name.localeCompare(b.name));

/**
 * Look up a project template by ID.
 */
export function getProjectTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES[id];
}

/**
 * Generate scaffold files for a given template and project name.
 * Returns undefined if the template is not found.
 */
export function generateScaffold(
  templateId: string,
  projectName: string
): { files: Array<{ path: string; content: string }> } | undefined {
  const template = PROJECT_TEMPLATES[templateId];
  if (!template) {
    return undefined;
  }
  return { files: template.scaffoldFiles(projectName) };
}
