"use client";

import { Badge, Button, Card } from "@prometheus/ui";
import {
  Bot,
  Check,
  ChevronDown,
  Cpu,
  MessageSquare,
  Save,
  Send,
  Share2,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface ToolOption {
  category: string;
  description: string;
  id: string;
  name: string;
}

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface CustomAgent {
  description: string;
  id: string;
  isShared: boolean;
  modelPreference: string;
  name: string;
  systemPrompt: string;
  tools: string[];
}

interface AgentBuilderProps {
  /** Existing agent to edit (if provided) */
  agent?: CustomAgent;
  /** Called when the dialog is closed */
  onClose?: () => void;
  /** Called when the agent is saved */
  onSave?: (agent: CustomAgent) => void;
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const AVAILABLE_TOOLS: ToolOption[] = [
  {
    id: "file_read",
    name: "File Read",
    description: "Read files from the project",
    category: "Files",
  },
  {
    id: "file_write",
    name: "File Write",
    description: "Create or modify files",
    category: "Files",
  },
  {
    id: "file_search",
    name: "File Search",
    description: "Search for files by pattern",
    category: "Files",
  },
  {
    id: "terminal_exec",
    name: "Terminal",
    description: "Execute shell commands",
    category: "System",
  },
  {
    id: "browser_navigate",
    name: "Browser",
    description: "Navigate to URLs and interact with pages",
    category: "System",
  },
  {
    id: "code_search",
    name: "Code Search",
    description: "Search code with regex patterns",
    category: "Code",
  },
  {
    id: "code_analysis",
    name: "Code Analysis",
    description: "Analyze code quality and patterns",
    category: "Code",
  },
  {
    id: "git_commit",
    name: "Git Commit",
    description: "Stage and commit changes",
    category: "Git",
  },
  {
    id: "git_push",
    name: "Git Push",
    description: "Push commits to remote",
    category: "Git",
  },
  {
    id: "test_run",
    name: "Test Runner",
    description: "Run test suites",
    category: "Testing",
  },
  {
    id: "deploy",
    name: "Deploy",
    description: "Deploy to environments",
    category: "DevOps",
  },
  {
    id: "database_query",
    name: "Database Query",
    description: "Execute database queries",
    category: "Data",
  },
  {
    id: "api_request",
    name: "API Request",
    description: "Make HTTP requests to APIs",
    category: "Network",
  },
];

const AVAILABLE_MODELS: ModelOption[] = [
  {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "Anthropic",
  },
  {
    id: "claude-opus-4-20250514",
    name: "Claude Opus 4",
    provider: "Anthropic",
  },
  { id: "gpt-4o", name: "GPT-4o", provider: "OpenAI" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" },
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash",
    provider: "Google",
  },
  { id: "deepseek-v3", name: "DeepSeek V3", provider: "DeepSeek" },
];

const TEMPLATE_VARIABLES = [
  { name: "{{project_name}}", description: "Current project name" },
  { name: "{{tech_stack}}", description: "Detected tech stack" },
  { name: "{{file_tree}}", description: "Project file tree" },
  { name: "{{conventions}}", description: "Coding conventions" },
  { name: "{{user_name}}", description: "Current user name" },
];

/* -------------------------------------------------------------------------- */
/*  Test Chat Component                                                        */
/* -------------------------------------------------------------------------- */

interface TestChatProps {
  agentName: string;
  model: string;
  systemPrompt: string;
  tools: string[];
}

function TestChat({ agentName, systemPrompt, tools, model }: TestChatProps) {
  const [messages, setMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [input, setInput] = useState("");

  const handleSend = useCallback(() => {
    if (!input.trim()) {
      return;
    }

    const userMsg = { role: "user" as const, content: input };
    const assistantMsg = {
      role: "assistant" as const,
      content: `[Test mode - ${agentName}] I would process "${input.slice(0, 80)}" using model ${model} with ${tools.length} tools. System prompt length: ${systemPrompt.length} chars.`,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
  }, [input, agentName, model, tools.length, systemPrompt.length]);

  return (
    <div className="flex h-64 flex-col rounded-lg border border-zinc-700 bg-zinc-900">
      <div className="flex items-center gap-2 border-zinc-700 border-b px-3 py-2">
        <MessageSquare className="h-4 w-4 text-violet-400" />
        <span className="font-medium text-sm text-white">Test Chat</span>
        <Badge className="text-xs" variant="secondary">
          Preview
        </Badge>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-center text-sm text-zinc-500">
            Send a test message to see how your agent responds.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            className={`mb-2 rounded-lg px-3 py-2 text-sm ${
              msg.role === "user"
                ? "ml-8 bg-violet-500/10 text-violet-300"
                : "mr-8 bg-zinc-800 text-zinc-300"
            }`}
            key={`msg-${i.toString()}`}
          >
            {msg.content}
          </div>
        ))}
      </div>

      <div className="flex gap-2 border-zinc-700 border-t p-2">
        <input
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              handleSend();
            }
          }}
          placeholder="Type a test message..."
          type="text"
          value={input}
        />
        <Button disabled={!input.trim()} onClick={handleSend} size="sm">
          <Send className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function AgentBuilder({ agent, onSave, onClose }: AgentBuilderProps) {
  const [name, setName] = useState(agent?.name ?? "");
  const [description, setDescription] = useState(agent?.description ?? "");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [selectedTools, setSelectedTools] = useState<Set<string>>(
    new Set(agent?.tools ?? [])
  );
  const [modelPreference, setModelPreference] = useState(
    agent?.modelPreference ?? "claude-sonnet-4-20250514"
  );
  const [isShared, setIsShared] = useState(agent?.isShared ?? false);
  const [showTestChat, setShowTestChat] = useState(false);
  const [showTemplateVars, setShowTemplateVars] = useState(false);

  const toolCategories = useMemo(() => {
    const cats = new Map<string, ToolOption[]>();
    for (const tool of AVAILABLE_TOOLS) {
      const existing = cats.get(tool.category) ?? [];
      existing.push(tool);
      cats.set(tool.category, existing);
    }
    return cats;
  }, []);

  const toggleTool = useCallback((toolId: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolId)) {
        next.delete(toolId);
      } else {
        next.add(toolId);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    if (!(name.trim() && systemPrompt.trim())) {
      return;
    }

    const saved: CustomAgent = {
      id: agent?.id ?? `agent_${Date.now().toString(36)}`,
      name,
      description,
      systemPrompt,
      tools: [...selectedTools],
      modelPreference,
      isShared,
    };

    onSave?.(saved);
  }, [
    name,
    description,
    systemPrompt,
    selectedTools,
    modelPreference,
    isShared,
    agent?.id,
    onSave,
  ]);

  const isValid = name.trim().length > 0 && systemPrompt.trim().length > 0;

  return (
    <Card className="w-full max-w-2xl border-zinc-800 bg-zinc-900">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-6 py-4">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-violet-400" />
          <h2 className="font-semibold text-lg text-white">
            {agent ? "Edit Agent" : "Create Custom Agent"}
          </h2>
        </div>
        <button
          aria-label="Close"
          className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
          onClick={onClose}
          type="button"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="max-h-[70vh] overflow-y-auto p-6">
        {/* Name */}
        <div className="mb-4">
          <label
            className="mb-1 block font-medium text-sm text-zinc-300"
            htmlFor="agent-name"
          >
            Name *
          </label>
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
            id="agent-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Code Reviewer, Test Writer, API Builder"
            type="text"
            value={name}
          />
        </div>

        {/* Description */}
        <div className="mb-4">
          <label
            className="mb-1 block font-medium text-sm text-zinc-300"
            htmlFor="agent-description"
          >
            Description
          </label>
          <input
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
            id="agent-description"
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this agent specialize in?"
            type="text"
            value={description}
          />
        </div>

        {/* System Prompt */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <label
              className="font-medium text-sm text-zinc-300"
              htmlFor="agent-system-prompt"
            >
              System Prompt *
            </label>
            <button
              className="flex items-center gap-1 text-violet-400 text-xs hover:text-violet-300"
              onClick={() => setShowTemplateVars(!showTemplateVars)}
              type="button"
            >
              Template Variables
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showTemplateVars ? "rotate-180" : ""}`}
              />
            </button>
          </div>
          {showTemplateVars && (
            <div className="mb-2 rounded-lg border border-zinc-700 bg-zinc-800/50 p-3">
              <p className="mb-2 text-xs text-zinc-400">
                Available template variables:
              </p>
              {TEMPLATE_VARIABLES.map((v) => (
                <div className="flex items-center gap-2 py-0.5" key={v.name}>
                  <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-violet-300 text-xs">
                    {v.name}
                  </code>
                  <span className="text-xs text-zinc-500">{v.description}</span>
                </div>
              ))}
            </div>
          )}
          <textarea
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 font-mono text-sm text-zinc-300 placeholder:text-zinc-600"
            id="agent-system-prompt"
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="You are a specialized agent that..."
            rows={8}
            value={systemPrompt}
          />
          <p className="mt-1 text-xs text-zinc-500">
            {systemPrompt.length.toLocaleString()} / 10,000 characters
          </p>
        </div>

        {/* Tool Selection */}
        <div className="mb-4">
          <p className="mb-2 block font-medium text-sm text-zinc-300">
            <Wrench className="mr-1 mb-0.5 inline h-4 w-4" />
            Tools ({selectedTools.size} selected)
          </p>
          <div className="space-y-3">
            {[...toolCategories.entries()].map(([category, tools]) => (
              <div key={category}>
                <p className="mb-1 font-medium text-xs text-zinc-500 uppercase">
                  {category}
                </p>
                <div className="flex flex-wrap gap-2">
                  {tools.map((tool) => (
                    <button
                      className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        selectedTools.has(tool.id)
                          ? "border-violet-500 bg-violet-500/10 text-violet-300"
                          : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                      }`}
                      key={tool.id}
                      onClick={() => toggleTool(tool.id)}
                      title={tool.description}
                      type="button"
                    >
                      {selectedTools.has(tool.id) && (
                        <Check className="mr-1 inline h-3 w-3" />
                      )}
                      {tool.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Model Preference */}
        <div className="mb-4">
          <label
            className="mb-1 block font-medium text-sm text-zinc-300"
            htmlFor="agent-model"
          >
            <Cpu className="mr-1 mb-0.5 inline h-4 w-4" />
            Model Preference
          </label>
          <select
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-white"
            id="agent-model"
            onChange={(e) => setModelPreference(e.target.value)}
            value={modelPreference}
          >
            {AVAILABLE_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name} ({model.provider})
              </option>
            ))}
          </select>
        </div>

        {/* Share with team */}
        <div className="mb-4 flex items-center gap-3">
          <button
            aria-checked={isShared}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              isShared ? "bg-violet-500" : "bg-zinc-700"
            }`}
            onClick={() => setIsShared(!isShared)}
            role="switch"
            type="button"
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                isShared ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
          <div>
            <span className="text-sm text-zinc-300">
              <Share2 className="mr-1 mb-0.5 inline h-3.5 w-3.5" />
              Share with team
            </span>
            <p className="text-xs text-zinc-500">
              Team members can use this agent in their projects
            </p>
          </div>
        </div>

        {/* Test Chat */}
        <div className="mb-4">
          <Button
            className="mb-2"
            onClick={() => setShowTestChat(!showTestChat)}
            size="sm"
            variant="outline"
          >
            <MessageSquare className="mr-1 h-3 w-3" />
            {showTestChat ? "Hide Test Chat" : "Test Agent"}
          </Button>
          {showTestChat && (
            <TestChat
              agentName={name || "Unnamed Agent"}
              model={modelPreference}
              systemPrompt={systemPrompt}
              tools={[...selectedTools]}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-zinc-800 border-t px-6 py-4">
        <Button onClick={onClose} size="sm" variant="ghost">
          Cancel
        </Button>
        <div className="flex gap-2">
          {agent && (
            <Button className="text-red-400" size="sm" variant="outline">
              <Trash2 className="mr-1 h-3 w-3" />
              Delete
            </Button>
          )}
          <Button disabled={!isValid} onClick={handleSave} size="sm">
            <Save className="mr-1 h-3 w-3" />
            {agent ? "Update Agent" : "Create Agent"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
