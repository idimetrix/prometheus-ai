package dev.prometheus

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentFactory
import java.awt.BorderLayout
import java.awt.Dimension
import javax.swing.*

/**
 * Factory registered in plugin.xml that creates the Prometheus tool window
 * content when the user opens the sidebar panel.
 */
class PrometheusToolWindowFactory : ToolWindowFactory, DumbAware {

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = PrometheusToolWindowPanel(project)
        val content = ContentFactory.getInstance().createContent(panel, "Prometheus AI", false)
        toolWindow.contentManager.addContent(content)
    }
}

// ---------------------------------------------------------------------------
// Tool-window UI
// ---------------------------------------------------------------------------

/**
 * Main panel displayed inside the Prometheus tool window. Contains:
 * - A status label showing connection state
 * - A scrollable output area for agent messages
 * - A task input field with a submit button
 */
class PrometheusToolWindowPanel(
    private val project: Project,
) : JPanel(BorderLayout()) {

    private val statusLabel = JLabel("Not connected")
    private val outputArea = JTextArea().apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
    }
    private val taskInput = JTextField()
    private val submitButton = JButton("Submit Task")
    private val connectButton = JButton("Connect")

    private var client: PrometheusClient? = null
    private var sessionId: String? = null

    init {
        buildUi()
        wireActions()
    }

    // -- layout -------------------------------------------------------------

    private fun buildUi() {
        // Top bar
        val topBar = JPanel(BorderLayout()).apply {
            border = BorderFactory.createEmptyBorder(4, 8, 4, 8)
            add(statusLabel, BorderLayout.CENTER)
            add(connectButton, BorderLayout.EAST)
        }
        add(topBar, BorderLayout.NORTH)

        // Chat / output area
        val scrollPane = JScrollPane(outputArea).apply {
            preferredSize = Dimension(300, 400)
        }
        add(scrollPane, BorderLayout.CENTER)

        // Input bar
        val inputBar = JPanel(BorderLayout()).apply {
            border = BorderFactory.createEmptyBorder(4, 8, 4, 8)
            add(taskInput, BorderLayout.CENTER)
            add(submitButton, BorderLayout.EAST)
        }
        add(inputBar, BorderLayout.SOUTH)

        submitButton.isEnabled = false
    }

    // -- actions ------------------------------------------------------------

    private fun wireActions() {
        connectButton.addActionListener { toggleConnection() }
        submitButton.addActionListener { submitTask() }

        taskInput.addActionListener { submitTask() }
    }

    private fun toggleConnection() {
        if (client != null) {
            disconnect()
            return
        }

        val settings = PrometheusSettings.getInstance().state
        if (settings.apiUrl.isBlank()) {
            appendOutput("[error] API URL is not configured. Open Settings > Tools > Prometheus AI.")
            return
        }

        client = PrometheusClient(settings.apiUrl, settings.apiKey)

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val session = client!!.createSession()
                sessionId = session.id
                SwingUtilities.invokeLater {
                    statusLabel.text = "Connected (session ${session.id.take(8)}...)"
                    connectButton.text = "Disconnect"
                    submitButton.isEnabled = true
                    appendOutput("[info] Session started: ${session.id}")
                }
                // Start listening for events
                client!!.streamEvents(
                    sessionId = session.id,
                    onEvent = { event ->
                        SwingUtilities.invokeLater {
                            appendOutput("[${event.event}] ${event.data}")
                        }
                    },
                    onError = { error ->
                        SwingUtilities.invokeLater {
                            appendOutput("[error] Event stream: ${error.message}")
                        }
                    },
                )
            } catch (ex: Exception) {
                SwingUtilities.invokeLater {
                    appendOutput("[error] Connection failed: ${ex.message}")
                    client?.close()
                    client = null
                }
            }
        }
    }

    private fun disconnect() {
        client?.close()
        client = null
        sessionId = null
        statusLabel.text = "Not connected"
        connectButton.text = "Connect"
        submitButton.isEnabled = false
        appendOutput("[info] Disconnected.")
    }

    private fun submitTask() {
        val description = taskInput.text.trim()
        if (description.isBlank() || client == null || sessionId == null) return

        taskInput.text = ""
        appendOutput("> $description")

        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val response = client!!.submitTask(sessionId!!, description)
                SwingUtilities.invokeLater {
                    appendOutput("[task] Submitted: ${response.taskId}")
                }
            } catch (ex: Exception) {
                SwingUtilities.invokeLater {
                    appendOutput("[error] Submit failed: ${ex.message}")
                }
            }
        }
    }

    private fun appendOutput(text: String) {
        outputArea.append("$text\n")
        outputArea.caretPosition = outputArea.document.length
    }
}
