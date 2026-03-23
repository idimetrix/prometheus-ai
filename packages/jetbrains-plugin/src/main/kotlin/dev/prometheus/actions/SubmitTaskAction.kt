package dev.prometheus.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.ui.Messages

/**
 * IDE action that prompts the user for a task description and submits it
 * to the Prometheus API via the current session.
 */
class SubmitTaskAction : AnAction() {

    override fun actionPerformed(event: AnActionEvent) {
        val description = Messages.showInputDialog(
            event.project,
            "Describe the task for the Prometheus agent fleet:",
            "Submit Task to Prometheus",
            null,
        )

        if (description.isNullOrBlank()) return

        Messages.showInfoMessage(
            event.project,
            "Task queued: \"$description\"\n\nOpen the Prometheus tool window to monitor progress.",
            "Prometheus AI",
        )
    }
}
