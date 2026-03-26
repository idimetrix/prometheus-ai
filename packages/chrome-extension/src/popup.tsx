/**
 * Prometheus Chrome Extension - Popup
 *
 * Captures the current page URL, title, and allows users to create
 * tasks in their Prometheus workspace directly from the browser.
 */

/* global chrome */

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

interface PageInfo {
  title: string;
  url: string;
}

interface Project {
  id: string;
  name: string;
}

type Priority = "low" | "medium" | "high" | "critical";

interface TaskPayload {
  description: string;
  priority: Priority;
  projectId: string;
  sourceTitle: string;
  sourceUrl: string;
  title: string;
}

/* -------------------------------------------------------------------------- */
/*  Storage helpers                                                            */
/* -------------------------------------------------------------------------- */

const STORAGE_KEYS = {
  apiUrl: "prometheus:api_url",
  apiKey: "prometheus:api_key",
  lastProject: "prometheus:last_project",
} as const;

// Chrome extension API — accessed via globalThis to avoid undeclared variable warnings
const chromeApi = (globalThis as Record<string, unknown>).chrome as
  | {
      storage: {
        local: {
          get: (
            key: string,
            cb: (result: Record<string, unknown>) => void
          ) => void;
          set: (items: Record<string, unknown>, cb: () => void) => void;
        };
      };
      tabs: {
        query: (
          queryInfo: { active: boolean; currentWindow: boolean },
          cb: (tabs: Array<{ url?: string; title?: string }>) => void
        ) => void;
      };
    }
  | undefined;

function getStorage(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (chromeApi?.storage) {
      chromeApi.storage.local.get(key, (result: Record<string, unknown>) => {
        resolve((result[key] as string) ?? null);
      });
    } else {
      resolve(localStorage.getItem(key));
    }
  });
}

