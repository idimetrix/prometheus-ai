import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

/** @type {import("eslint").Linter.Config[]} */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  { ignores: ["dist/", ".next/", "node_modules/", ".turbo/"] },
];

/** @type {import("eslint").Linter.Config[]} */
export const reactConfig = [
  ...baseConfig,
  {
    plugins: {
      react: (await import("eslint-plugin-react")).default,
      "react-hooks": (await import("eslint-plugin-react-hooks")).default,
    },
    languageOptions: {
      globals: { ...globals.browser },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
  },
];

/** @type {import("eslint").Linter.Config[]} */
export const nodeConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
];
