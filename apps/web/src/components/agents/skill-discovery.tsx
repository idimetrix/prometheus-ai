"use client";

import { Badge, Button, Card } from "@prometheus/ui";
import {
  Bot,
  Code2,
  Database,
  Globe,
  Layers,
  MessageSquare,
  Search,
  Shield,
  TestTube,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useMemo, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface AgentCapabilities {
  accuracy: number;
  codeQuality: number;
  creativity: number;
  speed: number;
}

interface AgentDefinition {
  capabilities: AgentCapabilities;
  description: string;
  icon: ComponentType<{ className?: string }>;
  id: string;
  name: string;
  recommendedFor: string[];
  role: string;
}

interface SkillDiscoveryProps {
  onAskAgent?: (agentId: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Agent Registry                                                             */
/* -------------------------------------------------------------------------- */

const AGENTS: AgentDefinition[] = [
  {
    id: "coder",
    name: "Coder",
    role: "code_generation",
    icon: Code2,
    description:
      "Writes production-quality code across languages and frameworks. Excels at implementing features, refactoring, and code transformations.",
    capabilities: { speed: 85, accuracy: 90, codeQuality: 95, creativity: 70 },
    recommendedFor: [
      "Feature implementation",
      "Code refactoring",
      "API development",
    ],
  },
  {
    id: "debugger",
    name: "Debugger",
    role: "debugging",
    icon: Search,
    description:
      "Tracks down bugs by analyzing stack traces, logs, and code paths. Systematic approach to root cause analysis.",
    capabilities: { speed: 70, accuracy: 95, codeQuality: 80, creativity: 60 },
    recommendedFor: [
      "Bug investigation",
      "Error resolution",
      "Performance issues",
    ],
  },
  {
    id: "architect",
    name: "Architect",
    role: "architecture",
    icon: Layers,
    description:
      "Designs system architecture, database schemas, and API contracts. Plans scalable solutions with clear component boundaries.",
    capabilities: { speed: 60, accuracy: 85, codeQuality: 90, creativity: 95 },
    recommendedFor: ["System design", "Schema planning", "Technical decisions"],
  },
  {
    id: "tester",
    name: "Tester",
    role: "testing",
    icon: TestTube,
    description:
      "Writes comprehensive test suites including unit, integration, and E2E tests. Identifies edge cases and coverage gaps.",
    capabilities: { speed: 75, accuracy: 90, codeQuality: 85, creativity: 65 },
    recommendedFor: ["Test writing", "Coverage improvement", "QA automation"],
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "code_review",
    icon: Shield,
    description:
      "Reviews code for bugs, security issues, performance problems, and style. Provides actionable feedback.",
    capabilities: { speed: 80, accuracy: 92, codeQuality: 95, creativity: 50 },
    recommendedFor: ["Code review", "Security audit", "Quality assurance"],
  },
  {
    id: "devops",
    name: "DevOps",
    role: "infrastructure",
    icon: Workflow,
    description:
      "Manages CI/CD pipelines, Docker configs, Kubernetes manifests, and deployment automation.",
    capabilities: { speed: 70, accuracy: 85, codeQuality: 80, creativity: 60 },
    recommendedFor: [
      "CI/CD setup",
      "Docker configuration",
      "Deployment automation",
    ],
  },
  {
    id: "data",
    name: "Data Engineer",
    role: "data",
    icon: Database,
    description:
      "Designs database queries, migrations, and data pipelines. Optimizes query performance and data models.",
    capabilities: { speed: 65, accuracy: 90, codeQuality: 85, creativity: 55 },
    recommendedFor: [
      "Database design",
      "Query optimization",
      "Data migrations",
    ],
  },
  {
    id: "frontend",
    name: "Frontend",
    role: "frontend",
    icon: Globe,
    description:
      "Builds responsive UIs with modern frameworks. Expert in accessibility, animations, and component architecture.",
    capabilities: { speed: 80, accuracy: 85, codeQuality: 90, creativity: 90 },
    recommendedFor: [
      "UI development",
      "Component design",
      "Responsive layouts",
    ],
  },
  {
    id: "api",
    name: "API Designer",
    role: "api",
    icon: Zap,
    description:
      "Designs and implements RESTful and GraphQL APIs. Handles validation, error handling, and documentation.",
    capabilities: { speed: 75, accuracy: 90, codeQuality: 90, creativity: 60 },
    recommendedFor: [
      "API design",
      "Endpoint implementation",
      "API documentation",
    ],
  },
  {
    id: "security",
    name: "Security",
    role: "security",
    icon: Shield,
    description:
      "Identifies and fixes security vulnerabilities. Implements authentication, authorization, and data protection.",
    capabilities: { speed: 60, accuracy: 95, codeQuality: 85, creativity: 50 },
    recommendedFor: [
      "Security audit",
      "Auth implementation",
      "Vulnerability fixes",
    ],
  },
  {
    id: "docs",
    name: "Docs Writer",
    role: "documentation",
    icon: MessageSquare,
    description:
      "Creates clear technical documentation, API docs, README files, and inline code comments.",
    capabilities: { speed: 90, accuracy: 80, codeQuality: 70, creativity: 85 },
    recommendedFor: ["Documentation", "API docs", "Technical writing"],
  },
  {
    id: "toolsmith",
    name: "Toolsmith",
    role: "tooling",
    icon: Wrench,
    description:
      "Builds developer tools, CLI utilities, scripts, and automation. Streamlines development workflows.",
    capabilities: { speed: 80, accuracy: 85, codeQuality: 80, creativity: 80 },
    recommendedFor: ["CLI tools", "Build scripts", "Developer experience"],
  },
];

/* -------------------------------------------------------------------------- */
/*  Radar chart data helper                                                    */
/* -------------------------------------------------------------------------- */

function buildRadarData(capabilities: AgentCapabilities) {
  return [
    { dimension: "Speed", value: capabilities.speed },
    { dimension: "Accuracy", value: capabilities.accuracy },
    { dimension: "Code Quality", value: capabilities.codeQuality },
    { dimension: "Creativity", value: capabilities.creativity },
  ];
}

function buildComparisonData(a: AgentCapabilities, b: AgentCapabilities) {
  return [
    { dimension: "Speed", agentA: a.speed, agentB: b.speed },
    { dimension: "Accuracy", agentA: a.accuracy, agentB: b.accuracy },
    {
      dimension: "Code Quality",
      agentA: a.codeQuality,
      agentB: b.codeQuality,
    },
    { dimension: "Creativity", agentA: a.creativity, agentB: b.creativity },
  ];
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

type ViewMode = "grid" | "compare";

export function SkillDiscovery({ onAskAgent }: SkillDiscoveryProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [compareAgent, setCompareAgent] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAgents = useMemo(() => {
    if (!searchQuery.trim()) {
      return AGENTS;
    }
    const q = searchQuery.toLowerCase();
    return AGENTS.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.recommendedFor.some((r) => r.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  const selectedDef = AGENTS.find((a) => a.id === selectedAgent);
  const compareDef = AGENTS.find((a) => a.id === compareAgent);

  const handleAgentClick = useCallback(
    (agentId: string) => {
      if (viewMode === "compare") {
        if (!selectedAgent) {
          setSelectedAgent(agentId);
        } else if (!compareAgent && agentId !== selectedAgent) {
          setCompareAgent(agentId);
        } else {
          setSelectedAgent(agentId);
          setCompareAgent(null);
        }
      } else {
        setSelectedAgent(selectedAgent === agentId ? null : agentId);
      }
    },
    [viewMode, selectedAgent, compareAgent]
  );

  const handleAskAgent = useCallback(
    (agentId: string) => {
      onAskAgent?.(agentId);
    },
    [onAskAgent]
  );

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-6 py-4">
        <div>
          <h2 className="font-semibold text-lg text-zinc-100">
            Agent Skill Discovery
          </h2>
          <p className="text-sm text-zinc-500">
            Explore what each specialist agent can do
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search agents..."
            type="text"
            value={searchQuery}
          />
          <Button
            onClick={() => {
              setViewMode(viewMode === "grid" ? "compare" : "grid");
              setSelectedAgent(null);
              setCompareAgent(null);
            }}
            size="sm"
            variant={viewMode === "compare" ? "default" : "outline"}
          >
            {viewMode === "compare" ? "Grid View" : "Compare"}
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Agent grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {viewMode === "compare" && (
            <p className="mb-3 text-sm text-zinc-500">
              Select two agents to compare their capabilities side-by-side.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAgents.map((agent) => {
              const Icon = agent.icon;
              const isSelected =
                agent.id === selectedAgent || agent.id === compareAgent;

              return (
                <button
                  className={[
                    "flex flex-col items-start rounded-xl border p-4 text-left transition-all",
                    isSelected
                      ? "border-violet-500/50 bg-violet-500/10"
                      : "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700 hover:bg-zinc-900",
                  ].join(" ")}
                  key={agent.id}
                  onClick={() => handleAgentClick(agent.id)}
                  type="button"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
                      <Icon className="h-4 w-4 text-violet-400" />
                    </div>
                    <span className="font-medium text-sm text-zinc-200">
                      {agent.name}
                    </span>
                  </div>
                  <p className="mb-2 line-clamp-2 text-xs text-zinc-500">
                    {agent.description}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {agent.recommendedFor.slice(0, 2).map((task) => (
                      <Badge
                        className="bg-zinc-800 text-[10px] text-zinc-400"
                        key={task}
                      >
                        {task}
                      </Badge>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Detail / Comparison panel */}
        {(selectedDef || (viewMode === "compare" && compareDef)) && (
          <div className="w-96 shrink-0 overflow-y-auto border-zinc-800 border-l bg-zinc-900/30 p-4">
            {viewMode === "compare" && selectedDef && compareDef && (
              <div>
                <h3 className="mb-4 font-medium text-sm text-zinc-200">
                  {selectedDef.name} vs {compareDef.name}
                </h3>
                <div className="mb-4 h-64">
                  <ResponsiveContainer height="100%" width="100%">
                    <RadarChart
                      data={buildComparisonData(
                        selectedDef.capabilities,
                        compareDef.capabilities
                      )}
                    >
                      <PolarGrid stroke="#3f3f46" />
                      <PolarAngleAxis
                        dataKey="dimension"
                        tick={{ fill: "#a1a1aa", fontSize: 11 }}
                      />
                      <PolarRadiusAxis
                        angle={30}
                        domain={[0, 100]}
                        tick={{ fill: "#71717a", fontSize: 10 }}
                      />
                      <Radar
                        dataKey="agentA"
                        fill="#8b5cf6"
                        fillOpacity={0.2}
                        name={selectedDef.name}
                        stroke="#8b5cf6"
                      />
                      <Radar
                        dataKey="agentB"
                        fill="#06b6d4"
                        fillOpacity={0.2}
                        name={compareDef.name}
                        stroke="#06b6d4"
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {(
                    ["speed", "accuracy", "codeQuality", "creativity"] as const
                  ).map((key) => {
                    const labelMap = {
                      speed: "Speed",
                      accuracy: "Accuracy",
                      codeQuality: "Code Quality",
                      creativity: "Creativity",
                    };
                    const aVal = selectedDef.capabilities[key];
                    const bVal = compareDef.capabilities[key];
                    return (
                      <div key={key}>
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-zinc-400">{labelMap[key]}</span>
                          <span className="text-zinc-500">
                            <span className="text-violet-400">{aVal}</span>
                            {" vs "}
                            <span className="text-cyan-400">{bVal}</span>
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-violet-500"
                              style={{ width: `${aVal}%` }}
                            />
                          </div>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-800">
                            <div
                              className="h-full rounded-full bg-cyan-500"
                              style={{ width: `${bVal}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {!(viewMode === "compare" && selectedDef && compareDef) &&
              selectedDef && (
                <div>
                  <div className="mb-4 flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10">
                      <selectedDef.icon className="h-5 w-5 text-violet-400" />
                    </div>
                    <div>
                      <h3 className="font-medium text-zinc-200">
                        {selectedDef.name}
                      </h3>
                      <span className="text-xs text-zinc-500">
                        {selectedDef.role}
                      </span>
                    </div>
                  </div>

                  <p className="mb-4 text-sm text-zinc-400 leading-relaxed">
                    {selectedDef.description}
                  </p>

                  {/* Radar chart */}
                  <Card className="mb-4 border-zinc-800 bg-zinc-900/50 p-2">
                    <p className="mb-1 px-2 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                      Capabilities
                    </p>
                    <div className="h-52">
                      <ResponsiveContainer height="100%" width="100%">
                        <RadarChart
                          data={buildRadarData(selectedDef.capabilities)}
                        >
                          <PolarGrid stroke="#3f3f46" />
                          <PolarAngleAxis
                            dataKey="dimension"
                            tick={{ fill: "#a1a1aa", fontSize: 11 }}
                          />
                          <PolarRadiusAxis
                            angle={30}
                            domain={[0, 100]}
                            tick={{ fill: "#71717a", fontSize: 10 }}
                          />
                          <Radar
                            dataKey="value"
                            fill="#8b5cf6"
                            fillOpacity={0.3}
                            stroke="#8b5cf6"
                            strokeWidth={2}
                          />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>

                  {/* Recommended for */}
                  <div className="mb-4">
                    <p className="mb-2 font-medium text-xs text-zinc-400">
                      Recommended for
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDef.recommendedFor.map((task) => (
                        <Badge
                          className="bg-violet-500/10 text-violet-300"
                          key={task}
                        >
                          {task}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* Quick action */}
                  <Button
                    className="w-full"
                    onClick={() => handleAskAgent(selectedDef.id)}
                  >
                    <Bot className="mr-2 h-4 w-4" />
                    Ask {selectedDef.name}
                  </Button>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
