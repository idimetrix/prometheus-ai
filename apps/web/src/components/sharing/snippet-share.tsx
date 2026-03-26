"use client";

import { Badge, Button, Card } from "@prometheus/ui";
import {
  Check,
  Clock,
  Code2,
  Copy,
  ExternalLink,
  Globe,
  Link2,
  Lock,
  Share2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

type Visibility = "public" | "private";
type Expiration = "never" | "1d" | "7d" | "30d";

interface Snippet {
  code: string;
  createdAt: string;
  expiration: Expiration;
  id: string;
  language: string;
  title: string;
  url: string;
  visibility: Visibility;
}

interface SnippetShareProps {
  /** Pre-selected code from the editor */
  initialCode?: string;
  /** Detected language of the selection */
  initialLanguage?: string;
  /** Called when the dialog is closed */
  onClose?: () => void;
  /** Called when a snippet is created */
  onCreated?: (snippet: Snippet) => void;
}

interface SnippetViewerProps {
  snippet: Snippet;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const SUPPORTED_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "java",
  "ruby",
  "css",
  "html",
  "json",
  "yaml",
  "sql",
  "bash",
  "markdown",
  "plaintext",
] as const;

const EXPIRATION_LABELS: Record<Expiration, string> = {
  never: "Never expires",
  "1d": "1 day",
  "7d": "7 days",
  "30d": "30 days",
};

/* -------------------------------------------------------------------------- */
/*  Syntax Highlighting (simple token-based)                                   */
/* -------------------------------------------------------------------------- */

const KEYWORD_PATTERNS: Record<string, RegExp> = {
  typescript:
    /\b(const|let|var|function|return|if|else|for|while|class|interface|type|import|export|from|async|await|new|this|throw|try|catch|finally|switch|case|default|break|continue|null|undefined|true|false|void|typeof|instanceof)\b/g,
  javascript:
    /\b(const|let|var|function|return|if|else|for|while|class|import|export|from|async|await|new|this|throw|try|catch|finally|switch|case|default|break|continue|null|undefined|true|false|void|typeof|instanceof)\b/g,
  python:
    /\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|with|yield|lambda|None|True|False|and|or|not|in|is|raise|pass|break|continue)\b/g,
  rust: /\b(fn|let|mut|const|struct|enum|impl|trait|use|pub|mod|match|if|else|for|while|loop|return|self|Self|async|await|move|ref|true|false|None|Some|Ok|Err)\b/g,
  go: /\b(func|var|const|type|struct|interface|package|import|return|if|else|for|range|switch|case|default|break|continue|go|defer|chan|map|nil|true|false)\b/g,
};

