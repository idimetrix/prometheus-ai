"use client";

import { use, useState } from "react";
import { trpc } from "@/lib/trpc";

const MEMORY_TYPES = [
  { id: "all", label: "All" },
  { id: "semantic", label: "Semantic" },
  { id: "episodic", label: "Episodic" },
  { id: "procedural", label: "Procedural" },
  { id: "architectural", label: "Architectural" },
  { id: "convention", label: "Convention" },
] as const;

export default function BrainPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);
  const [searchQuery, setSearchQuery] = useState("");
  const [chatMessages, setChatMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string }>
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [activeTab, setActiveTab] = useState<"graph" | "ask" | "memory">("graph");
  const [memoryFilter, setMemoryFilter] = useState<string>("all");

  const graphQuery = trpc.brain.graph.useQuery(
    { projectId, query: searchQuery || undefined },
    { retry: false },
  );
  const memoriesQuery = trpc.brain.getMemories.useQuery(
    {
      projectId,
      type: memoryFilter === "all" ? undefined : memoryFilter as "semantic" | "episodic" | "procedural" | "architectural" | "convention",
      limit: 50,
    },
    { retry: false },
  );
  const searchMutation = trpc.brain.search.useQuery(
    { projectId, query: searchQuery, limit: 20 },
    { enabled: searchQuery.length > 2, retry: false },
  );

  const nodes = graphQuery.data?.nodes ?? [];
  const memories = memoriesQuery.data?.memories ?? [];

  function handleAsk() {
    if (!chatInput.trim()) return;
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: chatInput.trim() },
    ]);
    // Simulate assistant response (would use brain.search in production)
    const query = chatInput.trim();
    setChatInput("");
    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Searching project brain for: "${query}"... This would query the vector database and return relevant code context.`,
        },
      ]);
    }, 500);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Project Brain</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Explore what the AI knows about your codebase
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search codebase..."
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500"
          />
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900/50 p-1">
        {(["graph", "ask", "memory"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab === "graph"
              ? "File Graph"
              : tab === "ask"
                ? "Ask"
                : "Memory Browser"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "graph" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          <div className="border-b border-zinc-800 px-4 py-3">
            <span className="text-sm font-medium text-zinc-300">
              File Dependency Graph
            </span>
            <span className="ml-2 text-xs text-zinc-500">
              {nodes.length} files indexed
            </span>
          </div>
          <div className="p-4">
            {nodes.length === 0 ? (
              <div className="py-12 text-center text-sm text-zinc-500">
                No files indexed yet. Run a task to populate the project brain.
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {nodes.map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2"
                  >
                    <svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                    </svg>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-xs text-zinc-300">
                        {node.label}
                      </div>
                      <div className="truncate text-[10px] text-zinc-600">
                        {node.id}
                      </div>
                    </div>
                    <span className="shrink-0 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                      {node.chunks} chunks
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Search results */}
            {searchQuery.length > 2 && searchMutation.data && (
              <div className="mt-4 border-t border-zinc-800 pt-4">
                <h3 className="mb-2 text-sm font-medium text-zinc-300">
                  Search Results
                </h3>
                <div className="space-y-2">
                  {searchMutation.data.results.map((result) => (
                    <div
                      key={result.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"
                    >
                      <div className="font-mono text-xs text-violet-400">
                        {result.filePath}
                      </div>
                      <pre className="mt-2 overflow-auto text-[11px] text-zinc-400">
                        {result.content.slice(0, 300)}
                        {result.content.length > 300 ? "..." : ""}
                      </pre>
                    </div>
                  ))}
                  {searchMutation.data.results.length === 0 && (
                    <div className="text-sm text-zinc-500">
                      No results found for &quot;{searchQuery}&quot;
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "ask" && (
        <div className="flex h-[60vh] flex-col rounded-xl border border-zinc-800 bg-zinc-900/50">
          {/* Chat messages */}
          <div className="flex-1 overflow-auto p-4">
            {chatMessages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <svg className="h-10 w-10 text-zinc-700" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                </svg>
                <p className="mt-3 text-sm text-zinc-400">
                  Ask questions about your codebase
                </p>
                <p className="mt-1 text-xs text-zinc-600">
                  e.g. &quot;How is authentication handled?&quot; or &quot;What does the
                  payment flow look like?&quot;
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {chatMessages.map((msg, i) => (
                  <div
                    key={i}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-xl px-4 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-violet-600 text-white"
                          : "border border-zinc-800 bg-zinc-950 text-zinc-300"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Chat input */}
          <div className="border-t border-zinc-800 p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                placeholder="Ask about your codebase..."
                className="flex-1 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet-500"
              />
              <button
                onClick={handleAsk}
                disabled={!chatInput.trim()}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "memory" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50">
          {/* Memory type filter */}
          <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
            {MEMORY_TYPES.map((mt) => (
              <button
                key={mt.id}
                onClick={() => setMemoryFilter(mt.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  memoryFilter === mt.id
                    ? "bg-violet-500/20 text-violet-400"
                    : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                }`}
              >
                {mt.label}
              </button>
            ))}
          </div>

          {/* Memory list */}
          <div className="divide-y divide-zinc-800">
            {memories.length === 0 ? (
              <div className="p-8 text-center text-sm text-zinc-500">
                No memories stored yet. The agent learns as it works on your project.
              </div>
            ) : (
              memories.map((memory) => (
                <div key={memory.id} className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        memory.memoryType === "semantic"
                          ? "bg-blue-500/10 text-blue-400"
                          : memory.memoryType === "episodic"
                            ? "bg-green-500/10 text-green-400"
                            : memory.memoryType === "procedural"
                              ? "bg-yellow-500/10 text-yellow-400"
                              : memory.memoryType === "architectural"
                                ? "bg-violet-500/10 text-violet-400"
                                : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {memory.memoryType}
                    </span>
                    <span className="text-[10px] text-zinc-600">
                      {new Date(memory.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-zinc-300 line-clamp-3">
                    {memory.content}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
