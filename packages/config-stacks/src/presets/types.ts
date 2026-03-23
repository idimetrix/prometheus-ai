import type { TechStackPreset } from "../presets";

/**
 * Extended preset type that includes dependencies, file templates,
 * conventions, and agent hints for each tech stack.
 */
export interface TechStackPresetExtended extends TechStackPreset {
  /** Hints for each agent role when working with this stack */
  agentHints: Record<string, string>;

  /** Coding conventions specific to this stack */
  conventions: Record<string, string>;
  /** Package dependencies grouped by category */
  dependencies: {
    runtime: Record<string, string>;
    dev: Record<string, string>;
  };

  /** File templates with descriptions of what each generates */
  fileTemplates: Record<string, string>;
}
