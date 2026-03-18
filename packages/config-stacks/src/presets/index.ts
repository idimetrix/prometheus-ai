export { DJANGO_REACT_PRESET } from "./django-react";
export { FLUTTER_PRESET } from "./flutter";
export { GO_HTMX_PRESET } from "./go-htmx";
export { LARAVEL_VUE_PRESET } from "./laravel-vue";
export { NEXTJS_PRESET } from "./nextjs";
export { RAILS_PRESET } from "./rails";
export { REACT_NATIVE_PRESET } from "./react-native";
export { RUST_AXUM_PRESET } from "./rust-axum";
export type { TechStackPresetExtended } from "./types";

import { DJANGO_REACT_PRESET } from "./django-react";
import { FLUTTER_PRESET } from "./flutter";
import { GO_HTMX_PRESET } from "./go-htmx";
import { LARAVEL_VUE_PRESET } from "./laravel-vue";
import { NEXTJS_PRESET } from "./nextjs";
import { RAILS_PRESET } from "./rails";
import { REACT_NATIVE_PRESET } from "./react-native";
import { RUST_AXUM_PRESET } from "./rust-axum";
import type { TechStackPresetExtended } from "./types";

/**
 * All extended tech stack presets indexed by ID.
 */
export const EXTENDED_PRESETS: Record<string, TechStackPresetExtended> = {
  [NEXTJS_PRESET.id]: NEXTJS_PRESET,
  [DJANGO_REACT_PRESET.id]: DJANGO_REACT_PRESET,
  [RAILS_PRESET.id]: RAILS_PRESET,
  [LARAVEL_VUE_PRESET.id]: LARAVEL_VUE_PRESET,
  [GO_HTMX_PRESET.id]: GO_HTMX_PRESET,
  [FLUTTER_PRESET.id]: FLUTTER_PRESET,
  [REACT_NATIVE_PRESET.id]: REACT_NATIVE_PRESET,
  [RUST_AXUM_PRESET.id]: RUST_AXUM_PRESET,
};

/**
 * Get an extended preset by ID.
 */
export function getExtendedPreset(
  id: string
): TechStackPresetExtended | undefined {
  return EXTENDED_PRESETS[id];
}
