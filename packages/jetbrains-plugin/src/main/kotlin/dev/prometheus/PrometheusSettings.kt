package dev.prometheus

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.options.Configurable
import javax.swing.*

// ---------------------------------------------------------------------------
// Persistent state
// ---------------------------------------------------------------------------

data class PrometheusSettingsState(
    var apiUrl: String = "http://localhost:4000",
    var apiKey: String = "",
    var preferredModel: String = "auto",
    var streamResponses: Boolean = true,
)

@State(
    name = "dev.prometheus.PrometheusSettings",
    storages = [Storage("PrometheusAI.xml")]
)
@Service(Service.Level.APP)
class PrometheusSettings : PersistentStateComponent<PrometheusSettingsState> {

    private var currentState = PrometheusSettingsState()

    override fun getState(): PrometheusSettingsState = currentState

    override fun loadState(state: PrometheusSettingsState) {
        currentState = state
    }

    companion object {
        fun getInstance(): PrometheusSettings =
            ApplicationManager.getApplication().getService(PrometheusSettings::class.java)
    }
}

// ---------------------------------------------------------------------------
// Settings UI (Configurable)
// ---------------------------------------------------------------------------

class PrometheusSettingsConfigurable : Configurable {

    private var panel: JPanel? = null
    private var apiUrlField: JTextField? = null
    private var apiKeyField: JPasswordField? = null
    private var modelField: JTextField? = null
    private var streamCheckbox: JCheckBox? = null

    override fun getDisplayName(): String = "Prometheus AI"

    override fun createComponent(): JComponent {
        val p = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            border = BorderFactory.createEmptyBorder(10, 10, 10, 10)
        }

        val settings = PrometheusSettings.getInstance().state

        apiUrlField = JTextField(settings.apiUrl, 30)
        apiKeyField = JPasswordField(settings.apiKey, 30)
        modelField = JTextField(settings.preferredModel, 30)
        streamCheckbox = JCheckBox("Stream responses", settings.streamResponses)

        p.add(labeled("API URL:", apiUrlField!!))
        p.add(Box.createVerticalStrut(8))
        p.add(labeled("API Key:", apiKeyField!!))
        p.add(Box.createVerticalStrut(8))
        p.add(labeled("Preferred Model:", modelField!!))
        p.add(Box.createVerticalStrut(8))
        p.add(streamCheckbox)

        panel = p
        return p
    }

    override fun isModified(): Boolean {
        val s = PrometheusSettings.getInstance().state
        return apiUrlField?.text != s.apiUrl ||
            String(apiKeyField?.password ?: charArrayOf()) != s.apiKey ||
            modelField?.text != s.preferredModel ||
            streamCheckbox?.isSelected != s.streamResponses
    }

    override fun apply() {
        val s = PrometheusSettings.getInstance().state
        s.apiUrl = apiUrlField?.text.orEmpty()
        s.apiKey = String(apiKeyField?.password ?: charArrayOf())
        s.preferredModel = modelField?.text.orEmpty()
        s.streamResponses = streamCheckbox?.isSelected ?: true
    }

    override fun reset() {
        val s = PrometheusSettings.getInstance().state
        apiUrlField?.text = s.apiUrl
        apiKeyField?.text = s.apiKey
        modelField?.text = s.preferredModel
        streamCheckbox?.isSelected = s.streamResponses
    }

    override fun disposeUIResources() {
        panel = null
        apiUrlField = null
        apiKeyField = null
        modelField = null
        streamCheckbox = null
    }

    private fun labeled(label: String, field: JComponent): JPanel {
        return JPanel().apply {
            layout = BoxLayout(this, BoxLayout.X_AXIS)
            add(JLabel(label).apply { preferredSize = java.awt.Dimension(120, 25) })
            add(Box.createHorizontalStrut(8))
            add(field)
        }
    }
}
