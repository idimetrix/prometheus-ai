import {
  type Event,
  EventEmitter,
  ThemeIcon,
  type TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
} from "vscode";
import type { AgentStatus, PrometheusClient } from "../prometheus-client";

// ---------------------------------------------------------------------------
// Tree items
// ---------------------------------------------------------------------------

class AgentTreeItem extends TreeItem {
  constructor(agent: AgentStatus) {
    super(agent.role, TreeItemCollapsibleState.Collapsed);

    this.description = `${agent.status} - ${agent.progress}%`;
    this.tooltip = [
      `Agent: ${agent.role} (${agent.id})`,
      `Status: ${agent.status}`,
      `Progress: ${agent.progress}%`,
      `Files changed: ${agent.filesChanged}`,
      `Tokens used: ${agent.tokensUsed.toLocaleString()}`,
    ].join("\n");

    this.iconPath = new ThemeIcon(getAgentStatusIcon(agent.status));
    this.contextValue = "agent";
  }
}

class AgentDetailItem extends TreeItem {
  constructor(label: string, value: string) {
    super(`${label}: ${value}`, TreeItemCollapsibleState.None);
    this.contextValue = "agentDetail";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAgentStatusIcon(
  status: "pending" | "running" | "completed" | "failed"
): string {
  switch (status) {
    case "pending":
      return "clock";
    case "running":
      return "sync~spin";
    case "completed":
      return "check";
    case "failed":
      return "error";
    default:
      return "circle-outline";
  }
}

function formatTokenCount(tokens: number): string {
  if (tokens > 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens > 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AgentProvider
  implements TreeDataProvider<AgentTreeItem | AgentDetailItem>
{
  private readonly _onDidChangeTreeData = new EventEmitter<
    AgentTreeItem | AgentDetailItem | undefined | null | undefined
  >();

  readonly onDidChangeTreeData: Event<
    AgentTreeItem | AgentDetailItem | undefined | null | undefined
  > = this._onDidChangeTreeData.event;

  private agents: AgentStatus[] = [];
  private readonly client: PrometheusClient;
  private refreshInterval: ReturnType<typeof setInterval> | undefined;

  constructor(client: PrometheusClient) {
    this.client = client;
  }

  /**
   * Start auto-refreshing agent status at the given interval (ms).
   */
  startAutoRefresh(intervalMs = 5000): void {
    this.stopAutoRefresh();
    this.refreshInterval = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }

  stopAutoRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = undefined;
    }
  }

  refresh(): void {
    this.fetchAgents();
  }

  /**
   * Update agents from an external source (e.g. WebSocket event).
   */
  updateAgents(agents: AgentStatus[]): void {
    this.agents = agents;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: AgentTreeItem | AgentDetailItem): TreeItem {
    return element;
  }

  async getChildren(
    element?: AgentTreeItem | AgentDetailItem
  ): Promise<Array<AgentTreeItem | AgentDetailItem>> {
    if (!element) {
      // Root level: show agents
      if (this.agents.length === 0) {
        await this.fetchAgents();
      }
      return this.agents.map((a) => new AgentTreeItem(a));
    }

    // Child level: show agent details
    if (element instanceof AgentTreeItem) {
      const agent = this.agents.find((a) => a.role === element.label);
      if (!agent) {
        return [];
      }
      return [
        new AgentDetailItem("ID", agent.id.slice(0, 12)),
        new AgentDetailItem("Progress", `${agent.progress}%`),
        new AgentDetailItem("Files Changed", String(agent.filesChanged)),
        new AgentDetailItem("Tokens", formatTokenCount(agent.tokensUsed)),
      ];
    }

    return [];
  }

  private async fetchAgents(): Promise<void> {
    try {
      if (!this.client.getSessionId()) {
        this.agents = [];
        this._onDidChangeTreeData.fire(undefined);
        return;
      }
      this.agents = await this.client.getAgents();
      this._onDidChangeTreeData.fire(undefined);
    } catch {
      this.agents = [];
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  dispose(): void {
    this.stopAutoRefresh();
    this._onDidChangeTreeData.dispose();
  }
}
