"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { logger } from "@/lib/logger";

/* -------------------------------------------------------------------------- */
/*  Error categorization                                                       */
/* -------------------------------------------------------------------------- */

type ErrorCategory = "network" | "auth" | "server" | "client" | "unknown";

interface CategorizedError {
  category: ErrorCategory;
  message: string;
  statusCode?: number;
  suggestion: string;
}

function categorizeError(error: Error): CategorizedError {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Network errors
  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("failed to fetch") ||
    message.includes("net::err") ||
    message.includes("timeout") ||
    name === "typeerror"
  ) {
    return {
      category: "network",
      message: "Unable to connect to the server",
      suggestion:
        "Check your internet connection and try again. If the problem persists, our servers may be experiencing issues.",
    };
  }

  // Auth errors
  if (
    message.includes("unauthorized") ||
    message.includes("401") ||
    message.includes("forbidden") ||
    message.includes("403") ||
    message.includes("session expired") ||
    message.includes("not authenticated")
  ) {
    return {
      category: "auth",
      message: "Authentication required",
      statusCode: message.includes("403") ? 403 : 401,
      suggestion: "Your session may have expired. Try signing in again.",
    };
  }

  // Server errors
  if (
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("internal server error") ||
    message.includes("service unavailable")
  ) {
    let statusCode = 500;
    if (message.includes("502")) {
      statusCode = 502;
    } else if (message.includes("503")) {
      statusCode = 503;
    } else if (message.includes("504")) {
      statusCode = 504;
    }
    return {
      category: "server",
      message: "Server error occurred",
      statusCode,
      suggestion:
        "Our servers are experiencing issues. Please try again in a few moments.",
    };
  }

  // Client / rendering errors
  return {
    category: "client",
    message: error.message || "An unexpected error occurred",
    suggestion:
      "Try refreshing the page. If the issue continues, please report it to our team.",
  };
}

const CATEGORY_ICONS: Record<ErrorCategory, { color: string; label: string }> =
  {
    network: { color: "text-orange-400", label: "Network Error" },
    auth: { color: "text-yellow-400", label: "Authentication Error" },
    server: { color: "text-red-400", label: "Server Error" },
    client: { color: "text-red-400", label: "Application Error" },
    unknown: { color: "text-zinc-400", label: "Error" },
  };

/* -------------------------------------------------------------------------- */
/*  Error telemetry                                                            */
/* -------------------------------------------------------------------------- */

function reportErrorTelemetry(error: Error, errorInfo: ErrorInfo): void {
  try {
    const payload = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      url: typeof window === "undefined" ? "" : window.location.href,
      timestamp: new Date().toISOString(),
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    };

    // Fire-and-forget to telemetry endpoint
    if (typeof fetch !== "undefined") {
      fetch("/api/telemetry/errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch(() => {
        // Silently fail - we do not want error reporting to cause errors
      });
    }
  } catch {
    // Silently fail
  }
}

/* -------------------------------------------------------------------------- */
/*  Toast notification for non-critical errors                                 */
/* -------------------------------------------------------------------------- */

export function ErrorToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className="slide-in-from-bottom-5 fixed right-4 bottom-4 z-50 flex max-w-sm animate-in items-start gap-3 rounded-lg border border-red-500/20 bg-zinc-900 p-4 shadow-2xl">
      <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/10">
        <svg
          aria-hidden="true"
          className="h-3 w-3 text-red-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-zinc-200">{message}</p>
      </div>
      <button
        className="shrink-0 text-zinc-500 hover:text-zinc-300"
        onClick={onDismiss}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            d="M6 18 18 6M6 6l12 12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Error boundary props & state                                               */
/* -------------------------------------------------------------------------- */

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Context label (e.g., "session", "dashboard") for contextual messaging */
  context?: "session" | "dashboard" | "settings" | "project" | "general";
  fallback?: ReactNode;
  /** Whether to show the "Resume Session" option */
  isSessionContext?: boolean;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  /** Callback when resume is clicked (session context) */
  onResumeSession?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  hasError: boolean;
  showReportForm: boolean;
}

