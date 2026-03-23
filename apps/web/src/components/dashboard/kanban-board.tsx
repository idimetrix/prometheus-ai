"use client";

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  AlertTriangle,
  ArrowUpCircle,
  Clock,
  Filter,
  GripVertical,
  MinusCircle,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface KanbanTask {
  agentRole?: string;
  createdAt: string;
  id: string;
  priority: "critical" | "high" | "medium" | "low";
  status: "backlog" | "in_progress" | "in_review" | "done";
  timeEstimate?: string;
  title: string;
}

interface KanbanBoardProps {
  onTaskClick?: (task: KanbanTask) => void;
  onTaskMove: (taskId: string, newStatus: string) => void;
  tasks: KanbanTask[];
}

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const COLUMNS: Array<{
  color: string;
  id: KanbanTask["status"];
  label: string;
}> = [
  { id: "backlog", label: "Backlog", color: "bg-zinc-500" },
  { id: "in_progress", label: "In Progress", color: "bg-blue-500" },
  { id: "in_review", label: "In Review", color: "bg-amber-500" },
  { id: "done", label: "Done", color: "bg-green-500" },
];

const PRIORITY_CONFIG: Record<
  KanbanTask["priority"],
  { badge: string; icon: typeof ArrowUpCircle; label: string }
> = {
  critical: {
    badge: "bg-red-500/20 text-red-400",
    icon: AlertTriangle,
    label: "Critical",
  },
  high: {
    badge: "bg-orange-500/20 text-orange-400",
    icon: ArrowUpCircle,
    label: "High",
  },
  medium: {
    badge: "bg-blue-500/20 text-blue-400",
    icon: MinusCircle,
    label: "Medium",
  },
  low: {
    badge: "bg-zinc-500/20 text-zinc-400",
    icon: MinusCircle,
    label: "Low",
  },
};

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-500/20 text-violet-400",
  discovery: "bg-blue-500/20 text-blue-400",
  architect: "bg-indigo-500/20 text-indigo-400",
  frontend: "bg-cyan-500/20 text-cyan-400",
  backend: "bg-green-500/20 text-green-400",
  database: "bg-yellow-500/20 text-yellow-400",
  devops: "bg-orange-500/20 text-orange-400",
  testing: "bg-pink-500/20 text-pink-400",
  security: "bg-red-500/20 text-red-400",
};

const ALL_ROLES = Object.keys(ROLE_COLORS);

const ALL_PRIORITIES: KanbanTask["priority"][] = [
  "critical",
  "high",
  "medium",
  "low",
];

/* -------------------------------------------------------------------------- */
/*  Droppable Column                                                           */
/* -------------------------------------------------------------------------- */

