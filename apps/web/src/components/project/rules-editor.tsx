"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const RULE_TYPES = [
  "code_style",
  "architecture",
  "testing",
  "review",
  "prompt",
  "security",
] as const;

type RuleType = (typeof RULE_TYPES)[number];

const TYPE_LABELS: Record<RuleType, string> = {
  code_style: "Code Style",
  architecture: "Architecture",
  testing: "Testing",
  review: "Review",
  prompt: "Prompt",
  security: "Security",
};

const TYPE_COLORS: Record<RuleType, string> = {
  code_style: "bg-blue-500/10 text-blue-400",
  architecture: "bg-purple-500/10 text-purple-400",
  testing: "bg-green-500/10 text-green-400",
  review: "bg-yellow-500/10 text-yellow-400",
  prompt: "bg-pink-500/10 text-pink-400",
  security: "bg-red-500/10 text-red-400",
};

function SourceBadge({ source }: { source: string }) {
  if (source === "auto_detected") {
    return (
      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-[10px] text-amber-400">
        Auto-detected
      </span>
    );
  }
  if (source === "file") {
    return (
      <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 font-medium text-[10px] text-cyan-400">
        File
      </span>
    );
  }
  return <span className="text-xs text-zinc-500">Manual</span>;
}

interface RulesEditorProps {
  projectId: string;
}

