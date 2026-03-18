import type { ToolRegistry } from "../../registry";

export function registerJiraAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "jira_create_ticket",
      adapter: "jira",
      description: "Create a Jira ticket",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string" }, summary: { type: "string" },
          description: { type: "string" }, issueType: { type: "string" },
          priority: { type: "string" },
        },
        required: ["projectKey", "summary", "issueType"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { ticket_key: "", ticket_url: "" } };
    }
  );

  registry.register(
    {
      name: "jira_transition_ticket",
      adapter: "jira",
      description: "Transition a Jira ticket to a new status",
      inputSchema: {
        type: "object",
        properties: { ticketKey: { type: "string" }, transitionId: { type: "string" } },
        required: ["ticketKey", "transitionId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { transitioned: true } };
    }
  );
}
