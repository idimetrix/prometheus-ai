import type { ToolRegistry } from "../../registry";

export function registerSlackAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "slack_send_message",
      adapter: "slack",
      description: "Send a message to a Slack channel",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string" }, text: { type: "string" },
          blocks: { type: "array" },
        },
        required: ["channel", "text"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { ts: "", channel: input.channel } };
    }
  );

  registry.register(
    {
      name: "slack_post_task_summary",
      adapter: "slack",
      description: "Post a formatted task completion summary to Slack",
      inputSchema: {
        type: "object",
        properties: {
          channel: { type: "string" }, taskTitle: { type: "string" },
          status: { type: "string" }, duration: { type: "string" },
          filesChanged: { type: "number" }, prUrl: { type: "string" },
        },
        required: ["channel", "taskTitle", "status"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { posted: true } };
    }
  );
}
