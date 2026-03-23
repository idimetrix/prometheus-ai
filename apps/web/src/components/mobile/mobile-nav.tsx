"use client";

import { useCallback } from "react";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface NavItem {
  badge?: number;
  icon: string;
  id: string;
  label: string;
}

interface MobileNavProps {
  activeId: string;
  className?: string;
  items: NavItem[];
  onNavigate: (id: string) => void;
}

/* -------------------------------------------------------------------------- */
/*  Component                                                                  */
/* -------------------------------------------------------------------------- */

export function MobileNav({
  items,
  activeId,
  onNavigate,
  className = "",
}: MobileNavProps) {
  const handleClick = useCallback(
    (id: string) => {
      onNavigate(id);
    },
    [onNavigate]
  );

  return (
    <nav
      className={`fixed right-0 bottom-0 left-0 z-50 border-zinc-800 border-t bg-zinc-950/95 backdrop-blur md:hidden ${className}`}
    >
      <div className="flex items-center justify-around px-2 py-1">
        {items.map((item) => {
          const isActive = item.id === activeId;
          return (
            <button
              aria-label={item.label}
              className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 ${
                isActive ? "text-blue-400" : "text-zinc-500"
              }`}
              key={item.id}
              onClick={() => handleClick(item.id)}
              type="button"
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-[10px]">{item.label}</span>
              {item.badge !== undefined && item.badge > 0 && (
                <span className="absolute top-1 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] text-white">
                  {item.badge > 99 ? "99+" : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Safe area spacer for notched devices */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}

export type { MobileNavProps, NavItem };
