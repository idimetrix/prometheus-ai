package dev.prometheus

import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.IOException

// ---------------------------------------------------------------------------
// Response models
// ---------------------------------------------------------------------------

data class SessionResponse(
    val id: String,
    val status: String,
)

data class TaskResponse(
    @SerializedName("sessionId") val sessionId: String,
    @SerializedName("taskId") val taskId: String,
)

data class TaskStatusResponse(
    @SerializedName("taskId") val taskId: String,
    val status: String,
    val progress: Double? = null,
    val result: Any? = null,
    val error: String? = null,
)

data class SessionEvent(
    val event: String,
    val data: String,
)

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

/**
 * Kotlin/OkHttp client that mirrors the shared TypeScript API client.
 *
 * All public methods are blocking — callers should use coroutines or
 * background threads as appropriate for the IntelliJ platform.
 */
class PrometheusClient(
    private val baseUrl: String,
    private val apiKey: String,
) {
    private val gson = Gson()
    private val jsonMedia = "application/json".toMediaType()

    private val http = OkHttpClient.Builder()
        .connectTimeout(java.time.Duration.ofSeconds(10))
        .readTimeout(java.time.Duration.ofSeconds(60))
        .build()

    // -- helpers ------------------------------------------------------------

    private fun authHeaders(): Headers {
        val builder = Headers.Builder()
            .add("Content-Type", "application/json")
        if (apiKey.isNotBlank()) {
            builder.add("Authorization", "Bearer $apiKey")
        }
        return builder.build()
    }

    private inline fun <reified T> execute(request: Request): T {
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val body = response.body?.string() ?: "Unknown error"
                throw IOException(
                    "API ${request.method} ${request.url.encodedPath} " +
                        "failed (${response.code}): $body"
                )
            }
            val body = response.body?.string() ?: throw IOException("Empty response body")
            return gson.fromJson(body, T::class.java)
        }
    }

    // -- public API ---------------------------------------------------------

    /** Create a new agent session. */
    fun createSession(): SessionResponse {
        val request = Request.Builder()
            .url("$baseUrl/api/sessions")
            .headers(authHeaders())
            .post("{}".toRequestBody(jsonMedia))
            .build()
        return execute(request)
    }

    /** Submit a task to a session. */
    fun submitTask(sessionId: String, description: String): TaskResponse {
        val payload = gson.toJson(mapOf("sessionId" to sessionId, "description" to description))
        val request = Request.Builder()
            .url("$baseUrl/api/tasks")
            .headers(authHeaders())
            .post(payload.toRequestBody(jsonMedia))
            .build()
        return execute(request)
    }

    /** Get the current status of a task. */
    fun getTaskStatus(taskId: String): TaskStatusResponse {
        val request = Request.Builder()
            .url("$baseUrl/api/tasks/$taskId")
            .headers(authHeaders())
            .get()
            .build()
        return execute(request)
    }

    /** Cancel a running task. */
    fun cancelTask(taskId: String) {
        val request = Request.Builder()
            .url("$baseUrl/api/tasks/$taskId")
            .headers(authHeaders())
            .delete()
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                throw IOException("Cancel task failed (${response.code})")
            }
        }
    }

    /**
     * Subscribe to SSE events for a session.
     *
     * Returns an [EventSource] that can be cancelled via [EventSource.cancel].
     */
    fun streamEvents(
        sessionId: String,
        onEvent: (SessionEvent) -> Unit,
        onError: (Throwable) -> Unit = {},
    ): EventSource {
        val request = Request.Builder()
            .url("$baseUrl/api/sessions/$sessionId/events")
            .headers(
                authHeaders().newBuilder()
                    .set("Accept", "text/event-stream")
                    .build()
            )
            .get()
            .build()

        val listener = object : EventSourceListener() {
            override fun onEvent(
                eventSource: EventSource,
                id: String?,
                type: String?,
                data: String,
            ) {
                onEvent(SessionEvent(event = type ?: "message", data = data))
            }

            override fun onFailure(
                eventSource: EventSource,
                t: Throwable?,
                response: Response?,
            ) {
                if (t != null) {
                    onError(t)
                }
            }
        }

        val factory = EventSources.createFactory(http)
        return factory.newEventSource(request, listener)
    }

    /** Shut down the underlying HTTP client gracefully. */
    fun close() {
        http.dispatcher.executorService.shutdown()
        http.connectionPool.evictAll()
    }
}
