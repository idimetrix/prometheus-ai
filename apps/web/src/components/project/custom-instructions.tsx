"use client";

import { cn } from "@prometheus/ui";
import { Check, ChevronDown, FileText, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ── Types ───────────────────────────────────────────────────────

interface CustomInstructionsProps {
  className?: string;
  projectId: string;
}

// ── Constants ───────────────────────────────────────────────────

const MAX_CHARS = 4000;
const WARN_CHARS = 3500;
const DEBOUNCE_MS = 1500;

function getCharCountColor(isAtLimit: boolean, isNearLimit: boolean): string {
  if (isAtLimit) {
    return "text-red-400";
  }
  if (isNearLimit) {
    return "text-yellow-400";
  }
  return "text-zinc-600";
}

interface InstructionTemplate {
  content: string;
  id: string;
  label: string;
}

const TEMPLATES: InstructionTemplate[] = [
  {
    id: "typescript-strict",
    label: "Always use TypeScript",
    content: `Always use TypeScript with strict mode enabled.
- Prefer explicit types over \`any\`
- Use interfaces for object shapes
- Use type guards for narrowing
- Prefer const assertions for literal types`,
  },
  {
    id: "rest-conventions",
    label: "Follow REST conventions",
    content: `Follow RESTful API conventions:
- Use standard HTTP methods (GET, POST, PUT, DELETE)
- Use plural nouns for resource endpoints
- Return appropriate status codes
- Include pagination for list endpoints
- Use consistent error response format`,
  },
  {
    id: "testing-first",
    label: "Testing first approach",
    content: `Write tests before or alongside implementation:
- Unit tests for all business logic
- Integration tests for API endpoints
- Use descriptive test names
- Aim for high coverage on critical paths
- Use factories/fixtures for test data`,
  },
  {
    id: "clean-code",
    label: "Clean code practices",
    content: `Follow clean code practices:
- Functions should do one thing
- Use meaningful variable and function names
- Keep functions under 20 lines when possible
- Prefer composition over inheritance
- Extract complex conditions into named booleans
- Use early returns to reduce nesting`,
  },
  {
    id: "security-first",
    label: "Security first",
    content: `Prioritize security in all code:
- Validate all user inputs with Zod schemas
- Sanitize data before rendering
- Use parameterized queries (never raw SQL)
- Apply principle of least privilege
- Never log sensitive data
- Use HTTPS for all external calls`,
  },
  {
    id: "react-patterns",
    label: "React best practices",
    content: `Follow React best practices:
- Use functional components with hooks
- Memoize expensive computations with useMemo
- Use useCallback for event handlers passed as props
- Keep components focused and composable
- Use error boundaries for graceful failures
- Prefer server components where possible`,
  },
];

// ── Main component ──────────────────────────────────────────────

export function CustomInstructions({
  projectId,
  className,
}: CustomInstructionsProps) {
  const [instructions, setInstructions] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Query for existing custom instructions
  const instructionsQuery = trpc.projects.rules.list.useQuery({ projectId });
  const updateMutation = trpc.projects.rules.create.useMutation();

  // Load existing instructions (from "prompt" type rules)
  useEffect(() => {
    if (instructionsQuery.data?.rules) {
      const promptRules = instructionsQuery.data.rules
        .filter((r) => r.type === "prompt" && r.enabled)
        .map((r) => r.rule);
      if (promptRules.length > 0) {
        setInstructions(promptRules.join("\n\n"));
      }
    }
  }, [instructionsQuery.data]);

  const saveInstructions = useCallback(
    async (text: string) => {
      if (!text.trim()) {
        return;
      }
      setIsSaving(true);
      try {
        await updateMutation.mutateAsync({
          projectId,
          type: "prompt",
          rule: text.trim(),
        });
        setLastSaved(new Date());
      } catch {
        toast.error("Failed to save custom instructions");
      } finally {
        setIsSaving(false);
      }
    },
    [projectId, updateMutation]
  );

  // Debounced auto-save
  const handleChange = useCallback(
    (value: string) => {
      if (value.length > MAX_CHARS) {
        return;
      }
      setInstructions(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        saveInstructions(value);
      }, DEBOUNCE_MS);
    },
    [saveInstructions]
  );

  // Save on blur
  const handleBlur = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    saveInstructions(instructions);
  }, [instructions, saveInstructions]);

  // Apply a template
  const handleApplyTemplate = useCallback(
    (template: InstructionTemplate) => {
      const newContent = instructions
        ? `${instructions}\n\n${template.content}`
        : template.content;

      if (newContent.length > MAX_CHARS) {
        toast.error("Adding this template would exceed the character limit");
        return;
      }

      setInstructions(newContent);
      setShowTemplates(false);
      saveInstructions(newContent);
      textareaRef.current?.focus();
    },
    [instructions, saveInstructions]
  );

  const charCount = instructions.length;
  const isNearLimit = charCount >= WARN_CHARS;
  const isAtLimit = charCount >= MAX_CHARS;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-lg text-zinc-100">
            Custom Instructions
          </h3>
          <p className="text-sm text-zinc-500">
            These instructions are injected into every agent&apos;s system
            prompt for this project. Supports markdown formatting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastSaved && (
            <span className="flex items-center gap-1 text-[10px] text-green-400">
              <Check className="h-3 w-3" />
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          {isSaving && (
            <span className="text-[10px] text-zinc-500">Saving...</span>
          )}
        </div>
      </div>

      {/* Templates dropdown */}
      <div className="relative">
        <button
          className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          onClick={() => setShowTemplates(!showTemplates)}
          type="button"
        >
          <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          Insert template
          <ChevronDown className="h-3 w-3 text-zinc-500" />
        </button>

        {showTemplates && (
          <div className="absolute top-full left-0 z-50 mt-1 w-80 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl">
            {TEMPLATES.map((template) => (
              <button
                className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-zinc-800"
                key={template.id}
                onClick={() => handleApplyTemplate(template)}
                type="button"
              >
                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <div>
                  <div className="text-xs text-zinc-300">{template.label}</div>
                  <div className="mt-0.5 line-clamp-2 text-[10px] text-zinc-600">
                    {template.content}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Textarea */}
      <div className="relative">
        <textarea
          className={cn(
            "w-full resize-y rounded-xl border bg-zinc-900/80 px-4 py-3 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none",
            isAtLimit
              ? "border-red-500/50 focus:border-red-500"
              : "border-zinc-700 focus:border-violet-500"
          )}
          onBlur={handleBlur}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={`Enter custom instructions for AI agents...

Example:
- Always use TypeScript with strict types
- Follow the existing code patterns in the codebase
- Write tests for all new functionality
- Use descriptive variable names`}
          ref={textareaRef}
          rows={10}
          value={instructions}
        />

        {/* Character count */}
        <div className="mt-1 flex justify-end">
          <span
            className={cn(
              "text-[10px] tabular-nums",
              getCharCountColor(isAtLimit, isNearLimit)
            )}
          >
            {charCount} / {MAX_CHARS}
          </span>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/30 px-4 py-3">
        <div className="flex items-start gap-2">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
          <div className="text-xs text-zinc-500">
            <p>
              Custom instructions are prepended to every agent conversation in
              this project. Use them to enforce coding standards, architectural
              patterns, or project-specific conventions.
            </p>
            <p className="mt-1">
              Changes auto-save after {DEBOUNCE_MS / 1000} seconds of inactivity
              or when you click away.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
