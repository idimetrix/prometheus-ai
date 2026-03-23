package dev.prometheus.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.ui.Messages
import dev.prometheus.PrometheusClient
import dev.prometheus.PrometheusSettings

/**
 * IDE action that starts a new Prometheus session and reports the result
 * to the user via a dialog.
 */
class StartSessionAction : AnAction() {

    override fun actionPerformed(event: AnActionEvent) {
        val settings = PrometheusSettings.getInstance().state

        if (settings.apiUrl.isBlank()) {
            Messages.showErrorDialog(
                event.project,
                "Prometheus API URL is not configured.\nGo to Settings > Tools > Prometheus AI.",
                "Prometheus AI",
            )
            return
        }

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val client = PrometheusClient(settings.apiUrl, settings.apiKey)
                val session = client.createSession()
                ApplicationManager.getApplication().invokeLater {
                    Messages.showInfoMessage(
                        event.project,
                        "Session started: ${session.id}\nStatus: ${session.status}",
                        "Prometheus AI",
                    )
                }
            } catch (ex: Exception) {
                ApplicationManager.getApplication().invokeLater {
                    Messages.showErrorDialog(
                        event.project,
                        "Failed to start session: ${ex.message}",
                        "Prometheus AI",
                    )
                }
            }
        }
    }
}
