import type { Route } from "next";
import Link from "next/link";

export default function TryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Minimal header */}
      <header className="flex h-14 items-center justify-between border-b px-6">
        <Link
          className="flex items-center gap-2 font-bold text-foreground text-lg"
          href={"/" as Route}
        >
          <span className="bg-gradient-to-r from-violet-500 to-purple-600 bg-clip-text text-transparent">
            PROMETHEUS
          </span>
        </Link>
        <Link
          className="rounded-lg border px-4 py-2 text-foreground text-sm transition-colors hover:bg-muted"
          href={"/sign-in" as Route}
        >
          Sign In
        </Link>
      </header>

      {/* Full-width content area */}
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
