"use client";

import { useUser } from "@clerk/nextjs";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ScrollArea,
  Separator,
  TooltipProvider,
} from "@prometheus/ui";
import {
  BarChart3,
  Cpu,
  FolderOpen,
  LayoutDashboard,
  MessageSquare,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/command-palette";
import { MobileLayout } from "@/components/layout/mobile-layout";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useIsMobile } from "@/hooks/use-breakpoint";
import { useDashboardStore } from "@/stores/dashboard.store";

const NAV_ITEMS: Array<{
  href: Route;
  label: string;
  icon: React.ReactNode;
}> = [
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: <LayoutDashboard className="h-4 w-4" />,
  },
  {
    href: "/new" as Route,
    label: "New Task",
    icon: <Plus className="h-4 w-4" />,
  },
  {
    href: "/dashboard/projects",
    label: "Projects",
    icon: <FolderOpen className="h-4 w-4" />,
  },
  {
    href: "/dashboard/sessions" as Route,
    label: "Sessions",
    icon: <MessageSquare className="h-4 w-4" />,
  },
  {
    href: "/dashboard/fleet",
    label: "Fleet",
    icon: <Cpu className="h-4 w-4" />,
  },
  {
    href: "/dashboard/analytics",
    label: "Analytics",
    icon: <BarChart3 className="h-4 w-4" />,
  },
  {
    href: "/dashboard/settings",
    label: "Settings",
    icon: <Settings className="h-4 w-4" />,
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { user } = useUser();
  const { activeAgents, creditBalance } = useDashboardStore();
  const [commandOpen, setCommandOpen] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((prev) => !prev);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Mobile layout: use dedicated mobile component
  if (isMobile) {
    return (
      <TooltipProvider>
        <MobileLayout>{children}</MobileLayout>
        <CommandPalette onOpenChange={setCommandOpen} open={commandOpen} />
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background">
        {/* Sidebar — hidden on mobile via the isMobile check above */}
        <aside className="hidden w-60 flex-col border-r bg-background md:flex">
          {/* Logo */}
          <div className="flex h-14 items-center gap-2 border-b px-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary font-bold text-primary-foreground text-xs">
              P
            </div>
            <span className="font-bold text-foreground text-sm tracking-wide">
              PROMETHEUS
            </span>
          </div>

          {/* Navigation */}
          <ScrollArea className="flex-1">
            <nav className="space-y-0.5 px-2 py-3">
              {NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" &&
                    pathname.startsWith(item.href));
                return (
                  <Link
                    className={`flex min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    }`}
                    href={item.href}
                    key={item.href}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </ScrollArea>

          {/* Command palette hint */}
          <div className="border-t px-3 py-3">
            <Button
              className="w-full justify-start gap-2 text-muted-foreground"
              onClick={() => setCommandOpen(true)}
              size="sm"
              variant="outline"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="flex-1 text-left text-xs">Search...</span>
              <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">
                {"\u2318"}K
              </kbd>
            </Button>
          </div>

          {/* User section */}
          <Separator />
          <div className="px-3 py-3">
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">
                  {user?.firstName?.[0] ??
                    user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ??
                    "U"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground text-xs">
                  {user?.firstName ?? "User"}
                </div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {"Personal"}
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Top bar */}
          <header className="flex h-14 shrink-0 items-center justify-between border-b bg-background px-4 md:px-6">
            <div className="flex items-center gap-4">
              <h1 className="font-medium text-foreground text-sm">
                {"Personal Workspace"}
              </h1>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <NotificationBell />
              {/* Active agents badge */}
              <Badge variant={activeAgents > 0 ? "success" : "outline"}>
                <span
                  className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
                    activeAgents > 0
                      ? "animate-pulse bg-green-500"
                      : "bg-muted-foreground"
                  }`}
                />
                {activeAgents} agent{activeAgents === 1 ? "" : "s"}
              </Badge>
              {/* Credit balance */}
              <Badge variant="outline">
                <span className="mr-1 text-warning">$</span>
                <span className="font-medium">
                  {creditBalance.toLocaleString()}
                </span>
                <span className="ml-1 hidden text-muted-foreground sm:inline">
                  credits
                </span>
              </Badge>
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-auto p-4 md:p-6">{children}</main>
        </div>

        {/* Command palette */}
        <CommandPalette onOpenChange={setCommandOpen} open={commandOpen} />
      </div>
    </TooltipProvider>
  );
}
