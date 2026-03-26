import { StatusBarAlignment, ThemeColor, window } from "vscode";
import type { ApiClient } from "./api-client";

type AgentStatus = "idle" | "connecting" | "active" | "busy" | "error";

const REFRESH_INTERVAL_MS = 30_000;

export class StatusBarManager {
  private readonly item: ReturnType<typeof window.createStatusBarItem>;
  private currentStatus: AgentStatus = "idle";
  private sessionId: string | undefined;
  private activeSessions = 0;
  private creditBalance: number | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private apiClient: ApiClient | undefined;

  constructor() {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    this.item.command = "prometheus.openChat";
    this.setStatus("idle");
  }

  show(): void {
    this.item.show();
  }

  /**
   * Start periodic status polling from the API.
   */
  startPolling(apiClient: ApiClient): void {
    this.apiClient = apiClient;
    this.stopPolling();
    this.pollStatus();
    this.refreshTimer = setInterval(() => {
      this.pollStatus();
    }, REFRESH_INTERVAL_MS);
  }

  stopPolling(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  setStatus(status: AgentStatus, sessionId?: string): void {
    this.currentStatus = status;
    if (sessionId !== undefined) {
      this.sessionId = sessionId;
    }
    this.updateDisplay();
  }

  setActiveSessions(count: number): void {
    this.activeSessions = count;
    this.updateDisplay();
  }

  setCreditBalance(balance: number): void {
    this.creditBalance = balance;
    this.updateDisplay();
  }

  getStatus(): AgentStatus {
    return this.currentStatus;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  dispose(): void {
    this.stopPolling();
    this.item.dispose();
  }

  private async pollStatus(): Promise<void> {
    if (!this.apiClient) {
      return;
    }
    try {
      const status = await this.apiClient.getStatus();
      this.activeSessions = status.activeSessions ?? status.sessions.length;
      if (status.creditBalance !== undefined) {
        this.creditBalance = status.creditBalance;
      }
      // Update connection status if we successfully reached the API
      if (this.currentStatus === "idle" || this.currentStatus === "error") {
        this.currentStatus = this.activeSessions > 0 ? "active" : "idle";
      }
      this.updateDisplay();
    } catch {
      // Silently ignore polling errors to avoid spamming notifications
      if (
        this.currentStatus !== "error" &&
        this.currentStatus !== "connecting"
      ) {
        this.currentStatus = "error";
        this.updateDisplay();
      }
    }
  }

  private updateDisplay(): void {
    const parts: string[] = [];

    // Sessions count
    if (this.activeSessions > 0) {
      parts.push(
        `${this.activeSessions} session${this.activeSessions === 1 ? "" : "s"}`
      );
    }

    // Credit balance
    if (this.creditBalance !== undefined) {
      parts.push(`${this.creditBalance} credits`);
    }

    const suffix = parts.length > 0 ? ` | ${parts.join(" | ")}` : "";

    switch (this.currentStatus) {
      case "idle": {
        this.item.text = `$(circle-outline) Prometheus${suffix}`;
        this.item.tooltip =
          "Prometheus: No active session. Click to open chat.";
        this.item.backgroundColor = undefined;
        break;
      }
      case "connecting": {
        this.item.text = `$(sync~spin) Prometheus${suffix}`;
        this.item.tooltip = "Prometheus: Connecting...";
        this.item.backgroundColor = undefined;
        break;
      }
      case "active": {
        this.item.text = `$(circle-filled) Prometheus${suffix}`;
        this.item.tooltip = this.sessionId
          ? `Prometheus: Active (${this.sessionId}). Click to open chat.`
          : "Prometheus: Connected. Click to open chat.";
        this.item.backgroundColor = undefined;
        break;
      }
      case "busy": {
        this.item.text = `$(loading~spin) Prometheus${suffix}`;
        this.item.tooltip = "Prometheus: Agent is working...";
        this.item.backgroundColor = undefined;
        break;
      }
      case "error": {
        this.item.text = `$(error) Prometheus${suffix}`;
        this.item.tooltip = "Prometheus: Cannot reach API. Click to open chat.";
        this.item.backgroundColor = new ThemeColor(
          "statusBarItem.errorBackground"
        );
        break;
      }
      default:
        break;
    }
  }
}
