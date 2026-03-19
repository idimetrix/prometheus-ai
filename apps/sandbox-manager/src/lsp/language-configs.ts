export interface LanguageServerConfig {
  args: string[];
  command: string;
  fileExtensions: string[];
  initializationOptions?: Record<string, unknown>;
  language: string;
}

export const LANGUAGE_SERVER_CONFIGS: Record<string, LanguageServerConfig> = {
  typescript: {
    language: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    fileExtensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  python: {
    language: "python",
    command: "pyright-langserver",
    args: ["--stdio"],
    fileExtensions: [".py", ".pyi"],
  },
  go: {
    language: "go",
    command: "gopls",
    args: ["serve"],
    fileExtensions: [".go"],
  },
  rust: {
    language: "rust",
    command: "rust-analyzer",
    args: [],
    fileExtensions: [".rs"],
  },
  java: {
    language: "java",
    command: "jdtls",
    args: [],
    fileExtensions: [".java"],
  },
};

export function getLanguageForFile(
  filePath: string
): LanguageServerConfig | undefined {
  const ext = filePath.slice(filePath.lastIndexOf("."));
  for (const config of Object.values(LANGUAGE_SERVER_CONFIGS)) {
    if (config.fileExtensions.includes(ext)) {
      return config;
    }
  }
  return undefined;
}
