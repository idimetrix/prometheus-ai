"use client";

import { Badge, Button, Card, ScrollArea } from "@prometheus/ui";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Loader2,
  Package,
  RefreshCw,
  Shield,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UpdateType = "major" | "minor" | "patch";
type UpdateStatus = "available" | "updating" | "updated" | "failed";

interface DependencyInfo {
  currentVersion: string;
  hasBreakingChanges: boolean;
  id: string;
  latestVersion: string;
  name: string;
  securityAdvisory: boolean;
  status: UpdateStatus;
  updateType: UpdateType;
}

interface DependencyUpdaterProps {
  className?: string;
  onUpdate?: (packageName: string, targetVersion: string) => void;
  onUpdateAll?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPDATE_TYPE_CONFIG: Record<UpdateType, { color: string; label: string }> =
  {
    major: { label: "Major", color: "bg-red-500/20 text-red-400" },
    minor: { label: "Minor", color: "bg-yellow-500/20 text-yellow-400" },
    patch: { label: "Patch", color: "bg-green-500/20 text-green-400" },
  };

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_DEPENDENCIES: DependencyInfo[] = [
  {
    id: "dep_001",
    name: "@trpc/server",
    currentVersion: "10.45.0",
    latestVersion: "11.2.0",
    updateType: "major",
    hasBreakingChanges: true,
    securityAdvisory: false,
    status: "available",
  },
  {
    id: "dep_002",
    name: "drizzle-orm",
    currentVersion: "0.32.1",
    latestVersion: "0.34.0",
    updateType: "minor",
    hasBreakingChanges: false,
    securityAdvisory: false,
    status: "available",
  },
  {
    id: "dep_003",
    name: "hono",
    currentVersion: "4.3.2",
    latestVersion: "4.3.9",
    updateType: "patch",
    hasBreakingChanges: false,
    securityAdvisory: false,
    status: "available",
  },
  {
    id: "dep_004",
    name: "next",
    currentVersion: "14.2.3",
    latestVersion: "15.1.0",
    updateType: "major",
    hasBreakingChanges: true,
    securityAdvisory: false,
    status: "available",
  },
  {
    id: "dep_005",
    name: "zod",
    currentVersion: "3.22.4",
    latestVersion: "3.23.8",
    updateType: "minor",
    hasBreakingChanges: false,
    securityAdvisory: false,
    status: "available",
  },
  {
    id: "dep_006",
    name: "express",
    currentVersion: "4.18.2",
    latestVersion: "4.19.2",
    updateType: "minor",
    hasBreakingChanges: false,
    securityAdvisory: true,
    status: "available",
  },
  {
    id: "dep_007",
    name: "typescript",
    currentVersion: "5.4.5",
    latestVersion: "5.6.2",
    updateType: "minor",
    hasBreakingChanges: false,
    securityAdvisory: false,
    status: "available",
  },
  {
    id: "dep_008",
    name: "bullmq",
    currentVersion: "5.7.0",
    latestVersion: "5.7.3",
    updateType: "patch",
    hasBreakingChanges: false,
    securityAdvisory: false,
    status: "available",
  },
  {
    id: "dep_009",
    name: "ioredis",
    currentVersion: "5.3.2",
    latestVersion: "5.4.1",
    updateType: "minor",
    hasBreakingChanges: false,
    securityAdvisory: true,
    status: "available",
  },
  {
    id: "dep_010",
    name: "lucide-react",
    currentVersion: "0.378.0",
    latestVersion: "0.379.0",
    updateType: "patch",
    hasBreakingChanges: false,
    securityAdvisory: false,
    status: "available",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DependencyUpdater({
  className,
  onUpdate,
  onUpdateAll,
}: DependencyUpdaterProps) {
  const [deps, setDeps] = useState<DependencyInfo[]>(MOCK_DEPENDENCIES);
  const [updatingAll, setUpdatingAll] = useState(false);

  const stats = useMemo(() => {
    let major = 0;
    let minor = 0;
    let patch = 0;
    let security = 0;
    let available = 0;

    for (const dep of deps) {
      if (dep.status === "available") {
        available++;
        if (dep.updateType === "major") {
          major++;
        } else if (dep.updateType === "minor") {
          minor++;
        } else {
          patch++;
        }
        if (dep.securityAdvisory) {
          security++;
        }
      }
    }

    return { major, minor, patch, security, available };
  }, [deps]);

  const handleUpdate = useCallback(
    (id: string) => {
      const dep = deps.find((d) => d.id === id);
      if (!dep) {
        return;
      }

      setDeps((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, status: "updating" as const } : d
        )
      );

      onUpdate?.(dep.name, dep.latestVersion);

      // Simulate update completion
      setTimeout(() => {
        setDeps((prev) =>
          prev.map((d) =>
            d.id === id
              ? {
                  ...d,
                  status: "updated" as const,
                  currentVersion: d.latestVersion,
                }
              : d
          )
        );
      }, 1500);
    },
    [deps, onUpdate]
  );

  const handleUpdateAll = useCallback(() => {
    setUpdatingAll(true);
    onUpdateAll?.();

    // Mark all available as updating
    setDeps((prev) =>
      prev.map((d) =>
        d.status === "available" ? { ...d, status: "updating" as const } : d
      )
    );

    // Simulate completion
    setTimeout(() => {
      setDeps((prev) =>
        prev.map((d) =>
          d.status === "updating"
            ? {
                ...d,
                status: "updated" as const,
                currentVersion: d.latestVersion,
              }
            : d
        )
      );
      setUpdatingAll(false);
    }, 3000);
  }, [onUpdateAll]);

  return (
    <Card
      className={`flex flex-col border-zinc-800 bg-zinc-950 ${className ?? ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-zinc-800 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-violet-400" />
          <h3 className="font-medium text-sm text-zinc-200">Dependencies</h3>
          {stats.available > 0 && (
            <Badge
              className="bg-violet-500/20 text-violet-400"
              variant="secondary"
            >
              {stats.available} updates
            </Badge>
          )}
          {stats.security > 0 && (
            <Badge className="bg-red-500/20 text-red-400" variant="secondary">
              {stats.security} security
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button className="h-7 text-xs" size="sm" variant="ghost">
            <RefreshCw className="mr-1 h-3 w-3" />
            Check
          </Button>
          {stats.available > 0 && (
            <Button
              className="h-7 text-xs"
              disabled={updatingAll}
              onClick={handleUpdateAll}
              size="sm"
              variant="default"
            >
              {updatingAll ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <ArrowUp className="mr-1 h-3 w-3" />
              )}
              Update All
            </Button>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-3 border-zinc-800 border-b px-4 py-2 text-[10px] text-zinc-500">
        <span>
          <span className="font-medium text-red-400">{stats.major}</span> major
        </span>
        <span>
          <span className="font-medium text-yellow-400">{stats.minor}</span>{" "}
          minor
        </span>
        <span>
          <span className="font-medium text-green-400">{stats.patch}</span>{" "}
          patch
        </span>
      </div>

      {/* Dependency table */}
      <ScrollArea className="flex-1">
        <div className="min-w-0">
          {/* Table header */}
          <div className="sticky top-0 z-10 flex items-center gap-2 border-zinc-800 border-b bg-zinc-900/80 px-4 py-1.5 text-[10px] text-zinc-600 uppercase tracking-wider backdrop-blur-sm">
            <span className="flex-1">Package</span>
            <span className="w-20 text-right">Current</span>
            <span className="w-20 text-right">Latest</span>
            <span className="w-16 text-center">Type</span>
            <span className="w-20 text-right">Action</span>
          </div>

          {/* Rows */}
          {deps.map((dep) => {
            const typeConfig = UPDATE_TYPE_CONFIG[dep.updateType];
            const isUpdated = dep.status === "updated";
            const isUpdating = dep.status === "updating";

            return (
              <div
                className={`flex items-center gap-2 border-zinc-800/50 border-b px-4 py-2 transition-colors hover:bg-zinc-900/30 ${
                  isUpdated ? "opacity-50" : ""
                }`}
                key={dep.id}
              >
                {/* Package name */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-mono text-xs text-zinc-300">
                    {dep.name}
                  </span>
                  {dep.securityAdvisory && (
                    <Shield
                      aria-label="Security advisory"
                      className="h-3 w-3 shrink-0 text-red-400"
                    />
                  )}
                  {dep.hasBreakingChanges && (
                    <AlertTriangle
                      aria-label="Breaking changes"
                      className="h-3 w-3 shrink-0 text-yellow-400"
                    />
                  )}
                </div>

                {/* Current version */}
                <span className="w-20 text-right font-mono text-[11px] text-zinc-500">
                  {dep.currentVersion}
                </span>

                {/* Latest version */}
                <span className="w-20 text-right font-mono text-[11px] text-zinc-300">
                  {dep.latestVersion}
                </span>

                {/* Update type badge */}
                <div className="flex w-16 justify-center">
                  <Badge className={typeConfig.color} variant="secondary">
                    {typeConfig.label}
                  </Badge>
                </div>

                {/* Action */}
                <div className="flex w-20 justify-end">
                  {isUpdated && (
                    <span className="flex items-center gap-1 text-[10px] text-green-400">
                      <Check className="h-3 w-3" />
                      Done
                    </span>
                  )}
                  {!isUpdated && isUpdating && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                  )}
                  {!(isUpdated || isUpdating) && (
                    <Button
                      className="h-6 text-[10px]"
                      onClick={() => handleUpdate(dep.id)}
                      size="sm"
                      variant="ghost"
                    >
                      <ArrowUp className="mr-0.5 h-2.5 w-2.5" />
                      Update
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
