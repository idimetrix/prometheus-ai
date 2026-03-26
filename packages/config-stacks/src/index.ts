export { detectTechStack } from "./detector";
export { getPreset, TECH_STACK_PRESETS, type TechStackPreset } from "./presets";
export {
  DJANGO_REACT_PRESET,
  EXTENDED_PRESETS,
  FLUTTER_PRESET,
  GO_HTMX_PRESET,
  getExtendedPreset,
  LARAVEL_VUE_PRESET,
  NEXTJS_PRESET,
  RAILS_PRESET,
  REACT_NATIVE_PRESET,
  RUST_AXUM_PRESET,
  type TechStackPresetExtended,
} from "./presets/index";
export {
  aiMlSkillPack,
  devopsSkillPack,
  fintechSkillPack,
  healthcareSkillPack,
  SKILL_PACKS,
} from "./skill-packs/index";
export {
  type AgentStep,
  generateScaffoldBlueprint,
  listScaffoldTemplates,
  matchScaffoldTemplate,
  type ScaffoldBlueprint,
} from "./templates/index";
export type {
  WorkspaceDetectionResult,
  WorkspaceType,
} from "./workspace-detector";
export { detectWorkspace } from "./workspace-detector";
