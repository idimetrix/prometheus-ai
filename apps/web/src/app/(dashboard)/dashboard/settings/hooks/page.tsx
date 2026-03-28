"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from "@prometheus/ui";
import { Code2, Globe, Plus, ShieldBan, Trash2, Wand2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Hook event types matching the database enum */
const HOOK_EVENTS = [
  {
    value: "before_file_write",
    label: "Before File Write",
    description: "Runs before a file is written",
  },
  {
    value: "after_file_write",
    label: "After File Write",
    description: "Runs after a file is written",
  },
  {
    value: "before_terminal_exec",
    label: "Before Command Execute",
    description: "Runs before a terminal command",
  },
  {
    value: "after_terminal_exec",
    label: "After Command Execute",
    description: "Runs after a terminal command",
  },
  {
    value: "before_git_commit",
    label: "Before Commit",
    description: "Runs before a git commit",
  },
  {
    value: "after_git_commit",
    label: "After Commit",
    description: "Runs after a git commit",
  },
  {
    value: "before_git_push",
    label: "Before Push",
    description: "Runs before a git push",
  },
  {
    value: "after_git_push",
    label: "After Push",
    description: "Runs after a git push",
  },
  {
    value: "on_task_start",
    label: "On Task Start",
    description: "Runs when a task begins",
  },
  {
    value: "on_task_complete",
    label: "On Task Complete",
    description: "Runs when a task finishes",
  },
  {
    value: "on_error",
    label: "On Error",
    description: "Runs when an error occurs",
  },
] as const;

/** Hook action types matching the database enum */
const HOOK_ACTIONS = [
  {
    value: "run_command",
    label: "Run Command",
    icon: Code2,
    description: "Execute a shell command in the sandbox",
  },
  {
    value: "call_webhook",
    label: "Call Webhook",
    icon: Globe,
    description: "POST event data to a URL",
  },
  {
    value: "block",
    label: "Block",
    icon: ShieldBan,
    description: "Prevent the action from executing",
  },
  {
    value: "transform",
    label: "Transform",
    icon: Wand2,
    description: "Modify tool arguments before execution",
  },
] as const;

/** Predefined hook templates for common use cases */
const HOOK_TEMPLATES = [
  {
    name: "Auto-format on save",
    event: "after_file_write",
    action: "run_command",
    config: {
      command: "npx prettier --write {{filePath}}",
      pattern: "**/*.{ts,tsx,js,jsx}",
      enabled: true,
    },
  },
  {
    name: "Run tests before commit",
    event: "before_git_commit",
    action: "run_command",
    config: {
      command: "npm test",
      enabled: true,
    },
  },
  {
    name: "Lint on file write",
    event: "after_file_write",
    action: "run_command",
    config: {
      command: "npx eslint --fix {{filePath}}",
      pattern: "**/*.{ts,tsx,js,jsx}",
      enabled: true,
    },
  },
  {
    name: "Block .env file writes",
    event: "before_file_write",
    action: "block",
    config: {
      command: "Writing to .env files is not allowed",
      pattern: "**/.env*",
      enabled: true,
    },
  },
  {
    name: "Notify on task complete",
    event: "on_task_complete",
    action: "call_webhook",
    config: {
      webhookUrl: "https://hooks.example.com/notify",
      enabled: true,
    },
  },
] as const;

interface HookItem {
  action: string;
  config: {
    command?: string;
    enabled: boolean;
    pattern?: string;
    webhookUrl?: string;
  };
  event: string;
  id: string;
  name: string;
  priority: number;
}

/** Initial demo hooks to show the UI populated */
const DEMO_HOOKS: HookItem[] = [
  {
    id: "hook_demo_1",
    name: "Auto-format on save",
    event: "after_file_write",
    action: "run_command",
    config: {
      command: "npx prettier --write {{filePath}}",
      pattern: "**/*.{ts,tsx,js,jsx}",
      enabled: true,
    },
    priority: 10,
  },
  {
    id: "hook_demo_2",
    name: "Run tests before commit",
    event: "before_git_commit",
    action: "run_command",
    config: {
      command: "npm test",
      enabled: true,
    },
    priority: 5,
  },
  {
    id: "hook_demo_3",
    name: "Block .env writes",
    event: "before_file_write",
    action: "block",
    config: {
      command: "Writing to .env files is not allowed by project policy",
      pattern: "**/.env*",
      enabled: false,
    },
    priority: 20,
  },
];

function getEventLabel(value: string): string {
  return HOOK_EVENTS.find((e) => e.value === value)?.label ?? value;
}

function getActionInfo(
  value: string
): (typeof HOOK_ACTIONS)[number] | undefined {
  return HOOK_ACTIONS.find((a) => a.value === value);
}

export default function HooksSettingsPage() {
  const [hooks, setHooks] = useState<HookItem[]>(DEMO_HOOKS);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newHookName, setNewHookName] = useState("");
  const [newHookEvent, setNewHookEvent] = useState("");
  const [newHookAction, setNewHookAction] = useState("");
  const [newHookCommand, setNewHookCommand] = useState("");
  const [newHookWebhookUrl, setNewHookWebhookUrl] = useState("");
  const [newHookPattern, setNewHookPattern] = useState("");
  const [newHookPriority, setNewHookPriority] = useState("0");

  function handleToggleHook(hookId: string, enabled: boolean) {
    setHooks((prev) =>
      prev.map((h) =>
        h.id === hookId ? { ...h, config: { ...h.config, enabled } } : h
      )
    );
    toast.success(`Hook ${enabled ? "enabled" : "disabled"}`);
  }

  function handleDeleteHook(hookId: string) {
    setHooks((prev) => prev.filter((h) => h.id !== hookId));
    toast.success("Hook deleted");
  }

  function handleCreateHook() {
    if (!(newHookName && newHookEvent && newHookAction)) {
      toast.error("Please fill in all required fields");
      return;
    }

    const newHook: HookItem = {
      id: `hook_${Date.now()}`,
      name: newHookName,
      event: newHookEvent,
      action: newHookAction,
      config: {
        command:
          newHookAction === "run_command" ||
          newHookAction === "block" ||
          newHookAction === "transform"
            ? newHookCommand
            : undefined,
        webhookUrl:
          newHookAction === "call_webhook" ? newHookWebhookUrl : undefined,
        pattern: newHookPattern || undefined,
        enabled: true,
      },
      priority: Number.parseInt(newHookPriority, 10) || 0,
    };

    setHooks((prev) => [...prev, newHook]);
    toast.success("Hook created");
    resetCreateForm();
    setIsCreateOpen(false);
  }

  function handleApplyTemplate(template: (typeof HOOK_TEMPLATES)[number]) {
    const newHook: HookItem = {
      id: `hook_${Date.now()}`,
      name: template.name,
      event: template.event,
      action: template.action,
      config: { ...template.config },
      priority: 0,
    };

    setHooks((prev) => [...prev, newHook]);
    toast.success(`Template "${template.name}" applied`);
  }

  function resetCreateForm() {
    setNewHookName("");
    setNewHookEvent("");
    setNewHookAction("");
    setNewHookCommand("");
    setNewHookWebhookUrl("");
    setNewHookPattern("");
    setNewHookPriority("0");
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl">Hooks</h1>
          <p className="text-muted-foreground">
            Configure automated actions that run before or after agent
            operations. Hooks can run commands, call webhooks, block actions, or
            transform tool arguments.
          </p>
        </div>
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Hook
        </Button>
      </div>

      <Separator />

      {/* Templates Section */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Templates</CardTitle>
          <CardDescription>
            Apply common hook configurations with a single click
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {HOOK_TEMPLATES.map((template) => (
              <Button
                className="h-auto justify-start p-3 text-left"
                key={template.name}
                onClick={() => handleApplyTemplate(template)}
                variant="outline"
              >
                <div>
                  <div className="font-medium">{template.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {getEventLabel(template.event)} →{" "}
                    {
                      HOOK_ACTIONS.find((a) => a.value === template.action)
                        ?.label
                    }
                  </div>
                </div>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Hooks List */}
      <div className="space-y-4">
        {hooks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                No hooks configured yet. Create one or apply a template to get
                started.
              </p>
            </CardContent>
          </Card>
        ) : (
          hooks.map((hook) => {
            const actionInfo = getActionInfo(hook.action);
            const ActionIcon = actionInfo?.icon ?? Code2;

            return (
              <Card key={hook.id}>
                <CardContent className="flex items-center gap-4 py-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <ActionIcon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{hook.name}</span>
                      <Badge variant="outline">
                        {getEventLabel(hook.event)}
                      </Badge>
                      <Badge
                        variant={hook.config.enabled ? "default" : "secondary"}
                      >
                        {actionInfo?.label ?? hook.action}
                      </Badge>
                      {hook.config.pattern && (
                        <Badge variant="outline">{hook.config.pattern}</Badge>
                      )}
                    </div>
                    <p className="truncate text-muted-foreground text-sm">
                      {hook.config.command ??
                        hook.config.webhookUrl ??
                        "No configuration"}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <Switch
                      checked={hook.config.enabled}
                      onCheckedChange={(checked) =>
                        handleToggleHook(hook.id, checked)
                      }
                    />
                    <Button
                      onClick={() => handleDeleteHook(hook.id)}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Create Hook Dialog */}
      <Dialog onOpenChange={setIsCreateOpen} open={isCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Hook</DialogTitle>
            <DialogDescription>
              Configure an automated action that runs on agent events
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hook-name">Name</Label>
              <Input
                id="hook-name"
                onChange={(e) => setNewHookName(e.target.value)}
                placeholder="e.g., Auto-format on save"
                value={newHookName}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hook-event">Event Trigger</Label>
              <Select onValueChange={setNewHookEvent} value={newHookEvent}>
                <SelectTrigger id="hook-event">
                  <SelectValue placeholder="Select an event" />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_EVENTS.map((event) => (
                    <SelectItem key={event.value} value={event.value}>
                      <div>
                        <div>{event.label}</div>
                        <div className="text-muted-foreground text-xs">
                          {event.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="hook-action">Action Type</Label>
              <Select onValueChange={setNewHookAction} value={newHookAction}>
                <SelectTrigger id="hook-action">
                  <SelectValue placeholder="Select an action" />
                </SelectTrigger>
                <SelectContent>
                  {HOOK_ACTIONS.map((action) => (
                    <SelectItem key={action.value} value={action.value}>
                      <div>
                        <div>{action.label}</div>
                        <div className="text-muted-foreground text-xs">
                          {action.description}
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {(newHookAction === "run_command" ||
              newHookAction === "block" ||
              newHookAction === "transform") && (
              <div className="space-y-2">
                <Label htmlFor="hook-command">
                  {(() => {
                    if (newHookAction === "block") {
                      return "Block Message";
                    }
                    if (newHookAction === "transform") {
                      return "Transform JSON";
                    }
                    return "Command";
                  })()}
                </Label>
                <Input
                  id="hook-command"
                  onChange={(e) => setNewHookCommand(e.target.value)}
                  placeholder={(() => {
                    if (newHookAction === "block") {
                      return "Action blocked by policy";
                    }
                    if (newHookAction === "transform") {
                      return '{"key": "new_value"}';
                    }
                    return "npm run lint";
                  })()}
                  value={newHookCommand}
                />
              </div>
            )}

            {newHookAction === "call_webhook" && (
              <div className="space-y-2">
                <Label htmlFor="hook-webhook">Webhook URL</Label>
                <Input
                  id="hook-webhook"
                  onChange={(e) => setNewHookWebhookUrl(e.target.value)}
                  placeholder="https://hooks.example.com/notify"
                  value={newHookWebhookUrl}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="hook-pattern">File Pattern (optional)</Label>
              <Input
                id="hook-pattern"
                onChange={(e) => setNewHookPattern(e.target.value)}
                placeholder="**/*.ts"
                value={newHookPattern}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hook-priority">Priority</Label>
              <Input
                id="hook-priority"
                onChange={(e) => setNewHookPriority(e.target.value)}
                placeholder="0"
                type="number"
                value={newHookPriority}
              />
              <p className="text-muted-foreground text-xs">
                Higher priority hooks run first
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => {
                resetCreateForm();
                setIsCreateOpen(false);
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button onClick={handleCreateHook}>Create Hook</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
