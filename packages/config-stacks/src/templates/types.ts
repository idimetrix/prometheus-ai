/**
 * Project template types for scaffolding.
 * Templates define the file structure, dependencies, and configuration
 * for a new project created from a template.
 */

export interface ScaffoldFile {
  /** File content */
  content: string;
  /** Relative path from project root */
  path: string;
}

export interface ProjectTemplate {
  /** Category for filtering */
  category: TemplateCategory;
  /** Short description */
  description: string;
  /** Estimated setup time in minutes */
  estimatedMinutes: number;
  /** Icon identifier for UI */
  icon: string;
  /** Unique identifier, e.g. "nextjs-trpc" */
  id: string;
  /** Primary language(s) */
  languages: string[];
  /** Human-readable name */
  name: string;
  /** Generate the full set of scaffold files for this template */
  scaffoldFiles(projectName: string): ScaffoldFile[];
  /** Tech stack labels for display */
  techStack: string[];
}

export type TemplateCategory =
  | "Full-Stack"
  | "Frontend"
  | "Backend"
  | "Mobile"
  | "Monorepo";
