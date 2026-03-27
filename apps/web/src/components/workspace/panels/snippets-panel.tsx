"use client";

import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@prometheus/ui";
import {
  Check,
  ClipboardCopy,
  Code2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Snippet {
  code: string;
  createdAt: string;
  id: string;
  language: string;
  name: string;
}

interface SnippetsPanelProps {
  className?: string;
  onSave?: (snippet: { code: string; language: string; name: string }) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LANGUAGE_COLORS: Record<string, string> = {
  typescript: "bg-blue-500/20 text-blue-400",
  javascript: "bg-yellow-500/20 text-yellow-400",
  python: "bg-green-500/20 text-green-400",
  rust: "bg-orange-500/20 text-orange-400",
  go: "bg-cyan-500/20 text-cyan-400",
  sql: "bg-violet-500/20 text-violet-400",
  bash: "bg-zinc-500/20 text-zinc-300",
  css: "bg-pink-500/20 text-pink-400",
};

const LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "rust",
  "go",
  "sql",
  "bash",
  "css",
];

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_SNIPPETS: Snippet[] = [
  {
    id: "snip_001",
    name: "tRPC Protected Procedure",
    language: "typescript",
    code: `export const myRouter = router({
  myEndpoint: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input, ctx }) => {
      return ctx.db.query.items.findFirst({
        where: eq(items.id, input.id),
      });
    }),
});`,
    createdAt: "2026-03-20T10:00:00Z",
  },
  {
    id: "snip_002",
    name: "React Query Hook",
    language: "typescript",
    code: `export function useProject(id: string) {
  return trpc.projects.get.useQuery(
    { projectId: id },
    { enabled: Boolean(id) }
  );
}`,
    createdAt: "2026-03-19T15:30:00Z",
  },
  {
    id: "snip_003",
    name: "Python FastAPI Endpoint",
    language: "python",
    code: `@router.get("/items/{item_id}")
async def get_item(
    item_id: str,
    db: AsyncSession = Depends(get_db),
) -> ItemResponse:
    item = await db.get(Item, item_id)
    if not item:
        raise HTTPException(status_code=404)
    return ItemResponse.model_validate(item)`,
    createdAt: "2026-03-18T09:00:00Z",
  },
  {
    id: "snip_004",
    name: "Drizzle Migration Helper",
    language: "sql",
    code: `ALTER TABLE projects
  ADD COLUMN branch_strategy TEXT NOT NULL DEFAULT 'trunk',
  ADD COLUMN deploy_on_merge BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX idx_projects_branch_strategy
  ON projects (branch_strategy);`,
    createdAt: "2026-03-17T14:00:00Z",
  },
  {
    id: "snip_005",
    name: "Docker Multi-stage Build",
    language: "bash",
    code: `FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
CMD ["node", "dist/index.js"]`,
    createdAt: "2026-03-16T11:00:00Z",
  },
  {
    id: "snip_006",
    name: "Zod Validation Schema",
    language: "typescript",
    code: `export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  repoUrl: z.string().url().optional(),
  framework: z.enum(["next", "remix", "astro", "vite"]),
  visibility: z.enum(["public", "private"]).default("private"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;`,
    createdAt: "2026-03-15T08:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPreview(code: string, maxLines = 3): string {
  const lines = code.split("\n");
  const preview = lines.slice(0, maxLines).join("\n");
  if (lines.length > maxLines) {
    return `${preview}\n...`;
  }
  return preview;
}

function getLangColor(lang: string): string {
  return LANGUAGE_COLORS[lang] ?? "bg-zinc-500/20 text-zinc-300";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SnippetsPanel({ className, onSave }: SnippetsPanelProps) {
  const [snippets, setSnippets] = useState<Snippet[]>(MOCK_SNIPPETS);
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New snippet form state
  const [newName, setNewName] = useState("");
  const [newLanguage, setNewLanguage] = useState("typescript");
  const [newCode, setNewCode] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) {
      return snippets;
    }
    const q = searchQuery.toLowerCase();
    return snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.language.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q)
    );
  }, [snippets, searchQuery]);

  const handleCopy = useCallback((snippet: Snippet) => {
    navigator.clipboard.writeText(snippet.code).catch(() => {
      // Silently fail if clipboard not available
    });
    setCopiedId(snippet.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const handleDelete = useCallback((id: string) => {
    setSnippets((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleSave = useCallback(() => {
    if (!(newName.trim() && newCode.trim())) {
      return;
    }

    const snippet: Snippet = {
      id: `snip_${Date.now()}`,
      name: newName.trim(),
      language: newLanguage,
      code: newCode,
      createdAt: new Date().toISOString(),
    };

    setSnippets((prev) => [snippet, ...prev]);
    onSave?.({
      name: snippet.name,
      language: snippet.language,
      code: snippet.code,
    });

    // Reset form
    setNewName("");
    setNewLanguage("typescript");
    setNewCode("");
    setDialogOpen(false);
  }, [newName, newLanguage, newCode, onSave]);

  return (
    <Card
      className={`flex flex-col border-zinc-800 bg-zinc-950 ${className ?? ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-violet-400" />
          <h3 className="font-medium text-sm text-zinc-200">Snippets</h3>
          <Badge className="bg-zinc-800 text-zinc-400" variant="secondary">
            {snippets.length}
          </Badge>
        </div>
        <Button
          className="h-7 text-xs"
          onClick={() => setDialogOpen(true)}
          size="sm"
          variant="ghost"
        >
          <Plus className="mr-1 h-3 w-3" />
          Save Snippet
        </Button>
      </div>

      {/* Search */}
      <div className="border-zinc-800 border-b px-3 py-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <Input
            className="h-8 border-zinc-800 bg-zinc-900 pl-8 text-xs"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search snippets..."
            value={searchQuery}
          />
        </div>
      </div>

      {/* Snippet list */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-zinc-600">
              {searchQuery
                ? "No snippets match your search"
                : "No snippets saved yet"}
            </div>
          ) : (
            filtered.map((snippet) => (
              <div
                className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 transition-colors hover:border-zinc-700"
                key={snippet.id}
              >
                {/* Name + language */}
                <div className="mb-2 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-xs text-zinc-300">
                    {snippet.name}
                  </span>
                  <Badge
                    className={getLangColor(snippet.language)}
                    variant="secondary"
                  >
                    {snippet.language}
                  </Badge>
                </div>

                {/* Preview */}
                <pre className="mb-2 overflow-hidden rounded border border-zinc-800/50 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400 leading-relaxed">
                  {getPreview(snippet.code)}
                </pre>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <Button
                    className="h-6 text-[10px]"
                    onClick={() => handleCopy(snippet)}
                    size="sm"
                    variant="ghost"
                  >
                    {copiedId === snippet.id ? (
                      <Check className="mr-1 h-2.5 w-2.5 text-green-400" />
                    ) : (
                      <ClipboardCopy className="mr-1 h-2.5 w-2.5" />
                    )}
                    {copiedId === snippet.id ? "Copied" : "Copy"}
                  </Button>
                  <Button
                    className="h-6 text-[10px] text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(snippet.id)}
                    size="sm"
                    variant="ghost"
                  >
                    <Trash2 className="mr-1 h-2.5 w-2.5" />
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Save Snippet Dialog */}
      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="border-zinc-800 bg-zinc-950">
          <DialogHeader>
            <DialogTitle>Save New Snippet</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div>
              <label
                className="mb-1.5 block text-xs text-zinc-400"
                htmlFor="snippet-name"
              >
                Name
              </label>
              <Input
                className="border-zinc-800 bg-zinc-900"
                id="snippet-name"
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., API Route Template"
                value={newName}
              />
            </div>

            <div>
              <label
                className="mb-1.5 block text-xs text-zinc-400"
                htmlFor="snippet-language"
              >
                Language
              </label>
              <Select onValueChange={setNewLanguage} value={newLanguage}>
                <SelectTrigger
                  className="border-zinc-800 bg-zinc-900"
                  id="snippet-language"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((lang) => (
                    <SelectItem key={lang} value={lang}>
                      {lang}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label
                className="mb-1.5 block text-xs text-zinc-400"
                htmlFor="snippet-code"
              >
                Code
              </label>
              <Textarea
                className="min-h-[160px] border-zinc-800 bg-zinc-900 font-mono text-xs"
                id="snippet-code"
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="Paste your code here..."
                value={newCode}
              />
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={!(newName.trim() && newCode.trim())}
              onClick={handleSave}
            >
              Save Snippet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
