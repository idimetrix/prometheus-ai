package dev.prometheus

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

/**
 * Entry-point activity that runs when a project is opened.
 *
 * Performs lightweight bootstrap work such as verifying settings and
 * logging the plugin version. Heavy initialisation (HTTP connections,
 * UI creation) is deferred to when the user actually opens the tool
 * window or triggers an action.
 */
class PrometheusPlugin : ProjectActivity {

    override suspend fun execute(project: Project) {
        val settings = PrometheusSettings.getInstance()
        val configured = settings.state.apiKey.isNotBlank()

        com.intellij.openapi.diagnostic.Logger
            .getInstance(PrometheusPlugin::class.java)
            .info(
                "Prometheus AI plugin loaded for project '${project.name}' " +
                    "(configured=$configured)"
            )
    }
}