export function RulesEditor({ projectId }: RulesEditorProps) {
  const utils = trpc.useUtils();
  const rulesQuery = trpc.projects.rules.list.useQuery({ projectId });
  const createMutation = trpc.projects.rules.create.useMutation({
    onSuccess: () => {
      utils.projects.rules.list.invalidate({ projectId });
      toast.success("Rule created");
    },
    onError: () => toast.error("Failed to create rule"),
  });
  const updateMutation = trpc.projects.rules.update.useMutation({
    onSuccess: () => {
      utils.projects.rules.list.invalidate({ projectId });
      toast.success("Rule updated");
    },
    onError: () => toast.error("Failed to update rule"),
  });
  const deleteMutation = trpc.projects.rules.delete.useMutation({
    onSuccess: () => {
      utils.projects.rules.list.invalidate({ projectId });
      toast.success("Rule deleted");
    },
    onError: () => toast.error("Failed to delete rule"),
  });
  const importMutation = trpc.projects.rules.importFromFile.useMutation({
    onSuccess: (data) => {
      utils.projects.rules.list.invalidate({ projectId });
      toast.success(`Imported ${data.importedCount} rules`);
    },
    onError: () => toast.error("Failed to import rules"),
  });

  const [showAddForm, setShowAddForm] = useState(false);
  const [newType, setNewType] = useState<RuleType>("code_style");
  const [newRule, setNewRule] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const rules = rulesQuery.data?.rules ?? [];

  const handleCreate = useCallback(async () => {
    if (!newRule.trim()) {
      return;
    }
    await createMutation.mutateAsync({
      projectId,
      type: newType,
      rule: newRule.trim(),
    });
    setNewRule("");
    setShowAddForm(false);
  }, [projectId, newType, newRule, createMutation]);

  const handleToggleEnabled = useCallback(
    async (ruleId: string, enabled: boolean) => {
      await updateMutation.mutateAsync({ ruleId, enabled: !enabled });
    },
    [updateMutation]
  );

  const handleSaveEdit = useCallback(
    async (ruleId: string) => {
      if (!editText.trim()) {
        return;
      }
      await updateMutation.mutateAsync({ ruleId, rule: editText.trim() });
      setEditingId(null);
      setEditText("");
    },
    [editText, updateMutation]
  );

  const handleDelete = useCallback(
    async (ruleId: string) => {
      await deleteMutation.mutateAsync({ ruleId });
      setDeleteConfirmId(null);
    },
    [deleteMutation]
  );

  const handleImport = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) {
        return;
      }
      const content = await file.text();
      await importMutation.mutateAsync({ projectId, content });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [projectId, importMutation]
  );

  if (rulesQuery.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg text-zinc-100">Project Rules</h3>
          <p className="text-sm text-zinc-500">
            Configure AI behavior rules for this project
          </p>
        </div>
        <div className="flex gap-2">
          <input
            accept=".json"
            className="hidden"
            onChange={handleImport}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 font-medium text-sm text-zinc-300 hover:bg-zinc-800"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            Import from File
          </button>
          <button
            className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-violet-700"
            onClick={() => setShowAddForm(true)}
            type="button"
          >
            Add Rule
          </button>
        </div>
      </div>

      {/* Add Rule Form */}
      {showAddForm && (
        <div className="rounded-xl border border-zinc-700 bg-zinc-900/80 p-4">
          <div className="flex gap-3">
            <div className="w-40">
              <label
                className="mb-1 block text-xs text-zinc-500"
                htmlFor="rule-type-select"
              >
                Type
              </label>
              <select
                className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-sm text-zinc-200"
                id="rule-type-select"
                onChange={(e) => setNewType(e.target.value as RuleType)}
                value={newType}
              >
                {RULE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label
                className="mb-1 block text-xs text-zinc-500"
                htmlFor="rule-text-input"
              >
                Rule
              </label>
              <textarea
                className="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:border-violet-500 focus:outline-none"
                id="rule-text-input"
                onChange={(e) => setNewRule(e.target.value)}
                placeholder="Describe the rule..."
                rows={2}
                value={newRule}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
              onClick={() => {
                setShowAddForm(false);
                setNewRule("");
              }}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              disabled={!newRule.trim() || createMutation.isPending}
              onClick={handleCreate}
              type="button"
            >
              {createMutation.isPending ? "Creating..." : "Create Rule"}
            </button>
          </div>
        </div>
      )}

      {/* Rules Table */}
      {rules.length === 0 ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-8 text-center text-sm text-zinc-500">
          No rules configured. Add rules to customize AI behavior for this
          project.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-zinc-800">
          <table className="w-full">
            <thead>
              <tr className="border-zinc-800 border-b bg-zinc-900/80">
                <th className="px-4 py-2 text-left font-medium text-xs text-zinc-500">
                  Type
                </th>
                <th className="px-4 py-2 text-left font-medium text-xs text-zinc-500">
                  Rule
                </th>
                <th className="px-4 py-2 text-left font-medium text-xs text-zinc-500">
                  Source
                </th>
                <th className="px-4 py-2 text-center font-medium text-xs text-zinc-500">
                  Enabled
                </th>
                <th className="px-4 py-2 text-right font-medium text-xs text-zinc-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr
                  className="border-zinc-800 border-b transition-colors last:border-0 hover:bg-zinc-900/30"
                  key={rule.id}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 font-medium text-[10px] ${
                        TYPE_COLORS[rule.type as RuleType] ??
                        "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {TYPE_LABELS[rule.type as RuleType] ?? rule.type}
                    </span>
                  </td>
                  <td className="max-w-md px-4 py-3">
                    {editingId === rule.id ? (
                      <div className="flex gap-2">
                        <input
                          className="flex-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              handleSaveEdit(rule.id);
                            }
                            if (e.key === "Escape") {
                              setEditingId(null);
                            }
                          }}
                          value={editText}
                        />
                        <button
                          className="rounded bg-violet-600 px-2 py-1 text-white text-xs"
                          onClick={() => handleSaveEdit(rule.id)}
                          type="button"
                        >
                          Save
                        </button>
                        <button
                          className="rounded px-2 py-1 text-xs text-zinc-400"
                          onClick={() => setEditingId(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className="line-clamp-2 text-sm text-zinc-300">
                        {rule.rule}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <SourceBadge source={rule.source} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      className={`h-5 w-9 rounded-full transition-colors ${
                        rule.enabled ? "bg-violet-600" : "bg-zinc-700"
                      }`}
                      onClick={() => handleToggleEnabled(rule.id, rule.enabled)}
                      type="button"
                    >
                      <div
                        className={`h-4 w-4 rounded-full bg-white transition-transform ${
                          rule.enabled ? "translate-x-4" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                        onClick={() => {
                          setEditingId(rule.id);
                          setEditText(rule.rule);
                        }}
                        title="Edit"
                        type="button"
                      >
                        <svg
                          aria-hidden="true"
                          className="h-3.5 w-3.5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          viewBox="0 0 24 24"
                        >
                          <path
                            d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      {deleteConfirmId === rule.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            className="rounded bg-red-600 px-2 py-0.5 text-[10px] text-white"
                            onClick={() => handleDelete(rule.id)}
                            type="button"
                          >
                            Confirm
                          </button>
                          <button
                            className="rounded px-2 py-0.5 text-[10px] text-zinc-400"
                            onClick={() => setDeleteConfirmId(null)}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-red-400"
                          onClick={() => setDeleteConfirmId(rule.id)}
                          title="Delete"
                          type="button"
                        >
                          <svg
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            viewBox="0 0 24 24"
                          >
                            <path
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
