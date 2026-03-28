"use client";

import type React from "react";
import { useState } from "react";

type AdminTab = "overview" | "users" | "security" | "system";

const TABS: Array<{ id: AdminTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "users", label: "Users & Roles" },
  { id: "security", label: "Security" },
  { id: "system", label: "System Health" },
];

function getRoleBadgeClass(role: string): string {
  if (role === "admin") {
    return "bg-violet-900 text-violet-300";
  }
  if (role === "member") {
    return "bg-zinc-800 text-zinc-300";
  }
  return "bg-zinc-800 text-zinc-500";
}

const MOCK_STATS = {
  totalUsers: 47,
  activeUsers: 32,
  totalProjects: 156,
  tasksThisMonth: 2847,
  creditsUsed: 1250.0,
  creditsRemaining: 3750.0,
  successRate: 94.2,
  avgTaskTime: "3m 42s",
};

const MOCK_USERS = [
  {
    id: "1",
    name: "Alice Chen",
    email: "alice@company.com",
    role: "admin",
    lastActive: "2m ago",
    tasks: 142,
  },
  {
    id: "2",
    name: "Bob Smith",
    email: "bob@company.com",
    role: "member",
    lastActive: "1h ago",
    tasks: 89,
  },
  {
    id: "3",
    name: "Carol Davis",
    email: "carol@company.com",
    role: "member",
    lastActive: "3h ago",
    tasks: 67,
  },
  {
    id: "4",
    name: "Dan Wilson",
    email: "dan@company.com",
    role: "viewer",
    lastActive: "1d ago",
    tasks: 23,
  },
  {
    id: "5",
    name: "Eve Martinez",
    email: "eve@company.com",
    role: "member",
    lastActive: "5m ago",
    tasks: 201,
  },
];

const MOCK_SERVICES = [
  { name: "API", status: "healthy", uptime: "99.97%", latency: "45ms" },
  {
    name: "Orchestrator",
    status: "healthy",
    uptime: "99.95%",
    latency: "120ms",
  },
  { name: "Queue Worker", status: "healthy", uptime: "99.99%", latency: "8ms" },
  {
    name: "Socket Server",
    status: "healthy",
    uptime: "99.98%",
    latency: "12ms",
  },
  {
    name: "Model Router",
    status: "healthy",
    uptime: "99.90%",
    latency: "250ms",
  },
  { name: "MCP Gateway", status: "healthy", uptime: "99.92%", latency: "85ms" },
  {
    name: "Project Brain",
    status: "healthy",
    uptime: "99.88%",
    latency: "180ms",
  },
  {
    name: "Sandbox Manager",
    status: "healthy",
    uptime: "99.95%",
    latency: "95ms",
  },
];

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 font-mono font-semibold text-2xl text-white">
        {value}
      </div>
    </div>
  );
}

function OverviewTab() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total Users" value={MOCK_STATS.totalUsers} />
        <StatCard label="Active Users" value={MOCK_STATS.activeUsers} />
        <StatCard label="Projects" value={MOCK_STATS.totalProjects} />
        <StatCard label="Tasks (Month)" value={MOCK_STATS.tasksThisMonth} />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Credits Used" value={`$${MOCK_STATS.creditsUsed}`} />
        <StatCard
          label="Credits Left"
          value={`$${MOCK_STATS.creditsRemaining}`}
        />
        <StatCard label="Success Rate" value={`${MOCK_STATS.successRate}%`} />
        <StatCard label="Avg Task Time" value={MOCK_STATS.avgTaskTime} />
      </div>
    </div>
  );
}

function UsersTab() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-zinc-400">
          {MOCK_USERS.length} members
        </h3>
        <button
          className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white hover:bg-violet-500"
          type="button"
        >
          Invite Member
        </button>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full">
          <thead className="bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Name
              </th>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Role
              </th>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Tasks
              </th>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Last Active
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {MOCK_USERS.map((user) => (
              <tr className="hover:bg-zinc-900/50" key={user.id}>
                <td className="px-4 py-3">
                  <div className="text-sm text-white">{user.name}</div>
                  <div className="text-xs text-zinc-500">{user.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${getRoleBadgeClass(user.role)}`}
                  >
                    {user.role}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-sm text-zinc-400">
                  {user.tasks}
                </td>
                <td className="px-4 py-3 text-sm text-zinc-500">
                  {user.lastActive}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SecurityTab() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 font-medium text-sm text-white">Authentication</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">SSO Enabled</span>
            <span className="text-emerald-400 text-sm">Active (OIDC)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">MFA Required</span>
            <span className="text-amber-400 text-sm">Optional</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Session Timeout</span>
            <span className="text-sm text-zinc-300">24 hours</span>
          </div>
        </div>
      </div>
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-6">
        <h3 className="mb-4 font-medium text-sm text-white">Compliance</h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">SOC2 Status</span>
            <span className="text-emerald-400 text-sm">Compliant</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">GDPR</span>
            <span className="text-emerald-400 text-sm">Compliant</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Audit Logging</span>
            <span className="text-emerald-400 text-sm">Enabled</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-400">Data Encryption</span>
            <span className="text-emerald-400 text-sm">AES-256 at rest</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SystemTab() {
  return (
    <div className="space-y-4">
      <h3 className="font-medium text-sm text-zinc-400">Service Health</h3>
      <div className="overflow-hidden rounded-lg border border-zinc-800">
        <table className="w-full">
          <thead className="bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Service
              </th>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Status
              </th>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Uptime
              </th>
              <th className="px-4 py-3 text-left font-medium text-xs text-zinc-500">
                Latency
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {MOCK_SERVICES.map((svc) => (
              <tr className="hover:bg-zinc-900/50" key={svc.name}>
                <td className="px-4 py-3 font-medium text-sm text-white">
                  {svc.name}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-2 text-emerald-400 text-sm">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    {svc.status}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-sm text-zinc-400">
                  {svc.uptime}
                </td>
                <td className="px-4 py-3 font-mono text-sm text-zinc-400">
                  {svc.latency}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TAB_COMPONENTS: Record<AdminTab, () => React.JSX.Element> = {
  overview: OverviewTab,
  users: UsersTab,
  security: SecurityTab,
  system: SystemTab,
};

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const ActiveComponent = TAB_COMPONENTS[activeTab];

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div>
        <h1 className="font-bold text-2xl text-white">Admin Dashboard</h1>
        <p className="text-sm text-zinc-500">
          Organization management, security, and system health
        </p>
      </div>

      <div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
        {TABS.map((tab) => (
          <button
            className={`rounded-md px-4 py-2 font-medium text-sm transition-colors ${
              activeTab === tab.id
                ? "bg-zinc-800 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ActiveComponent />
    </div>
  );
}
