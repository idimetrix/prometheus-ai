import { StatusBarAlignment, ThemeColor, window } from "vscode";

type AgentStatus = "idle" | "connecting" | "active" | "busy" | "error";

/**
 * Manages the Prometheus status bar item showing session status,
 * credit balance, and quick access to Prometheus commands.
 */
export class EnhancedStatusBarManager {
  private readonly item: ReturnType<typeof window.createStatusBarItem>;
  private currentStatus: AgentStatus = "idle";
  private sessionId: string | undefined;
  private creditBalance: number | undefined;

  constructor() {
    this.item = window.createStatusBarItem(StatusBarAlignment.Left, 100);
    this.item.command = "prometheus.viewStatus";
    this.setStatus("idle");
  }

  show(): void {
    this.item.show();
  }

  setStatus(status: AgentStatus, sessionId?: string): void {
    this.currentStatus = status;
    this.sessionId = sessionId;
    this.updateDisplay();
  }

  /**
   * Update the displayed credit balance.
   */
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
    this.item.dispose();
  }

  private updateDisplay(): void {
    const creditStr =
      this.creditBalance === undefined
        ? ""
        : ` | ${this.creditBalance} credits`;

    switch (this.currentStatus) {
      case "idle": {
        this.item.text = `$(circle-outline) Prometheus${creditStr}`;
        this.item.tooltip =
          "Prometheus: No active session. Click to open commands.";
        this.item.backgroundColor = undefined;
        break;
      }
      case "connecting": {
        this.item.text = `$(sync~spin) Prometheus${creditStr}`;
        this.item.tooltip = "Prometheus: Connecting...";
        this.item.backgroundColor = undefined;
        break;
      }
      case "active": {
        this.item.text = `$(circle-filled) Prometheus${creditStr}`;
        this.item.tooltip = this.sessionId
          ? `Prometheus: Active (${this.sessionId}). Click to view status.`
          : "Prometheus: Active";
        this.item.backgroundColor = undefined;
        break;
      }
      case "busy": {
        this.item.text = `$(loading~spin) Prometheus${creditStr}`;
        this.item.tooltip = "Prometheus: Agent is working...";
        this.item.backgroundColor = undefined;
        break;
      }
      case "error": {
        this.item.text = `$(error) Prometheus${creditStr}`;
        this.item.tooltip = "Prometheus: Error. Click to view details.";
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
