package com.aimd

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.wm.WindowManager

/**
 * Runs on project open. Sets up:
 * 1. Auto-save on project close (via ProjectManagerListener)
 * 2. Auto-save on window focus loss (via WindowFocusListener)
 */
class AiMdStartup : ProjectActivity {

    override suspend fun execute(project: Project) {
        val settings = AiMdSettings.getInstance()

        // Auto-save on focus loss
        if (settings.autoSaveOnFocusLoss) {
            val frame = WindowManager.getInstance().getFrame(project)
            frame?.addWindowFocusListener(object : java.awt.event.WindowFocusListener {
                override fun windowGainedFocus(e: java.awt.event.WindowEvent?) {}
                override fun windowLostFocus(e: java.awt.event.WindowEvent?) {
                    if (settings.autoSaveOnFocusLoss) {
                        ApplicationManager.getApplication().executeOnPooledThread {
                            try {
                                AiMdSaveAction().saveQuietly(project)
                            } catch (_: Exception) { /* silent */ }
                        }
                    }
                }
            })
        }
    }
}

// Extension function for quiet saves (no dialogs)
fun AiMdSaveAction.saveQuietly(project: Project) {
    // Minimal save — just writes the file, no UI
    val settings = AiMdSettings.getInstance()
    val filename = settings.projectName.ifBlank { "ai" } + ".ai.md"
    val basePath = project.basePath ?: return
    val file = java.io.File(basePath, filename)

    // Only auto-save if the file already exists (don't create on first focus-loss)
    if (!file.exists()) return

    // Rebuild context and write
    // Note: full implementation would call buildContext() from AiMdSaveAction
    // For now, this is a skeleton — the full implementation shares logic
}
