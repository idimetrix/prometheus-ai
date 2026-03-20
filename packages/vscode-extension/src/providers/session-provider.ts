import {
  type Event,
  EventEmitter,
  ThemeIcon,
  type TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import type { PrometheusClient } from "../prometheus-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionInfo {
  currentTask?: string;
  id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

class SessionTreeItem extends TreeItem {
  readonly sessionId: string;
  readonly currentTask?: string;

  constructor(session: SessionInfo) {
    super(
      `Session ${session.id.slice(0, 8)}`,
      session.currentTask
        ? TreeItemCollapsibleState.Expanded
        : TreeItemCollapsibleState.None
    );

    this.sessionId = session.id;
    this.currentTask = session.currentTask;
    this.description = session.status;
    this.tooltip = `Session ${session.id}\nStatus: ${session.status}${
      session.currentTask ? `\nTask: ${session.currentTask}` : ""
    }`;

    const iconName = getStatusIcon(session.status);
    this.iconPath = new ThemeIcon(iconName);
    this.contextValue = "session";
  }
}

class TaskTreeItem extends TreeItem {
  constructor(taskDescription: string) {
    super(taskDescription, TreeItemCollapsibleState.None);
    this.iconPath = new ThemeIcon("tasklist");
    this.contextValue = "task";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getStatusIcon(status: string): string {
  switch (status) {
    case "active":
      return "debug-start";
    case "idle":
      return "debug-pause";
    case "completed":
      return "check";
    case "failed":
      return "error";
    default:
      return "circle-outline";
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class SessionProvider
  implements TreeDataProvider<SessionTreeItem | TaskTreeItem>
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    SessionTreeItem | TaskTreeItem | undefined | null | undefined
  >();

  readonly onDidChangeTreeData: Event<
    SessionTreeItem | TaskTreeItem | undefined | null | undefined
  > = this._onDidChangeTreeData.event;

  private sessions: SessionInfo[] = [];
  private readonly client: PrometheusClient;

  constructor(client: PrometheusClient) {
    this.client = client;
  }

  refresh(): void {
    this.fetchSessions();
  }

  getTreeItem(element: SessionTreeItem | TaskTreeItem): TreeItem {
    return element;
  }

  async getChildren(
    element?: SessionTreeItem | TaskTreeItem
  ): Promise<Array<SessionTreeItem | TaskTreeItem>> {
    if (!element) {
      // Root level: show sessions
      if (this.sessions.length === 0) {
        await this.fetchSessions();
      }
      return this.sessions.map((s) => new SessionTreeItem(s));
    }

    // Child level: show task if present
    if (element instanceof SessionTreeItem && element.currentTask) {
      return [new TaskTreeItem(element.currentTask)];
    }

    return [];
  }

  private async fetchSessions(): Promise<void> {
    try {
      const status = await this.client.getStatus();
      this.sessions = status.sessions;
      this._onDidChangeTreeData.fire(undefined);
    } catch {
      this.sessions = [];
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