function setStorage(key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    if (chromeApi?.storage) {
      chromeApi.storage.local.set({ [key]: value }, () => resolve());
    } else {
      localStorage.setItem(key, value);
      resolve();
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  API client                                                                 */
/* -------------------------------------------------------------------------- */

async function fetchProjects(
  apiUrl: string,
  apiKey: string
): Promise<Project[]> {
  try {
    const res = await fetch(`${apiUrl}/api/projects`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as { items: Project[] };
    return data.items ?? [];
  } catch {
    return [];
  }
}

async function createTask(
  apiUrl: string,
  apiKey: string,
  payload: TaskPayload
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${apiUrl}/api/tasks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = (await res.json()) as { message?: string };
      return { success: false, error: err.message ?? "Request failed" };
    }
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  Page info                                                                  */
/* -------------------------------------------------------------------------- */

function getCurrentPageInfo(): Promise<PageInfo> {
  return new Promise((resolve) => {
    if (chromeApi?.tabs) {
      chromeApi.tabs.query(
        { active: true, currentWindow: true },
        (tabs: Array<{ url?: string; title?: string }>) => {
          const tab = tabs[0];
          resolve({
            url: tab?.url ?? window.location.href,
            title: tab?.title ?? document.title,
          });
        }
      );
    } else {
      resolve({
        url: window.location.href,
        title: document.title,
      });
    }
  });
}

/* -------------------------------------------------------------------------- */
/*  Render                                                                     */
/* -------------------------------------------------------------------------- */

interface State {
  apiKey: string;
  apiUrl: string;
  description: string;
  error: string;
  pageInfo: PageInfo;
  priority: Priority;
  projects: Project[];
  selectedProjectId: string;
  status: "idle" | "loading" | "success" | "error" | "settings";
}

const state: State = {
  pageInfo: { url: "", title: "" },
  projects: [],
  selectedProjectId: "",
  description: "",
  priority: "medium",
  apiUrl: "",
  apiKey: "",
  status: "idle",
  error: "",
};

function render(): void {
  const root = document.getElementById("root");
  if (!root) {
    return;
  }

  if (state.status === "settings" || !state.apiKey) {
    root.innerHTML = renderSettings();
    attachSettingsListeners();
    return;
  }

  if (state.status === "success") {
    root.innerHTML = renderSuccess();
    attachSuccessListeners();
    return;
  }

  root.innerHTML = renderMain();
  attachMainListeners();
}

function renderSettings(): string {
  return `
    <div style="padding: 20px;">
      <h2 style="font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #a78bfa;">
        Prometheus Settings
      </h2>
      <div style="margin-bottom: 12px;">
        <label style="display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px;">API URL</label>
        <input id="api-url" type="text" value="${escapeHtml(state.apiUrl)}"
          placeholder="https://your-instance.prometheus.dev"
          style="width: 100%; padding: 8px 12px; background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: white; font-size: 13px;" />
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px;">API Key</label>
        <input id="api-key" type="password" value="${escapeHtml(state.apiKey)}"
          placeholder="pk_..."
          style="width: 100%; padding: 8px 12px; background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: white; font-size: 13px;" />
      </div>
      <button id="save-settings"
        style="width: 100%; padding: 8px; background: #7c3aed; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: pointer;">
        Save & Connect
      </button>
    </div>
  `;
}

function renderMain(): string {
  const projectOptions = state.projects
    .map(
      (p) =>
        `<option value="${escapeHtml(p.id)}" ${p.id === state.selectedProjectId ? "selected" : ""}>${escapeHtml(p.name)}</option>`
    )
    .join("");

  const priorities: Priority[] = ["low", "medium", "high", "critical"];
  const priorityColors: Record<Priority, string> = {
    low: "#3f3f46",
    medium: "#2563eb",
    high: "#d97706",
    critical: "#dc2626",
  };

  return `
    <div style="padding: 16px;">
      <!-- Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
        <h2 style="font-size: 14px; font-weight: 600; color: #a78bfa;">Create Task</h2>
        <button id="open-settings" style="background: none; border: none; color: #71717a; cursor: pointer; font-size: 18px;" title="Settings">&#9881;</button>
      </div>

      <!-- Page info -->
      <div style="background: #27272a; border-radius: 8px; padding: 10px; margin-bottom: 12px;">
        <div style="font-size: 12px; color: #a1a1aa; margin-bottom: 2px;">Current Page</div>
        <div style="font-size: 13px; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(state.pageInfo.title)}</div>
        <div style="font-size: 11px; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(state.pageInfo.url)}</div>
      </div>

      <!-- Project -->
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px;">Project</label>
        <select id="project-select"
          style="width: 100%; padding: 8px; background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: white; font-size: 13px;">
          <option value="">Select a project</option>
          ${projectOptions}
        </select>
      </div>

      <!-- Description -->
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px;">Task Description</label>
        <textarea id="task-description" rows="4"
          style="width: 100%; padding: 8px; background: #27272a; border: 1px solid #3f3f46; border-radius: 8px; color: white; font-size: 13px; resize: vertical;"
          placeholder="Describe the task...">${escapeHtml(state.description)}</textarea>
      </div>

      <!-- Priority -->
      <div style="margin-bottom: 14px;">
        <label style="display: block; font-size: 12px; color: #a1a1aa; margin-bottom: 4px;">Priority</label>
        <div style="display: flex; gap: 6px;">
          ${priorities
            .map(
              (p) => `
            <button class="priority-btn" data-priority="${p}"
              style="flex: 1; padding: 6px; border: 1px solid ${state.priority === p ? priorityColors[p] : "#3f3f46"}; background: ${state.priority === p ? `${priorityColors[p]}20` : "transparent"}; border-radius: 6px; color: ${state.priority === p ? "white" : "#a1a1aa"}; font-size: 11px; cursor: pointer; text-transform: capitalize;">
              ${p}
            </button>`
            )
            .join("")}
        </div>
      </div>

      ${state.error ? `<div style="color: #f87171; font-size: 12px; margin-bottom: 10px;">${escapeHtml(state.error)}</div>` : ""}

      <!-- Submit -->
      <button id="create-task"
        ${state.selectedProjectId && state.description.trim() ? "" : "disabled"}
        style="width: 100%; padding: 10px; background: ${state.selectedProjectId && state.description.trim() ? "#7c3aed" : "#3f3f46"}; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 500; cursor: ${state.selectedProjectId && state.description.trim() ? "pointer" : "not-allowed"};">
        ${state.status === "loading" ? "Creating..." : "Create Task"}
      </button>
    </div>
  `;
}

function renderSuccess(): string {
  return `
    <div style="padding: 24px; text-align: center;">
      <div style="font-size: 32px; margin-bottom: 12px;">&#10004;</div>
      <h2 style="font-size: 16px; font-weight: 600; color: #34d399; margin-bottom: 8px;">Task Created!</h2>
      <p style="font-size: 13px; color: #a1a1aa; margin-bottom: 16px;">Your task has been sent to Prometheus.</p>
      <button id="create-another"
        style="padding: 8px 16px; background: #27272a; color: white; border: 1px solid #3f3f46; border-radius: 8px; font-size: 13px; cursor: pointer;">
        Create Another
      </button>
    </div>
  `;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* -------------------------------------------------------------------------- */
/*  Event listeners                                                            */
/* -------------------------------------------------------------------------- */

function attachSettingsListeners(): void {
  document
    .getElementById("save-settings")
    ?.addEventListener("click", async () => {
      const apiUrl =
        (document.getElementById("api-url") as HTMLInputElement)?.value ?? "";
      const apiKey =
        (document.getElementById("api-key") as HTMLInputElement)?.value ?? "";

      state.apiUrl = apiUrl;
      state.apiKey = apiKey;
      await setStorage(STORAGE_KEYS.apiUrl, apiUrl);
      await setStorage(STORAGE_KEYS.apiKey, apiKey);

      state.projects = await fetchProjects(apiUrl, apiKey);
      state.status = "idle";
      render();
    });
}

function attachMainListeners(): void {
  document.getElementById("open-settings")?.addEventListener("click", () => {
    state.status = "settings";
    render();
  });

  document.getElementById("project-select")?.addEventListener("change", (e) => {
    state.selectedProjectId = (e.target as HTMLSelectElement).value;
    setStorage(STORAGE_KEYS.lastProject, state.selectedProjectId).catch(() => {
      /* storage write failure is non-critical */
    });
    render();
  });

  document
    .getElementById("task-description")
    ?.addEventListener("input", (e) => {
      state.description = (e.target as HTMLTextAreaElement).value;
    });

  for (const btn of document.querySelectorAll(".priority-btn")) {
    btn.addEventListener("click", (e) => {
      state.priority = (e.currentTarget as HTMLElement).dataset
        .priority as Priority;
      render();
    });
  }

  document
    .getElementById("create-task")
    ?.addEventListener("click", async () => {
      if (!(state.selectedProjectId && state.description.trim())) {
        return;
      }

      state.status = "loading";
      state.error = "";
      render();

      const result = await createTask(state.apiUrl, state.apiKey, {
        projectId: state.selectedProjectId,
        title: state.pageInfo.title,
        description: `${state.description}\n\nSource: ${state.pageInfo.url}`,
        priority: state.priority,
        sourceUrl: state.pageInfo.url,
        sourceTitle: state.pageInfo.title,
      });

      if (result.success) {
        state.status = "success";
        state.description = "";
      } else {
        state.status = "error";
        state.error = result.error ?? "Failed to create task";
      }
      render();
    });
}

function attachSuccessListeners(): void {
  document.getElementById("create-another")?.addEventListener("click", () => {
    state.status = "idle";
    render();
  });
}

/* -------------------------------------------------------------------------- */
/*  Init                                                                       */
/* -------------------------------------------------------------------------- */

async function init(): Promise<void> {
  state.apiUrl = (await getStorage(STORAGE_KEYS.apiUrl)) ?? "";
  state.apiKey = (await getStorage(STORAGE_KEYS.apiKey)) ?? "";
  state.selectedProjectId = (await getStorage(STORAGE_KEYS.lastProject)) ?? "";
  state.pageInfo = await getCurrentPageInfo();

  // Pre-fill description with page context
  state.description = `Implement changes based on: ${state.pageInfo.title}\n\nReference: ${state.pageInfo.url}`;

  if (state.apiUrl && state.apiKey) {
    state.projects = await fetchProjects(state.apiUrl, state.apiKey);
  }

  render();
}

init();
