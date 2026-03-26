/**
 * Maps detected tech stacks to appropriate Docker base images for sandboxes.
 */

// ---------------------------------------------------------------------------
// Base image mapping
// ---------------------------------------------------------------------------

const BASE_IMAGE_MAP: Record<string, string> = {
  node: "node:20-slim",
  python: "python:3.12-slim",
  go: "golang:1.22",
  rust: "rust:1.77",
  java: "eclipse-temurin:21",
  kotlin: "eclipse-temurin:21",
  ruby: "ruby:3.3",
  php: "php:8.3-cli",
  dart: "dart:3.3",
  flutter: "ghcr.io/cirruslabs/flutter:latest",
  swift: "swift:5.10",
  multi: "ubuntu:22.04",
};

/**
 * Resolve the sandbox Docker base image for a given language key.
 *
 * @param language - A lowercase language identifier (e.g. "node", "python").
 *   Pass `"multi"` when multiple languages are detected to get a full dev
 *   image.
 * @returns The Docker image tag to use.
 */
export function getBaseImage(language: string): string {
  return (
    BASE_IMAGE_MAP[language.toLowerCase()] ??
    BASE_IMAGE_MAP.multi ??
    "ubuntu:22.04"
  );
}

/**
 * Given a list of detected languages, pick the best base image.
 *
 * - Single language: maps directly.
 * - Multiple languages: returns the `multi` (ubuntu) image.
 * - No languages detected: defaults to `node:20-slim`.
 */
export function resolveBaseImage(languages: string[]): string {
  if (languages.length === 0) {
    return BASE_IMAGE_MAP.node ?? "node:20-slim";
  }
  if (languages.length === 1) {
    const lang = (languages[0] as string).toLowerCase();
    // Normalize language names to image map keys
    const normalized = normalizeLanguageKey(lang);
    return BASE_IMAGE_MAP[normalized] ?? BASE_IMAGE_MAP.multi ?? "ubuntu:22.04";
  }
  return BASE_IMAGE_MAP.multi ?? "ubuntu:22.04";
}

/**
 * Normalize a language name to a base image map key.
 */
function normalizeLanguageKey(lang: string): string {
  const mapping: Record<string, string> = {
    typescript: "node",
    javascript: "node",
    node: "node",
    "node.js": "node",
    python: "python",
    go: "go",
    golang: "go",
    rust: "rust",
    java: "java",
    kotlin: "kotlin",
    ruby: "ruby",
    php: "php",
    dart: "dart",
    flutter: "flutter",
    swift: "swift",
  };
  return mapping[lang] ?? lang;
}

/**
 * Full map of language to base image, exposed for consumers that need
 * to iterate or display all options.
 */
export const BASE_IMAGES = { ...BASE_IMAGE_MAP } as Readonly<
  Record<string, string>
>;
