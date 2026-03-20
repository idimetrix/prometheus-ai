/**
 * AI Elements configuration module.
 *
 * Defines theme tokens, color palettes, and component style overrides
 * for AI-related UI elements that integrate with the existing shadcn/ui theme.
 */

/* -------------------------------------------------------------------------- */
/*  Color Tokens                                                               */
/* -------------------------------------------------------------------------- */

export const aiColorTokens = {
  /** Agent status indicator colors */
  agent: {
    active: "hsl(142 76% 46%)",
    error: "hsl(0 84% 60%)",
    idle: "hsl(215 20% 65%)",
    thinking: "hsl(45 93% 58%)",
    waiting: "hsl(199 89% 48%)",
  },

  /** Code diff highlighting */
  diff: {
    addedBg: "hsl(142 76% 36% / 0.15)",
    addedBorder: "hsl(142 76% 46% / 0.4)",
    removedBg: "hsl(0 84% 60% / 0.15)",
    removedBorder: "hsl(0 84% 60% / 0.4)",
  },

  /** Message bubble colors */
  message: {
    assistantBg: "hsl(215 28% 17%)",
    systemBg: "hsl(45 93% 58% / 0.1)",
    toolBg: "hsl(262 83% 58% / 0.1)",
    userBg: "hsl(199 89% 48% / 0.1)",
  },

  /** Streaming animation accents */
  streaming: {
    cursor: "hsl(199 89% 48%)",
    pulse: "hsl(262 83% 58%)",
  },

  /** Token usage severity levels */
  tokenUsage: {
    critical: "hsl(0 84% 60%)",
    high: "hsl(25 95% 53%)",
    low: "hsl(142 76% 46%)",
    medium: "hsl(45 93% 58%)",
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  Typography                                                                 */
/* -------------------------------------------------------------------------- */

export const aiTypography = {
  code: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "0.8125rem",
    lineHeight: "1.5",
  },
  message: {
    fontFamily: "var(--font-sans, system-ui, sans-serif)",
    fontSize: "0.875rem",
    lineHeight: "1.625",
  },
  terminal: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "0.75rem",
    lineHeight: "1.4",
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  Component Style Overrides                                                  */
/* -------------------------------------------------------------------------- */

export const aiComponentStyles = {
  codeBlock: {
    borderRadius: "0.5rem",
    headerBg: "hsl(215 28% 13%)",
    maxHeight: "400px",
  },
  fileTree: {
    indentSize: "1rem",
    itemHeight: "1.75rem",
  },
  messageThread: {
    gap: "0.75rem",
    maxWidth: "48rem",
    padding: "1rem",
  },
  planViewer: {
    nodeSize: "2rem",
    progressHeight: "4px",
  },
  promptInput: {
    maxHeight: "12rem",
    minHeight: "2.5rem",
  },
  terminal: {
    maxHeight: "20rem",
    scrollPadding: "0.5rem",
  },
} as const;

/* -------------------------------------------------------------------------- */
/*  Animation Durations                                                        */
/* -------------------------------------------------------------------------- */

export const aiAnimations = {
  cursorBlink: "1s",
  fadeIn: "150ms",
  slideIn: "200ms",
  streamingPulse: "2s",
  tokenReveal: "50ms",
} as const;

/* -------------------------------------------------------------------------- */
/*  Utility helpers                                                            */
/* -------------------------------------------------------------------------- */

/** Return a Tailwind-friendly class string for agent status colors. */
export function agentStatusClass(
  status: "active" | "idle" | "thinking" | "waiting" | "error"
): string {
  const map: Record<typeof status, string> = {
    active: "bg-green-500",
    error: "bg-red-500",
    idle: "bg-zinc-400",
    thinking: "bg-yellow-400 animate-pulse",
    waiting: "bg-blue-400 animate-pulse",
  };
  return map[status];
}

/** Return a Tailwind-friendly class string for token usage severity. */
export function tokenUsageClass(percentage: number): string {
  if (percentage >= 90) {
    return "text-red-500";
  }
  if (percentage >= 70) {
    return "text-orange-500";
  }
  if (percentage >= 50) {
    return "text-yellow-500";
  }
  return "text-green-500";
}
