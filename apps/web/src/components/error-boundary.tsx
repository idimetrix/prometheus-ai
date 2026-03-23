"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[300px] items-center justify-center p-8">
          <div className="max-w-md text-center">
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
            <h3 className="mt-4 font-semibold text-lg text-zinc-200">
              Something went wrong
            </h3>
            <p className="mt-2 text-sm text-zinc-500">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-700"
                onClick={this.handleRetry}
                type="button"
              >
                Try Again
              </button>
              <button
                className="rounded-lg border border-zinc-700 px-4 py-2 font-medium text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
                onClick={() => window.location.reload()}
                type="button"
              >
                Reload Page
              </button>
            </div>
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
