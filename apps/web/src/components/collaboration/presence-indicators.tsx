"use client";

import Image from "next/image";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface PresenceUser {
  avatarUrl?: string;
  color: string;
  cursorPosition?: { x: number; y: number };
  id: string;
  isActive: boolean;
  name: string;
}

interface PresenceIndicatorsProps {
  className?: string;
  currentUserId: string;
  maxAvatars?: number;
  showCursors?: boolean;
  users: PresenceUser[];
}

/* -------------------------------------------------------------------------- */
/*  Avatar Component                                                           */
/* -------------------------------------------------------------------------- */

function UserAvatar({ user }: { user: PresenceUser }) {
  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div
      className="relative flex h-8 w-8 items-center justify-center rounded-full border-2 border-background font-medium text-white text-xs"
      style={{ backgroundColor: user.color }}
      title={user.name}
    >
      {user.avatarUrl ? (
        <Image
          alt={user.name}
          className="h-full w-full rounded-full object-cover"
          height={32}
          src={user.avatarUrl}
          unoptimized
          width={32}
        />
      ) : (
        initials
      )}
      {/* Activity indicator */}
      <span
        className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
          user.isActive ? "bg-green-500" : "bg-zinc-500"
        }`}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Cursor Overlay                                                             */
/* -------------------------------------------------------------------------- */

function CursorOverlay({ user }: { user: PresenceUser }) {
  if (!user.cursorPosition) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute z-50"
      style={{
        left: user.cursorPosition.x,
        top: user.cursorPosition.y,
      }}
    >
      {/* Cursor arrow */}
      <div
        className="h-4 w-3"
        style={{
          borderLeft: `2px solid ${user.color}`,
          borderTop: `2px solid ${user.color}`,
        }}
      />
      {/* Name label */}
      <div
        className="mt-0.5 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] text-white"
        style={{ backgroundColor: user.color }}
      >
        {user.name}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main Component                                                             */
/* -------------------------------------------------------------------------- */

export function PresenceIndicators({
  users,
  currentUserId,
  maxAvatars = 5,
  showCursors = true,
  className = "",
}: PresenceIndicatorsProps) {
  const otherUsers = users.filter((u) => u.id !== currentUserId);
  const visibleUsers = otherUsers.slice(0, maxAvatars);
  const overflowCount = Math.max(0, otherUsers.length - maxAvatars);
  const activeCount = otherUsers.filter((u) => u.isActive).length;

  return (
    <>
      {/* Avatar row */}
      <div className={`flex items-center gap-1 ${className}`}>
        {activeCount > 0 && (
          <span className="mr-1 text-xs text-zinc-500">
            {activeCount} online
          </span>
        )}
        <div className="flex -space-x-2">
          {visibleUsers.map((user) => (
            <UserAvatar key={user.id} user={user} />
          ))}
          {overflowCount > 0 && (
            <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-zinc-700 text-xs text-zinc-300">
              +{overflowCount}
            </div>
          )}
        </div>
      </div>

      {/* Cursor overlays */}
      {showCursors &&
        otherUsers
          .filter((u) => u.cursorPosition)
          .map((user) => (
            <CursorOverlay key={`cursor-${user.id}`} user={user} />
          ))}
    </>
  );
}

export type { PresenceIndicatorsProps, PresenceUser };
