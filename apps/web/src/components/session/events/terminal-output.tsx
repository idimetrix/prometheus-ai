"use client";

import type { SessionEvent } from "@/stores/session.store";

interface TerminalOutputProps {
  event: SessionEvent;
}

/**
 * ANSI color code parser for basic terminal colors.
 * Supports: bold, red, green, yellow, blue, cyan, reset.
 */
function parseAnsi(text: string): Array<{ text: string; className: string }> {
  const segments: Array<{ text: string; className: string }> = [];
  // Match ANSI escape sequences
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI escape sequence matching
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  let lastIndex = 0;
  let currentClass = "text-zinc-300";
  let match: RegExpExecArray | null = ansiRegex.exec(text);

  while (match !== null) {
    // Push text before this escape sequence
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        className: currentClass,
      });
    }

    const codes = (match[1] ?? "").split(";").map(Number);
    for (const code of codes) {
      switch (code) {
        case 0:
          currentClass = "text-zinc-300";
          break;
        case 1:
          currentClass += " font-bold";
          break;
        case 31:
          currentClass = "text-red-400";
          break;
        case 32:
          currentClass = "text-green-400";
          break;
        case 33:
          currentClass = "text-yellow-400";
          break;
        case 34:
          currentClass = "text-blue-400";
          break;
        case 36:
          currentClass = "text-cyan-400";
          break;
        case 90:
          currentClass = "text-zinc-500";
          break;
        default:
          break;
      }
    }

    lastIndex = match.index + match[0].length;
    match = ansiRegex.exec(text);
  }

  // Push remaining text
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      className: currentClass,
    });
  }

  if (segments.length === 0) {
    segments.push({ text, className: "text-zinc-300" });
  }

  return segments;
}

export function TerminalOutput({ event }: TerminalOutputProps) {
  const content = (event.data.content as string) ?? "";
  const command = (event.data.command as string) ?? "";
  const exitCode = event.data.exitCode as number | undefined;
  const segments = parseAnsi(content);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2 font-mono">
      {command && (
        <div className="mb-1 flex items-center gap-1.5 text-[10px]">
          <span className="text-green-400">$</span>
          <span className="text-zinc-300">{command}</span>
          {exitCode !== undefined && exitCode !== 0 && (
            <span className="ml-auto rounded bg-red-500/10 px-1 py-0.5 text-red-400">
              exit {exitCode}
            </span>
          )}
        </div>
      )}
      <div className="whitespace-pre-wrap text-[11px] leading-relaxed">
        {Array.from(segments.entries()).map(([segNum, seg]) => (
          <span className={seg.className} key={`segment-${segNum}`}>
            {seg.text}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Exported ANSI parser for use in the live terminal panel.
 */
export { parseAnsi };
