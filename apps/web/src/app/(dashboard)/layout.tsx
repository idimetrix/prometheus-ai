"use client";

import { useOrganization, useUser } from "@clerk/nextjs";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useDashboardStore } from "@/stores/dashboard.store";

const NAV_ITEMS: Array<{ href: Route; label: string; icon: React.ReactNode }> =
  [
    {
      href: "/dashboard",
      label: "Dashboard",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25a2.25 2.25 0 0 1-2.25-2.25v-2.25Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      href: "/dashboard/projects/new",
      label: "New Task",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M12 4.5v15m7.5-7.5h-15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      href: "/dashboard/projects",
      label: "Projects",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      href: "/dashboard/fleet",
      label: "Fleet",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 0 0 2.25-2.25V6.75a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 6.75v10.5a2.25 2.25 0 0 0 2.25 2.25Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      href: "/dashboard/analytics",
      label: "Analytics",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
    {
      href: "/dashboard/settings",
      label: "Settings",
      icon: (
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ),
    },
  ];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user } = useUser();
  const { organization } = useOrganization();
  const { activeAgents, creditBalance } = useDashboardStore();
  const [commandOpen, setCommandOpen] = useState(false);

  return (
    <div className="flex h-screen bg-zinc-950">
      {/* Sidebar */}
      <aside className="flex w-60 flex-col border-zinc-800 border-r bg-zinc-950">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-zinc-800 border-b px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 font-bold text-white text-xs">
            P
          </div>
          <span className="font-bold text-sm text-zinc-100 tracking-wide">
            PROMETHEUS
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-auto px-2 py-3">
          {NAV_ITEMS.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));
            return (
              <Link
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-violet-600/10 font-medium text-violet-400"
                    : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
                }`}
                href={item.href}
                key={item.href}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Command palette hint */}
        <div className="border-zinc-800 border-t px-3 py-3">
          <button
            className="flex w-full items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:border-zinc-700 hover:text-zinc-400"
            onClick={() => setCommandOpen(true)}
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
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="flex-1 text-left">Search...</span>
            <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px]">
              {"\u2318"}K
            </kbd>
          </button>
        </div>

        {/* User section */}
        <div className="border-zinc-800 border-t px-3 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-800 font-medium text-xs text-zinc-300">
              {user?.firstName?.[0] ??
                user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ??
                "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium text-xs text-zinc-200">
                {user?.firstName ?? "User"}
              </div>
              <div className="truncate text-[10px] text-zinc-500">
                {organization?.name ?? "Personal"}
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between border-zinc-800 border-b bg-zinc-950 px-6">
          <div className="flex items-center gap-4">
            <h1 className="font-medium text-sm text-zinc-200">
              {organization?.name ?? "Personal Workspace"}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Active agents badge */}
            <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  activeAgents > 0
                    ? "animate-pulse bg-green-500"
                    : "bg-zinc-600"
                }`}
              />
              <span className="text-xs text-zinc-400">
                {activeAgents} agent{activeAgents === 1 ? "" : "s"}
              </span>
            </div>
            {/* Credit balance */}
            <div className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1">
              <svg
                aria-hidden="true"
                className="h-3.5 w-3.5 text-yellow-500"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M10.75 10.818a2.608 2.608 0 0 1-.873 1.214c-.546.44-1.276.673-2.133.673a4.21 4.21 0 0 1-1.279-.2 2.349 2.349 0 0 1-.96-.609 2.372 2.372 0 0 1-.535-.858A3.2 3.2 0 0 1 4.8 10c0-.668.167-1.241.502-1.72a3.41 3.41 0 0 1 1.316-1.125c.546-.29 1.14-.435 1.782-.435.68 0 1.265.152 1.754.456.49.304.855.71 1.095 1.218.24.509.36 1.07.36 1.684 0 .282-.031.558-.093.827-.062.27-.164.525-.306.766ZM10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />
              </svg>
              <span className="font-medium text-xs text-zinc-300">
                {creditBalance.toLocaleString()}
              </span>
              <span className="text-[10px] text-zinc-500">credits</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>

      {/* Command palette overlay */}
      {commandOpen && (
        // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-close pattern
        // biome-ignore lint/a11y/noStaticElementInteractions: backdrop overlay
        // biome-ignore lint/a11y/noNoninteractiveElementInteractions: backdrop overlay
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-[20vh]"
          onClick={() => setCommandOpen(false)}
        >
          {/* biome-ignore lint/a11y/noStaticElementInteractions: stops click propagation to backdrop */}
          <div
            className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <div className="flex items-center gap-3 border-zinc-800 border-b px-4 py-3">
              <svg
                aria-hidden="true"
                className="h-4 w-4 text-zinc-500"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <input
                autoFocus
                className="flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
                placeholder="Search projects, sessions, commands..."
                type="text"
              />
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500">
                ESC
              </kbd>
            </div>
            <div className="px-2 py-2">
              <div className="px-2 py-1.5 font-medium text-[10px] text-zinc-500 uppercase tracking-wider">
                Quick Actions
              </div>
              {(
                [
                  { label: "New Task", href: "/dashboard/projects/new" },
                  { label: "View Fleet", href: "/dashboard/fleet" },
                  { label: "Analytics", href: "/dashboard/analytics" },
                  { label: "Settings", href: "/dashboard/settings" },
                ] satisfies Array<{ label: string; href: Route }>
              ).map((action) => (
                <Link
                  className="flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
                  href={action.href}
                  key={action.href}
                  onClick={() => setCommandOpen(false)}
                >
                  {action.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