function highlightCode(code: string, language: string): string {
  let result = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Highlight strings
  result = result.replace(
    /(["'`])(?:(?!\1|\\).|\\.)*\1/g,
    '<span class="text-emerald-400">$&</span>'
  );

  // Highlight comments
  result = result.replace(
    /\/\/.*$/gm,
    '<span class="text-zinc-500 italic">$&</span>'
  );
  result = result.replace(
    /#.*$/gm,
    '<span class="text-zinc-500 italic">$&</span>'
  );

  // Highlight keywords
  const pattern = KEYWORD_PATTERNS[language];
  if (pattern) {
    result = result.replace(
      pattern,
      '<span class="text-violet-400 font-medium">$&</span>'
    );
  }

  // Highlight numbers
  result = result.replace(
    /\b(\d+\.?\d*)\b/g,
    '<span class="text-amber-400">$&</span>'
  );

  return result;
}

/* -------------------------------------------------------------------------- */
/*  Snippet Creator                                                            */
/* -------------------------------------------------------------------------- */

export function SnippetShare({
  initialCode = "",
  initialLanguage = "typescript",
  onCreated,
  onClose,
}: SnippetShareProps) {
  const [title, setTitle] = useState("");
  const [code, setCode] = useState(initialCode);
  const [language, setLanguage] = useState(initialLanguage);
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [expiration, setExpiration] = useState<Expiration>("never");
  const [isCreating, setIsCreating] = useState(false);
  const [createdSnippet, setCreatedSnippet] = useState<Snippet | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = useCallback(() => {
    if (!code.trim()) {
      return;
    }

    setIsCreating(true);
    try {
      // In a real implementation, this would call the tRPC endpoint
      const snippet: Snippet = {
        id: `snp_${Date.now().toString(36)}`,
        title: title || "Untitled Snippet",
        code,
        language,
        visibility,
        expiration,
        createdAt: new Date().toISOString(),
        url: `${window.location.origin}/snippets/snp_${Date.now().toString(36)}`,
      };

      setCreatedSnippet(snippet);
      onCreated?.(snippet);
    } finally {
      setIsCreating(false);
    }
  }, [code, title, language, visibility, expiration, onCreated]);

  const handleCopyLink = useCallback(async () => {
    if (!createdSnippet) {
      return;
    }
    await navigator.clipboard.writeText(createdSnippet.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [createdSnippet]);

  const embedCode = useMemo(() => {
    if (!createdSnippet) {
      return "";
    }
    return `<iframe src="${createdSnippet.url}/embed" width="100%" height="400" frameborder="0" title="${createdSnippet.title}"></iframe>`;
  }, [createdSnippet]);

  // Show success state after creation
  if (createdSnippet) {
    return (
      <Card className="w-full max-w-lg border-zinc-800 bg-zinc-900 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Check className="h-5 w-5 text-emerald-400" />
          <h3 className="font-semibold text-lg text-white">Snippet Created!</h3>
        </div>

        {/* Link */}
        <div className="mb-4">
          <label
            className="mb-1 block text-sm text-zinc-400"
            htmlFor="snippet-share-link"
          >
            Shareable Link
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
              id="snippet-share-link"
              readOnly
              type="text"
              value={createdSnippet.url}
            />
            <Button onClick={handleCopyLink} size="sm" variant="outline">
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Embed code */}
        <div className="mb-4">
          <label
            className="mb-1 block text-sm text-zinc-400"
            htmlFor="snippet-embed-code"
          >
            Embed Code
          </label>
          <textarea
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-300"
            id="snippet-embed-code"
            readOnly
            rows={3}
            value={embedCode}
          />
        </div>

        {/* Metadata */}
        <div className="mb-4 flex gap-2">
          <Badge variant="secondary">
            {visibility === "public" ? (
              <Globe className="mr-1 h-3 w-3" />
            ) : (
              <Lock className="mr-1 h-3 w-3" />
            )}
            {visibility}
          </Badge>
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" />
            {EXPIRATION_LABELS[expiration]}
          </Badge>
          <Badge variant="secondary">
            <Code2 className="mr-1 h-3 w-3" />
            {language}
          </Badge>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => {
              window.open(createdSnippet.url, "_blank", "noopener");
            }}
            size="sm"
            variant="outline"
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            Open
          </Button>
          <Button onClick={onClose} size="sm" variant="ghost">
            Done
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-lg border-zinc-800 bg-zinc-900 p-6">
      <div className="mb-4 flex items-center gap-2">
        <Share2 className="h-5 w-5 text-violet-400" />
        <h3 className="font-semibold text-lg text-white">Share Snippet</h3>
      </div>

      {/* Title */}
      <div className="mb-3">
        <label
          className="mb-1 block text-sm text-zinc-400"
          htmlFor="snippet-title"
        >
          Title
        </label>
        <input
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          id="snippet-title"
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Untitled Snippet"
          type="text"
          value={title}
        />
      </div>

      {/* Code */}
      <div className="mb-3">
        <label
          className="mb-1 block text-sm text-zinc-400"
          htmlFor="snippet-code"
        >
          Code
        </label>
        <textarea
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-300"
          id="snippet-code"
          onChange={(e) => setCode(e.target.value)}
          placeholder="Paste your code here..."
          rows={10}
          value={code}
        />
      </div>

      {/* Language */}
      <div className="mb-3">
        <label
          className="mb-1 block text-sm text-zinc-400"
          htmlFor="snippet-language"
        >
          Language
        </label>
        <select
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
          id="snippet-language"
          onChange={(e) => setLanguage(e.target.value)}
          value={language}
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
      </div>

      {/* Visibility */}
      <div className="mb-3">
        <p className="mb-1 block text-sm text-zinc-400">Visibility</p>
        <div className="flex gap-2">
          <button
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
              visibility === "public"
                ? "border-violet-500 bg-violet-500/10 text-violet-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
            }`}
            onClick={() => setVisibility("public")}
            type="button"
          >
            <Globe className="h-3.5 w-3.5" />
            Public
          </button>
          <button
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
              visibility === "private"
                ? "border-violet-500 bg-violet-500/10 text-violet-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
            }`}
            onClick={() => setVisibility("private")}
            type="button"
          >
            <Lock className="h-3.5 w-3.5" />
            Private
          </button>
        </div>
      </div>

      {/* Expiration */}
      <div className="mb-4">
        <label
          className="mb-1 block text-sm text-zinc-400"
          htmlFor="snippet-expiration"
        >
          Expiration
        </label>
        <select
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
          id="snippet-expiration"
          onChange={(e) => setExpiration(e.target.value as Expiration)}
          value={expiration}
        >
          {(Object.entries(EXPIRATION_LABELS) as [Expiration, string][]).map(
            ([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            )
          )}
        </select>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={!code.trim() || isCreating}
          onClick={handleCreate}
          size="sm"
        >
          <Link2 className="mr-1 h-3 w-3" />
          {isCreating ? "Creating..." : "Create Snippet"}
        </Button>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Snippet Viewer                                                             */
/* -------------------------------------------------------------------------- */

export function SnippetViewer({ snippet }: SnippetViewerProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(snippet.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [snippet.code]);

  const highlighted = useMemo(
    () => highlightCode(snippet.code, snippet.language),
    [snippet.code, snippet.language]
  );

  return (
    <Card className="w-full max-w-2xl border-zinc-800 bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-violet-400" />
          <span className="font-medium text-white">{snippet.title}</span>
          <Badge variant="secondary">{snippet.language}</Badge>
          {snippet.visibility === "private" && (
            <Badge variant="secondary">
              <Lock className="mr-1 h-3 w-3" />
              Private
            </Badge>
          )}
        </div>
        <Button onClick={handleCopy} size="sm" variant="ghost">
          {copied ? (
            <>
              <Check className="mr-1 h-3 w-3" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="mr-1 h-3 w-3" />
              Copy
            </>
          )}
        </Button>
      </div>

      {/* Code block */}
      <div className="overflow-x-auto p-4">
        <pre className="text-sm leading-relaxed">
          <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-zinc-800 border-t px-4 py-2">
        <span className="text-xs text-zinc-500">
          Created {new Date(snippet.createdAt).toLocaleDateString()}
        </span>
        {snippet.expiration !== "never" && (
          <span className="text-xs text-zinc-500">
            Expires: {EXPIRATION_LABELS[snippet.expiration]}
          </span>
        )}
      </div>
    </Card>
  );
}

export { highlightCode, SUPPORTED_LANGUAGES };