function DroppableColumn({
  column,
  tasks,
  totalTasks,
  onTaskClick,
}: {
  column: (typeof COLUMNS)[number];
  onTaskClick?: (task: KanbanTask) => void;
  tasks: KanbanTask[];
  totalTasks: number;
}) {
  const progressPct =
    totalTasks > 0 ? Math.round((tasks.length / totalTasks) * 100) : 0;

  return (
    <div
      className="flex min-h-[400px] flex-1 flex-col rounded-lg border border-zinc-800 bg-zinc-900/30"
      data-column-id={column.id}
    >
      {/* Column header */}
      <div className="border-zinc-800 border-b p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${column.color}`} />
            <span className="font-medium text-sm text-zinc-200">
              {column.label}
            </span>
          </div>
          <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
            {tasks.length}
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all duration-300 ${column.color}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      <div className="flex-1 space-y-2 p-2">
        {tasks.map((task) => (
          <DraggableTaskCard
            key={task.id}
            onTaskClick={onTaskClick}
            task={task}
          />
        ))}
        {tasks.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-md border border-zinc-800 border-dashed text-[11px] text-zinc-600">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Draggable Task Card                                                        */
/* -------------------------------------------------------------------------- */

function DraggableTaskCard({
  task,
  onTaskClick,
  isDragOverlay = false,
}: {
  isDragOverlay?: boolean;
  onTaskClick?: (task: KanbanTask) => void;
  task: KanbanTask;
}) {
  const priority = PRIORITY_CONFIG[task.priority];
  const PriorityIcon = priority.icon;

  return (
    <button
      className={`group flex w-full flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-left transition-colors hover:border-zinc-700 ${
        isDragOverlay ? "shadow-black/50 shadow-lg" : ""
      }`}
      data-task-id={task.id}
      onClick={() => onTaskClick?.(task)}
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs text-zinc-200 leading-snug">{task.title}</span>
        <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-zinc-700 group-hover:text-zinc-500" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Priority badge */}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] ${priority.badge}`}
        >
          <PriorityIcon className="h-2.5 w-2.5" />
          {priority.label}
        </span>

        {/* Agent role */}
        {task.agentRole && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[9px] ${
              ROLE_COLORS[task.agentRole] ?? "bg-zinc-500/20 text-zinc-400"
            }`}
          >
            {task.agentRole}
          </span>
        )}

        {/* Time estimate */}
        {task.timeEstimate && (
          <span className="inline-flex items-center gap-0.5 text-[9px] text-zinc-600">
            <Clock className="h-2.5 w-2.5" />
            {task.timeEstimate}
          </span>
        )}
      </div>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Filter Bar                                                                 */
/* -------------------------------------------------------------------------- */

function FilterBar({
  filterRole,
  filterPriority,
  onFilterRole,
  onFilterPriority,
}: {
  filterPriority: string;
  filterRole: string;
  onFilterPriority: (priority: string) => void;
  onFilterRole: (role: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <Filter className="h-3.5 w-3.5 text-zinc-500" />

      <select
        className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-700"
        onChange={(e) => onFilterRole(e.target.value)}
        value={filterRole}
      >
        <option value="">All Roles</option>
        {ALL_ROLES.map((role) => (
          <option key={role} value={role}>
            {role}
          </option>
        ))}
      </select>

      <select
        className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-700"
        onChange={(e) => onFilterPriority(e.target.value)}
        value={filterPriority}
      >
        <option value="">All Priorities</option>
        {ALL_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Kanban Board                                                               */
/* -------------------------------------------------------------------------- */

export function KanbanBoard({
  tasks,
  onTaskMove,
  onTaskClick,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filterRole, setFilterRole] = useState("");
  const [filterPriority, setFilterPriority] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const filteredTasks = useMemo(() => {
    let result = tasks;
    if (filterRole) {
      result = result.filter((t) => t.agentRole === filterRole);
    }
    if (filterPriority) {
      result = result.filter((t) => t.priority === filterPriority);
    }
    return result;
  }, [tasks, filterRole, filterPriority]);

  const tasksByColumn = useMemo(() => {
    const grouped: Record<string, KanbanTask[]> = {};
    for (const col of COLUMNS) {
      grouped[col.id] = [];
    }
    for (const task of filteredTasks) {
      const bucket = grouped[task.status];
      if (bucket) {
        bucket.push(task);
      }
    }
    return grouped;
  }, [filteredTasks]);

  const activeTask = useMemo(
    () => tasks.find((t) => t.id === activeId) ?? null,
    [tasks, activeId]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);

      const { active, over } = event;
      if (!over) {
        return;
      }

      // Determine target column from the droppable area
      const overElement = document.querySelector(
        `[data-column-id="${String(over.id)}"]`
      );
      const targetColumn = overElement
        ? String(over.id)
        : // If dropped on a task card, find its parent column
          (() => {
            const taskEl = document.querySelector(
              `[data-task-id="${String(over.id)}"]`
            );
            const colEl = taskEl?.closest("[data-column-id]");
            return colEl?.getAttribute("data-column-id") ?? null;
          })();

      if (targetColumn) {
        const task = tasks.find((t) => t.id === String(active.id));
        if (task && task.status !== targetColumn) {
          onTaskMove(String(active.id), targetColumn);
        }
      }
    },
    [tasks, onTaskMove]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm text-zinc-200">Task Board</h3>
        <FilterBar
          filterPriority={filterPriority}
          filterRole={filterRole}
          onFilterPriority={setFilterPriority}
          onFilterRole={setFilterRole}
        />
      </div>

      {/* Board */}
      <DndContext
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        sensors={sensors}
      >
        <div className="grid grid-cols-4 gap-3">
          {COLUMNS.map((column) => (
            <DroppableColumn
              column={column}
              key={column.id}
              onTaskClick={onTaskClick}
              tasks={tasksByColumn[column.id] ?? []}
              totalTasks={filteredTasks.length}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask ? (
            <DraggableTaskCard isDragOverlay task={activeTask} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Summary */}
      <div className="flex items-center gap-4 text-[10px] text-zinc-600">
        <span>Total: {filteredTasks.length} tasks</span>
        {COLUMNS.map((col) => (
          <span key={col.id}>
            <span
              className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${col.color}`}
            />
            {col.label}: {tasksByColumn[col.id]?.length ?? 0}
          </span>
        ))}
      </div>
    </div>
  );
}
