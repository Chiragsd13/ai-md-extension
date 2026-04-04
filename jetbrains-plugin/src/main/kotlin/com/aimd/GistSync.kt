package com.aimd

import java.net.HttpURLConnection
import java.net.URL

/**
 * GitHub Gist sync — create or update a private Gist file.
 * Pure JDK, no external dependencies.
 */
object GistSync {

    private const val API = "https://api.github.com/gists"

    fun save(
        token: String,
        gistId: String,
        filename: String,
        content: String,
        onNewGist: (String) -> Unit = {}
    ) {
        val escaped = content
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("\n", "\\n")
            .replace("\r", "")
            .replace("\t", "\\t")

        if (gistId.isNotBlank()) {
            // Patch existing
            val body = """{"files":{"$filename":{"content":"$escaped"}}}"""
            request("$API/$gistId", "PATCH", token, body)
        } else {
            // Create new
            val body = """{"description":"AI.md context","public":false,"files":{"$filename":{"content":"$escaped"}}}"""
            val resp = request(API, "POST", token, body)
            // Extract id from response (simple parse)
            val idMatch = Regex(""""id"\s*:\s*"([a-f0-9]+)"""").find(resp)
            idMatch?.groupValues?.get(1)?.let(onNewGist)
        }
    }

    fun read(token: String, gistId: String, filename: String): String {
        val resp = request("$API/$gistId", "GET", token, null)
        // Simple extraction — in production, use a JSON library
        val fileBlock = resp.substringAfter("\"$filename\"").substringBefore("}")
        val content = fileBlock.substringAfter("\"content\":\"").substringBefore("\",\"")
        return content
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    }

    private fun request(url: String, method: String, token: String, body: String?): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = if (method == "PATCH") "POST" else method
        if (method == "PATCH") {
            conn.setRequestProperty("X-HTTP-Method-Override", "PATCH")
        }
        conn.setRequestProperty("Authorization", "token $token")
        conn.setRequestProperty("Accept", "application/vnd.github.v3+json")
        conn.setRequestProperty("Content-Type", "application/json")
        conn.connectTimeout = 10_000
        conn.readTimeout = 15_000

        if (body != null) {
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toByteArray()) }
        }

        val code = conn.responseCode
        if (code !in 200..299) {
            val err = conn.errorStream?.bufferedReader()?.readText() ?: ""
            throw RuntimeException("GitHub API $code: ${err.take(200)}")
        }

        return conn.inputStream.bufferedReader().readText()
    }
}
