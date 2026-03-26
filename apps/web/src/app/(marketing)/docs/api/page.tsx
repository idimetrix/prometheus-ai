const endpoints = [
  {
    category: "Sessions",
    routes: [
      {
        method: "query",
        name: "sessions.list",
        description: "List all sessions for the current organization.",
      },
      {
        method: "query",
        name: "sessions.get",
        description: "Get a single session by ID with full details.",
      },
      {
        method: "mutation",
        name: "sessions.create",
        description:
          "Create a new session with a task prompt and configuration.",
      },
      {
        method: "mutation",
        name: "sessions.pause",
        description: "Pause a running session.",
      },
      {
        method: "mutation",
        name: "sessions.resume",
        description: "Resume a paused session.",
      },
      {
        method: "mutation",
        name: "sessions.cancel",
        description: "Cancel and terminate a session.",
      },
    ],
  },
  {
    category: "Projects",
    routes: [
      {
        method: "query",
        name: "projects.list",
        description: "List all projects in the organization.",
      },
      {
        method: "query",
        name: "projects.get",
        description: "Get project details including configuration and stats.",
      },
      {
        method: "mutation",
        name: "projects.create",
        description: "Create a new project with repository and tech stack.",
      },
      {
        method: "mutation",
        name: "projects.update",
        description: "Update project settings and configuration.",
      },
      {
        method: "mutation",
        name: "projects.archive",
        description: "Archive a project (soft delete).",
      },
    ],
  },
  {
    category: "Fleet",
    routes: [
      {
        method: "query",
        name: "fleet.status",
        description: "Get real-time status of all running agents.",
      },
      {
        method: "mutation",
        name: "fleet.stop",
        description: "Stop a specific agent in the fleet.",
      },
      {
        method: "mutation",
        name: "fleet.pause",
        description: "Pause a fleet agent.",
      },
      {
        method: "mutation",
        name: "fleet.resume",
        description: "Resume a paused fleet agent.",
      },
    ],
  },
  {
    category: "Brain",
    routes: [
      {
        method: "query",
        name: "brain.graph",
        description: "Get the project knowledge graph with file relationships.",
      },
      {
        method: "query",
        name: "brain.getMemories",
        description: "Retrieve memories filtered by layer and project.",
      },
      {
        method: "query",
        name: "brain.search",
        description: "Semantic search across project memory layers.",
      },
    ],
  },
  {
    category: "Billing",
    routes: [
      {
        method: "query",
        name: "billing.getBalance",
        description: "Get current credit balance and usage stats.",
      },
      {
        method: "mutation",
        name: "billing.createCheckout",
        description: "Create a Stripe checkout session for plan upgrade.",
      },
      {
        method: "mutation",
        name: "billing.purchaseCredits",
        description: "Purchase additional credits.",
      },
    ],
  },
  {
    category: "Settings",
    routes: [
      {
        method: "query",
        name: "settings.get",
        description: "Get organization settings.",
      },
      {
        method: "mutation",
        name: "settings.update",
        description: "Update organization settings.",
      },
    ],
  },
];

export default function ApiReferencePage() {
  return (
    <div className="mx-auto max-w-5xl px-6 py-20">
      <div className="mb-16 text-center">
        <h1 className="mb-4 font-bold text-4xl text-zinc-100 tracking-tight">
          API Reference
        </h1>
        <p className="mx-auto max-w-2xl text-lg text-zinc-400">
          PROMETHEUS uses tRPC for type-safe API communication. All endpoints
          require authentication via Clerk JWT or API key.
        </p>
      </div>

      <div className="mb-10 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
        <h3 className="mb-3 font-semibold text-zinc-200">Base URL</h3>
        <code className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-violet-400">
          https://api.prometheus.dev/trpc
        </code>
        <p className="mt-3 text-sm text-zinc-500">
          All tRPC endpoints are served under the <code>/trpc</code> path.
          Queries use GET, mutations use POST. Include your API key in the{" "}
          <code>Authorization</code> header.
        </p>
      </div>

      {endpoints.map((group) => (
        <div className="mb-10" key={group.category}>
          <h2 className="mb-4 font-semibold text-xl text-zinc-200">
            {group.category}
          </h2>
          <div className="overflow-hidden rounded-xl border border-zinc-800">
            {group.routes.map((route, i) => (
              <div
                className={`flex items-start gap-4 p-4 ${i > 0 ? "border-zinc-800 border-t" : ""}`}
                key={route.name}
              >
                <span
                  className={`mt-0.5 shrink-0 rounded px-2 py-0.5 font-mono text-xs ${
                    route.method === "query"
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-amber-500/10 text-amber-400"
                  }`}
                >
                  {route.method}
                </span>
                <div>
                  <code className="font-medium text-sm text-zinc-200">
                    {route.name}
                  </code>
                  <p className="mt-1 text-sm text-zinc-500">
                    {route.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
