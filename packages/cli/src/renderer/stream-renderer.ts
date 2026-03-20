/**
 * Rich terminal output renderer for streaming agent responses.
 * Handles text deltas, code blocks, tool calls, progress, and status messages.
 */
export class StreamRenderer {
  private currentLine = "";

  /**
   * Stream a text delta with basic markdown awareness.
   */
  renderTextDelta(text: string): void {
    this.currentLine += text;
    process.stdout.write(text);

    if (text.includes("\n")) {
      this.currentLine = text.split("\n").pop() ?? "";
    }
  }

  /**
   * Render a code block with language label.
   */
  renderCodeBlock(code: string, language?: string): void {
    const header = language ? ` ${language}` : "";
    process.stdout.write(`\n---${header}---\n`);
    process.stdout.write(code);
    if (!code.endsWith("\n")) {
      process.stdout.write("\n");
    }
    process.stdout.write("---\n\n");
    this.currentLine = "";
  }

  /**
   * Render a tool call execution start.
   */
  renderToolCall(name: string, args?: Record<string, unknown>): void {
    const argsStr = args
      ? ` ${Object.entries(args)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(" ")}`
      : "";
    process.stdout.write(`\n  [TOOL] ${name}${argsStr}\n`);
    this.currentLine = "";
  }

  /**
   * Render a tool call result.
   */
  renderToolResult(name: string, result: string, success: boolean): void {
    const status = success ? "OK" : "FAIL";
    process.stdout.write(`  [${status}] ${name}: ${result}\n\n`);
    this.currentLine = "";
  }

  /**
   * Render a progress bar.
   */
  renderProgress(step: number, total: number, message: string): void {
    const barWidth = 30;
    const progress = total > 0 ? step / total : 0;
    const filled = Math.round(progress * barWidth);
    const empty = barWidth - filled;
    const bar = `[${"#".repeat(filled)}${"-".repeat(empty)}]`;
    const percent = Math.round(progress * 100);

    process.stdout.write(`\r  ${bar} ${percent}% ${message}`.padEnd(80));

    if (step >= total) {
      process.stdout.write("\n");
    }
    this.currentLine = "";
  }

  /**
   * Render an error message.
   */
  renderError(message: string): void {
    process.stdout.write(`\n  [ERROR] ${message}\n\n`);
    this.currentLine = "";
  }

  /**
   * Render a success message.
   */
  renderSuccess(message: string): void {
    process.stdout.write(`\n  [OK] ${message}\n\n`);
    this.currentLine = "";
  }

  /**
   * Render an info message.
   */
  renderInfo(message: string): void {
    process.stdout.write(`\n  [INFO] ${message}\n`);
    this.currentLine = "";
  }

  /**
   * Clear the current line and reset state.
   */
  clear(): void {
    if (this.currentLine) {
      process.stdout.write("\n");
      this.currentLine = "";
    }
  }
}
