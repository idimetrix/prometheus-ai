"use client";

import {
  BarChart3,
  FolderOpen,
  LayoutDashboard,
  Menu,
  Settings,
  X,
  Zap,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

/** Bottom tab bar items for mobile navigation */
const BOTTOM_TABS: Array<{
  href: Route;
  label: string;
  icon: ReactNode;
}> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  {
    href: "/dashboard/fleet",
    label: "Sessions",
    icon: <Zap className="h-5 w-5" />,
  },
  {
    href: "/dashboard/projects",
    label: "Projects",
    icon: <FolderOpen className="h-5 w-5" />,
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: <Settings className="h-5 w-5" />,
  },
];

/** Hamburger menu navigation items */
const MENU_ITEMS: Array<{
  href: Route;
  label: string;
  icon: ReactNode;
}> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-5 w-5" />,
  },
  {
    href: "/dashboard/projects",
    label: "Projects",
    icon: <FolderOpen className="h-5 w-5" />,
  },
  {
    href: "/dashboard/fleet",
    label: "Sessions",
    icon: <Zap className="h-5 w-5" />,
  },
  {
    href: "/dashboard/analytics",
    label: "Analytics",
    icon: <BarChart3 className="h-5 w-5" />,
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: <Settings className="h-5 w-5" />,
  },
];

interface MobileLayoutProps {
  children: ReactNode;
}

/**
 * Mobile navigation layout with hamburger menu and bottom tab bar.
 * Intended for use on viewports below the `md` breakpoint (< 768px).
 * Wraps page content with proper padding to avoid overlap with
 * the fixed bottom tab bar.
 */
export function MobileLayout({ children }: MobileLayoutProps) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  // Close menu on route change
  const currentPath = pathname;
  useEffect(() => {
    if (currentPath) {
      setMenuOpen(false);
    }
  }, [currentPath]);

  // Close menu on Escape key
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Mobile top bar with hamburger */}
      <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between border-zinc-800 border-b bg-background px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground text-xs">
            P
          </div>
          <span className="font-bold text-foreground text-sm tracking-wide">
            PROMETHEUS
          </span>
        </div>
        <button
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-zinc-400 hover:text-white"
          onClick={toggleMenu}
          type="button"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Slide-down menu overlay */}
      {menuOpen && (
        <>
          {/* Backdrop */}
          <button
            aria-label="Close menu overlay"
            className="fixed inset-0 z-30 cursor-default border-none bg-black/50"
            onClick={() => setMenuOpen(false)}
            type="button"
          />
          {/* Menu panel */}
          <nav className="fixed top-14 right-0 left-0 z-40 border-zinc-800 border-b bg-zinc-900 p-4">
            <ul className="space-y-1">
              {MENU_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href));
                return (
                  <li key={item.href}>
                    <Link
                      className={`flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        isActive
                          ? "bg-primary/10 font-medium text-primary"
                          : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
                      }`}
                      href={item.href}
                    >
                      {item.icon}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </>
      )}

      {/* Page content with bottom padding for tab bar */}
      <main className="flex-1 overflow-x-hidden px-4 pt-4 pb-20">
        {children}
      </main>

      {/* Bottom tab bar */}
      <nav
        aria-label="Bottom navigation"
        className="fixed right-0 bottom-0 left-0 z-40 flex h-16 items-center justify-around border-zinc-800 border-t bg-background"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {BOTTOM_TABS.map((tab) => {
          const isActive =
            pathname === tab.href ||
            (tab.href !== "/dashboard" && pathname.startsWith(tab.href));
          return (
            <Link
              className={`flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 px-2 text-[10px] transition-colors ${
                isActive
                  ? "font-semibold text-primary"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
              href={tab.href}
              key={tab.href}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
