import { StatusBarAlignment, ThemeColor, window } from "vscode";

type AgentStatus = "idle" | "connecting" | "active" | "busy" | "error";

export class StatusBarManager {
  private readonly item: ReturnType<typeof window.createStatusBarItem>;
  private currentStatus: AgentStatus = "idle";
  private sessionId: string | undefined;

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

    switch (status) {
      case "idle": {
        this.item.text = "$(circle-outline) Prometheus";
        this.item.tooltip =
          "Prometheus: No active session. Click to view status.";
        this.item.backgroundColor = undefined;
        break;
      }
      case "connecting": {
        this.item.text = "$(sync~spin) Prometheus";
        this.item.tooltip = "Prometheus: Connecting...";
        this.item.backgroundColor = undefined;
        break;
      }
      case "active": {
        this.item.text = "$(circle-filled) Prometheus";
        this.item.tooltip = sessionId
          ? `Prometheus: Active (${sessionId})`
          : "Prometheus: Active";
        this.item.backgroundColor = undefined;
        break;
      }
      case "busy": {
        this.item.text = "$(loading~spin) Prometheus";
        this.item.tooltip = "Prometheus: Agent is working...";
        this.item.backgroundColor = undefined;
        break;
      }
      case "error": {
        this.item.text = "$(error) Prometheus";
        this.item.tooltip = "Prometheus: Error. Click to view status.";
        this.item.backgroundColor = new ThemeColor(
          "statusBarItem.errorBackground"
        );
        break;
      }
      default:
        break;
    }
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
}
