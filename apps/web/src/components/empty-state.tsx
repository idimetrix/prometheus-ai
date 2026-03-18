import type { ReactNode } from "react";

interface EmptyStateProps {
  action?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
  description?: string;
  icon?: ReactNode;
  secondaryAction?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  title: string;
}

/** Default empty-state icon (plus in circle) */
function DefaultIcon() {
  return (
    <svg
      className="h-6 w-6 text-zinc-500"
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
  );
}

/**
 * Empty state component for pages and sections with no data.
 * Displays an icon, title, optional description, and action button(s).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className = "",
}: EmptyStateProps) {
  const ActionWrapper = ({
    config,
    variant,
  }: {
    config: NonNullable<EmptyStateProps["action"]>;
    variant: "primary" | "secondary";
  }) => {
    const baseClasses =
      variant === "primary"
        ? "rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
        : "rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800";

    if (config.href) {
      return (
        <a className={baseClasses} href={config.href}>
          {config.label}
        </a>
      );
    }

    return (
      <button className={baseClasses} onClick={config.onClick}>
        {config.label}
      </button>
    );
  };

  return (
    <div
      className={`rounded-xl border border-zinc-800 border-dashed bg-zinc-900/30 p-12 text-center ${className}`}
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800">
        {icon ?? <DefaultIcon />}
      </div>
      <h3 className="mt-4 font-medium text-sm text-zinc-400">{title}</h3>
      {description && (
        <p className="mt-1 text-xs text-zinc-600">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex justify-center gap-3">
          {action && <ActionWrapper config={action} variant="primary" />}
          {secondaryAction && (
            <ActionWrapper config={secondaryAction} variant="secondary" />
          )}
        </div>
      )}
    </div>
  );
}

/** Pre-configured empty states for common scenarios */

export function EmptyProjects() {
  return (
    <EmptyState
      action={{ label: "Create Project", href: "/dashboard/projects/new" }}
      description="Create your first project to get started."
      icon={
        <svg
          className="h-6 w-6 text-zinc-500"
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
      }
      title="No projects yet"
    />
  );
}

export function EmptySessions() {
  return (
    <EmptyState
      action={{ label: "New Task", href: "/dashboard/projects/new" }}
      description="Start a new task to see agent sessions here."
      icon={
        <svg
          className="h-6 w-6 text-zinc-500"
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
      }
      title="No active sessions"
    />
  );
}

export function EmptyNotifications() {
  return (
    <EmptyState
      description="You're all caught up."
      icon={
        <svg
          className="h-6 w-6 text-zinc-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      }
      title="No notifications"
    />
  );
}

export function EmptySearchResults({ query }: { query: string }) {
  return (
    <EmptyState
      description="Try a different search term or check your filters."
      icon={
        <svg
          className="h-6 w-6 text-zinc-500"
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
      }
      title={`No results for "${query}"`}
    />
  );
}
