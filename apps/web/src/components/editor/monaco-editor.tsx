"use client";

import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef } from "react";

/* -------------------------------------------------------------------------- */
/*  Language Detection                                                         */
/* -------------------------------------------------------------------------- */

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  env: "ini",
  dockerfile: "dockerfile",
  graphql: "graphql",
  gql: "graphql",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  r: "r",
  lua: "lua",
  tf: "hcl",
};

export function detectLanguage(filePath: string): string {
  const fileName = filePath.split("/").pop()?.toLowerCase() ?? "";

  // Handle special filenames
  if (fileName === "dockerfile" || fileName.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  if (fileName === "makefile" || fileName === "gnumakefile") {
    return "shell";
  }

  const ext = fileName.split(".").pop() ?? "";
  return EXTENSION_LANGUAGE_MAP[ext] ?? "plaintext";
}

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface EditorFile {
  content: string;
  language?: string;
  path: string;
}

interface MonacoEditorProps {
  className?: string;
  file: EditorFile;
  onChange?: (value: string) => void;
  readOnly?: boolean;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function MonacoEditor({
  file,
  onChange,
  readOnly = false,
  className = "",
}: MonacoEditorProps) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  const language = file.language ?? detectLanguage(file.path);

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      // Configure editor options
      editor.updateOptions({
        minimap: { enabled: true },
        wordWrap: "off",
        lineNumbers: "on",
        bracketPairColorization: { enabled: true },
        autoClosingBrackets: "always",
        autoClosingQuotes: "always",
        matchBrackets: "always",
        renderWhitespace: "selection",
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
        fontLigatures: true,
        tabSize: 2,
        readOnly,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        padding: { top: 8, bottom: 8 },
      });

      // Format document shortcut: Ctrl+Shift+F
      editor.addAction({
        id: "format-document",
        label: "Format Document",
        keybindings: [
          monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF,
        ],
        run: (ed) => {
          ed.getAction("editor.action.formatDocument")?.run();
        },
      });

      // Toggle word wrap shortcut: Alt+Z
      editor.addAction({
        id: "toggle-word-wrap",
        label: "Toggle Word Wrap",
        keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
        run: (ed) => {
          const currentWrap = ed.getOption(monaco.editor.EditorOption.wordWrap);
          ed.updateOptions({
            wordWrap: currentWrap === "off" ? "on" : "off",
          });
        },
      });

      // Set dark theme
      monaco.editor.defineTheme("prometheus-dark", {
        base: "vs-dark",
        inherit: true,
        rules: [
          { token: "comment", foreground: "6a737d", fontStyle: "italic" },
          { token: "keyword", foreground: "c678dd" },
          { token: "string", foreground: "98c379" },
          { token: "number", foreground: "d19a66" },
          { token: "type", foreground: "e5c07b" },
        ],
        colors: {
          "editor.background": "#09090b",
          "editor.foreground": "#d4d4d8",
          "editorLineNumber.foreground": "#52525b",
          "editorLineNumber.activeForeground": "#a1a1aa",
          "editor.selectionBackground": "#3f3f4640",
          "editor.lineHighlightBackground": "#27272a40",
          "editorCursor.foreground": "#8b5cf6",
          "editorBracketMatch.border": "#8b5cf680",
          "editorBracketMatch.background": "#8b5cf620",
          "editorIndentGuide.background": "#27272a",
          "editorIndentGuide.activeBackground": "#3f3f46",
          "scrollbarSlider.background": "#27272a80",
          "scrollbarSlider.hoverBackground": "#3f3f46",
          "scrollbarSlider.activeBackground": "#52525b",
        },
      });
      monaco.editor.setTheme("prometheus-dark");
    },
    [readOnly]
  );

  // Update readOnly when prop changes
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        onChange?.(value);
      }
    },
    [onChange]
  );

  return (
    <div className={`h-full w-full overflow-hidden ${className}`}>
      <Editor
        defaultValue={file.content}
        language={language}
        loading={
          <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-600">
            Loading editor...
          </div>
        }
        onChange={handleChange}
        onMount={handleMount}
        path={file.path}
        theme="vs-dark"
      />
    </div>
  );
}