/* -------------------------------------------------------------------------- */
/*  ErrorBoundary component                                                    */
/* -------------------------------------------------------------------------- */

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, showReportForm: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    logger.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);

    // Send telemetry
    reportErrorTelemetry(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, showReportForm: false });
  };

  handleGoHome = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/";
    }
  };

  handleToggleReport = () => {
    this.setState((prev) => ({ showReportForm: !prev.showReportForm }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const categorized = this.state.error
        ? categorizeError(this.state.error)
        : {
            category: "unknown" as ErrorCategory,
            message: "An unexpected error occurred",
            suggestion: "Try refreshing the page.",
          };

      const categoryInfo =
        CATEGORY_ICONS[categorized.category] ?? CATEGORY_ICONS.unknown;

      return (
        <div className="flex min-h-[300px] items-center justify-center p-8">
          <div className="max-w-lg text-center">
            {/* Icon */}
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10">
              <svg
                aria-hidden="true"
                className="h-7 w-7 text-red-500"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Category badge */}
            <div className="mt-3 flex items-center justify-center gap-2">
              <span
                className={`rounded-full px-2.5 py-0.5 font-medium text-[10px] ${categoryInfo.color} bg-zinc-800`}
              >
                {categoryInfo.label}
              </span>
              {categorized.statusCode && (
                <span className="rounded-full bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-500">
                  {categorized.statusCode}
                </span>
              )}
            </div>

            {/* Error message */}
            <h3 className="mt-4 font-semibold text-lg text-zinc-200">
              {categorized.message}
            </h3>
            <p className="mt-2 text-sm text-zinc-500">
              {categorized.suggestion}
            </p>

            {/* Action buttons */}
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {/* Retry */}
              <button
                className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-700"
                onClick={this.handleRetry}
                type="button"
              >
                Retry
              </button>

              {/* Resume Session (only in session context) */}
              {this.props.isSessionContext && this.props.onResumeSession && (
                <button
                  className="rounded-lg bg-blue-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-blue-700"
                  onClick={this.props.onResumeSession}
                  type="button"
                >
                  Resume Session
                </button>
              )}

              {/* Report Issue */}
              <button
                className="rounded-lg border border-zinc-700 px-4 py-2 font-medium text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
                onClick={this.handleToggleReport}
                type="button"
              >
                Report Issue
              </button>

              {/* Go Home */}
              <button
                className="rounded-lg border border-zinc-700 px-4 py-2 font-medium text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
                onClick={this.handleGoHome}
                type="button"
              >
                Go Home
              </button>
            </div>

            {/* Report form */}
            {this.state.showReportForm && (
              <div className="mt-6 rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-left">
                <h4 className="font-medium text-sm text-zinc-300">
                  Report this issue
                </h4>
                <p className="mt-1 text-xs text-zinc-500">
                  Help us fix this by describing what you were doing when the
                  error occurred.
                </p>
                <textarea
                  className="mt-3 w-full resize-none rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none"
                  placeholder="What were you doing when this happened?"
                  rows={3}
                />
                <div className="mt-3 flex justify-end">
                  <button
                    className="rounded-md bg-violet-600 px-3 py-1.5 font-medium text-white text-xs transition-colors hover:bg-violet-700"
                    onClick={this.handleToggleReport}
                    type="button"
                  >
                    Submit Report
                  </button>
                </div>
              </div>
            )}

            {/* Dev-only stack trace */}
            {process.env.NODE_ENV === "development" && this.state.error && (
              <pre className="mt-6 max-h-40 overflow-auto rounded-lg bg-zinc-950 p-4 text-left font-mono text-red-400 text-xs">
                {this.state.error.stack}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/** Functional wrapper for convenience */
export function withErrorBoundary<P extends Record<string, unknown>>(
  WrappedComponent: React.ComponentType<P>,
  fallback?: ReactNode
) {
  const displayName =
    WrappedComponent.displayName || WrappedComponent.name || "Component";

  function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary fallback={fallback}>
        <WrappedComponent {...props} />
      </ErrorBoundary>
    );
  }

  WithErrorBoundaryWrapper.displayName = `withErrorBoundary(${displayName})`;
  return WithErrorBoundaryWrapper;
}
