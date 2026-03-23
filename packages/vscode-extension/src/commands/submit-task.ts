import { window } from "vscode";
import type { PrometheusClient } from "../prometheus-client";

// ---------------------------------------------------------------------------
// Priority options
// ---------------------------------------------------------------------------

const PRIORITY_OPTIONS = [
  { label: "Normal", value: "normal", description: "Standard priority" },
  { label: "High", value: "high", description: "Prioritized execution" },
  { label: "Low", value: "low", description: "Background execution" },
] as const;

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

/**
 * Command handler that shows an input box for task description,
 * an optional priority picker, and submits the task via the API.
 */
export async function submitTask(client: PrometheusClient): Promise<void> {
  // Collect task description
  const description = await window.showInputBox({
    prompt: "Describe the task for the Prometheus agent",
    placeHolder:
      "e.g., Refactor the authentication module to use JWT refresh tokens",
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value.trim()) {
        return "Task description is required";
      }
      if (value.trim().length < 10) {
        return "Please provide a more detailed description (at least 10 characters)";
      }
      return undefined;
    },
  });

  if (!description) {
    return; // User cancelled
  }

  // Collect priority
  const priorityPick = await window.showQuickPick(
    PRIORITY_OPTIONS.map((p) => ({
      label: p.label,
      description: p.description,
      value: p.value,
    })),
    {
      placeHolder: "Select task priority",
      title: "Task Priority",
    }
  );

  const priority = priorityPick?.value ?? "normal";

  // Submit the task
  try {
    const result = await client.submitTask(description.trim(), priority);

    window.showInformationMessage(
      `Task submitted successfully (${result.taskId})`
    );

    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    window.showErrorMessage(`Failed to submit task: ${message}`);
  }
}
