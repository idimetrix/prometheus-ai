"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { BadgeProps } from "@prometheus/ui";
import { Badge } from "@prometheus/ui";
import { GripVertical } from "lucide-react";
import { useState } from "react";

function getBadgeVariant(status: string): NonNullable<BadgeProps["variant"]> {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "destructive";
  }
  return "outline";
}

interface FleetTask {
  agentRole?: string;
  creditsConsumed?: number;
  id: string;
  status: string;
  title: string;
}

interface SortableTaskListProps {
  onReorder?: (taskIds: string[]) => void;
  tasks: FleetTask[];
}

const ROLE_COLORS: Record<string, string> = {
  orchestrator: "bg-violet-500/20 text-violet-400",
  discovery: "bg-blue-500/20 text-blue-400",
  architect: "bg-indigo-500/20 text-indigo-400",
  frontend: "bg-cyan-500/20 text-cyan-400",
  backend: "bg-green-500/20 text-green-400",
  testing: "bg-pink-500/20 text-pink-400",
  security: "bg-red-500/20 text-red-400",
  deployment: "bg-emerald-500/20 text-emerald-400",
};

function SortableTask({ task }: { task: FleetTask }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-muted-foreground/30"
      ref={setNodeRef}
      style={style}
    >
      <button
        aria-label="Drag to reorder"
        className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
        type="button"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-foreground text-sm">{task.title}</div>
        <div className="mt-0.5 flex items-center gap-2">
          {task.agentRole && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                ROLE_COLORS[task.agentRole] ?? "bg-muted text-muted-foreground"
              }`}
            >
              {task.agentRole}
            </span>
          )}
          <Badge variant={getBadgeVariant(task.status)}>{task.status}</Badge>
        </div>
      </div>
      {task.creditsConsumed !== undefined && (
        <span className="font-mono text-muted-foreground text-xs">
          {task.creditsConsumed}c
        </span>
      )}
    </div>
  );
}

export function SortableTaskList({ tasks, onReorder }: SortableTaskListProps) {
  const [items, setItems] = useState(tasks);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    setItems((prev) => {
      const oldIndex = prev.findIndex((t) => t.id === active.id);
      const newIndex = prev.findIndex((t) => t.id === over.id);
      const reordered = arrayMove(prev, oldIndex, newIndex);
      onReorder?.(reordered.map((t) => t.id));
      return reordered;
    });
  }

  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      sensors={sensors}
    >
      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {items.map((task) => (
            <SortableTask key={task.id} task={task} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
