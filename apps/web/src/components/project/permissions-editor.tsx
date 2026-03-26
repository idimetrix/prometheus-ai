"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@prometheus/ui";
import { AlertTriangle, Info, RotateCcw, Shield } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PermissionValue = "allowed" | "ask" | "denied";

interface ToolPermission {
  conditions: Record<string, unknown> | null;
  description: string;
  id: string | null;
  isDangerous: boolean;
  isDefault: boolean;
  permission: PermissionValue;
  toolName: string;
}

interface PermissionsEditorProps {
  /** Whether the user has contributor+ role */
  canEdit?: boolean;
  /** Category groupings: { "File Operations": ["file_read", ...] } */
  categories: Record<string, string[]>;
  /** Whether the form is currently saving */
  isSaving?: boolean;
  /** Called when a permission is changed */
  onPermissionChange: (toolName: string, permission: PermissionValue) => void;
  /** Called when reset to defaults is requested */
  onReset: () => void;
  /** The list of tool permissions for the project */
  permissions: ToolPermission[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERMISSION_COLORS: Record<PermissionValue, string> = {
  allowed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  ask: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  denied: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const PERMISSION_LABELS: Record<PermissionValue, string> = {
  allowed: "Allowed",
  ask: "Ask",
  denied: "Denied",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PermissionsEditor({
  permissions,
  categories,
  onPermissionChange,
  onReset,
  isSaving = false,
  canEdit = true,
}: PermissionsEditorProps) {
  const [pendingChanges, setPendingChanges] = useState<
    Map<string, PermissionValue>
  >(new Map());

  const permissionMap = useMemo(() => {
    const map = new Map<string, ToolPermission>();
    for (const p of permissions) {
      map.set(p.toolName, p);
    }
    return map;
  }, [permissions]);

  const handleChange = useCallback(
    (toolName: string, value: PermissionValue) => {
      setPendingChanges((prev) => {
        const next = new Map(prev);
        next.set(toolName, value);
        return next;
      });
      onPermissionChange(toolName, value);
    },
    [onPermissionChange]
  );

  const getEffectivePermission = useCallback(
    (toolName: string): PermissionValue => {
      const pending = pendingChanges.get(toolName);
      if (pending) {
        return pending;
      }
      return permissionMap.get(toolName)?.permission ?? "ask";
    },
    [pendingChanges, permissionMap]
  );

  const handleReset = useCallback(() => {
    setPendingChanges(new Map());
    onReset();
  }, [onReset]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>Agent Permissions</CardTitle>
              <CardDescription>
                Configure what actions the AI agent is allowed to perform
              </CardDescription>
            </div>
          </div>
          {canEdit && (
            <Button
              disabled={isSaving}
              onClick={handleReset}
              size="sm"
              variant="outline"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Reset to Defaults
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {Object.entries(categories).map(([category, toolNames]) => (
            <div key={category}>
              <h3 className="mb-3 font-semibold text-muted-foreground text-sm uppercase tracking-wide">
                {category}
              </h3>
              <div className="space-y-2">
                {toolNames.map((toolName) => {
                  const tool = permissionMap.get(toolName);
                  if (!tool) {
                    return null;
                  }
                  const effectivePermission = getEffectivePermission(toolName);

                  return (
                    <div
                      className="flex items-center justify-between rounded-lg border p-3"
                      key={toolName}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">
                              {toolName}
                            </span>
                            {tool.isDangerous && (
                              <Badge className="text-xs" variant="destructive">
                                <AlertTriangle className="mr-1 h-3 w-3" />
                                Dangerous
                              </Badge>
                            )}
                            {tool.isDefault && (
                              <Badge className="text-xs" variant="secondary">
                                Default
                              </Badge>
                            )}
                          </div>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <p className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
                                  <Info className="h-3 w-3" />
                                  {tool.description}
                                </p>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p>{tool.description}</p>
                                {tool.isDangerous && (
                                  <p className="mt-1 text-yellow-500">
                                    This is a dangerous operation. Enabling it
                                    allows the agent to make potentially
                                    irreversible changes.
                                  </p>
                                )}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Badge
                          className={`${PERMISSION_COLORS[effectivePermission]} border-0`}
                        >
                          {PERMISSION_LABELS[effectivePermission]}
                        </Badge>

                        {canEdit && (
                          <Select
                            disabled={isSaving}
                            onValueChange={(v) =>
                              handleChange(toolName, v as PermissionValue)
                            }
                            value={effectivePermission}
                          >
                            <SelectTrigger className="w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="allowed">Allowed</SelectItem>
                              <SelectItem value="ask">Ask</SelectItem>
                              <SelectItem value="denied">Denied</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-950">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-yellow-600 dark:text-yellow-400" />
            <div className="text-sm text-yellow-800 dark:text-yellow-200">
              <p className="font-medium">Permission Levels</p>
              <ul className="mt-1 list-inside list-disc space-y-1">
                <li>
                  <strong>Allowed</strong> - Agent can use this tool without
                  asking
                </li>
                <li>
                  <strong>Ask</strong> - Agent will pause and request your
                  approval before using this tool
                </li>
                <li>
                  <strong>Denied</strong> - Agent cannot use this tool at all
                </li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
