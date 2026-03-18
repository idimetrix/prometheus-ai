import type { Route } from "next";
import Link from "next/link";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <header className="sticky top-0 z-50 w-full border-zinc-800 border-b bg-zinc-950/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link className="flex items-center gap-2" href="/">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 font-bold text-sm text-white">
              P
            </div>
            <span className="font-bold text-lg text-zinc-100">PROMETHEUS</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
              href="/features"
            >
              Features
            </Link>
            <Link
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
              href="/pricing"
            >
              Pricing
            </Link>
            <Link
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
              href="/about"
            >
              About
            </Link>
            <Link
              className="font-medium text-sm text-zinc-200 hover:text-white"
              href={"/sign-in" as Route}
            >
              Sign In
            </Link>
            <Link
              className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-700"
              href={"/sign-up" as Route}
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-zinc-800 border-t py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-600 font-bold text-white text-xs">
                  P
                </div>
                <span className="font-bold text-sm text-zinc-200">
                  PROMETHEUS
                </span>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                AI engineering platform with 12 specialist agents.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                Product
              </h4>
              <div className="mt-3 space-y-2">
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href="/features"
                >
                  Features
                </Link>
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href="/pricing"
                >
                  Pricing
                </Link>
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href="/about"
                >
                  About
                </Link>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                Developers
              </h4>
              <div className="mt-3 space-y-2">
                <span className="block text-sm text-zinc-500">
                  Documentation
                </span>
                <span className="block text-sm text-zinc-500">
                  API Reference
                </span>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                Company
              </h4>
              <div className="mt-3 space-y-2">
                <span className="block text-sm text-zinc-500">Privacy</span>
                <span className="block text-sm text-zinc-500">Terms</span>
              </div>
            </div>
          </div>
          <div className="mt-8 border-zinc-800 border-t pt-8 text-center text-xs text-zinc-600">
            &copy; {new Date().getFullYear()} PROMETHEUS. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
