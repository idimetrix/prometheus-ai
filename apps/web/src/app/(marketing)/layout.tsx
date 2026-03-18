import Link from "next/link";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950">
      <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600 text-sm font-bold text-white">
              P
            </div>
            <span className="text-lg font-bold text-zinc-100">PROMETHEUS</span>
          </Link>
          <nav className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
            >
              Pricing
            </Link>
            <Link
              href="/about"
              className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
            >
              About
            </Link>
            <Link
              href="/sign-in"
              className="text-sm font-medium text-zinc-200 hover:text-white"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700"
            >
              Get Started
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-zinc-800 py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded bg-violet-600 text-xs font-bold text-white">
                  P
                </div>
                <span className="text-sm font-bold text-zinc-200">PROMETHEUS</span>
              </div>
              <p className="mt-3 text-xs text-zinc-500">
                AI engineering platform with 12 specialist agents.
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Product</h4>
              <div className="mt-3 space-y-2">
                <Link href="/pricing" className="block text-sm text-zinc-500 hover:text-zinc-300">Pricing</Link>
                <Link href="/about" className="block text-sm text-zinc-500 hover:text-zinc-300">About</Link>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Developers</h4>
              <div className="mt-3 space-y-2">
                <span className="block text-sm text-zinc-500">Documentation</span>
                <span className="block text-sm text-zinc-500">API Reference</span>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">Company</h4>
              <div className="mt-3 space-y-2">
                <span className="block text-sm text-zinc-500">Privacy</span>
                <span className="block text-sm text-zinc-500">Terms</span>
              </div>
            </div>
          </div>
          <div className="mt-8 border-t border-zinc-800 pt-8 text-center text-xs text-zinc-600">
            &copy; {new Date().getFullYear()} PROMETHEUS. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
