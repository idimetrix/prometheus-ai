"use client";

import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

const NAV_LINKS: Array<{ href: string; label: string }> = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
  { href: "/benchmarks", label: "Benchmarks" },
];

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMobile = () => setMobileOpen(false);

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

          {/* Desktop nav */}
          <nav className="hidden items-center gap-6 md:flex">
            {NAV_LINKS.map((link) => (
              <Link
                className="text-sm text-zinc-400 transition-colors hover:text-zinc-200"
                href={link.href as Route}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
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

          {/* Mobile hamburger */}
          <button
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 md:hidden"
            onClick={() => setMobileOpen((prev) => !prev)}
            type="button"
          >
            {mobileOpen ? (
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
              </svg>
            ) : (
              <svg
                aria-hidden="true"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <nav className="border-zinc-800 border-t bg-zinc-950 px-6 pt-2 pb-4 md:hidden">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  className="rounded-lg px-3 py-2.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
                  href={link.href as Route}
                  key={link.href}
                  onClick={closeMobile}
                >
                  {link.label}
                </Link>
              ))}
              <div className="my-2 border-zinc-800 border-t" />
              <Link
                className="rounded-lg px-3 py-2.5 font-medium text-sm text-zinc-200 hover:bg-zinc-900"
                href={"/sign-in" as Route}
                onClick={closeMobile}
              >
                Sign In
              </Link>
              <Link
                className="mt-1 rounded-lg bg-violet-600 px-3 py-2.5 text-center font-medium text-sm text-white transition-colors hover:bg-violet-700"
                href={"/sign-up" as Route}
                onClick={closeMobile}
              >
                Get Started
              </Link>
            </div>
          </nav>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-zinc-800 border-t py-12">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid gap-8 sm:grid-cols-2 md:grid-cols-4">
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
                  href={"/features" as Route}
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
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href={"/benchmarks" as Route}
                >
                  Benchmarks
                </Link>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                Developers
              </h4>
              <div className="mt-3 space-y-2">
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href={"/docs" as Route}
                >
                  Documentation
                </Link>
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href={"/docs/api" as Route}
                >
                  API Reference
                </Link>
              </div>
            </div>
            <div>
              <h4 className="font-semibold text-xs text-zinc-400 uppercase tracking-wider">
                Company
              </h4>
              <div className="mt-3 space-y-2">
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href={"/privacy" as Route}
                >
                  Privacy
                </Link>
                <Link
                  className="block text-sm text-zinc-500 hover:text-zinc-300"
                  href={"/terms" as Route}
                >
                  Terms
                </Link>
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
