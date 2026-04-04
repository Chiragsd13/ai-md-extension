package com.aimd

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.openapi.util.Disposer

class AiMdStatusBarFactory : StatusBarWidgetFactory {
    override fun getId(): String = "AiMdStatusBar"
    override fun getDisplayName(): String = "AI.md Status"
    override fun isAvailable(project: Project): Boolean = true

    override fun createWidget(project: Project): StatusBarWidget {
        return AiMdStatusBarWidget(project)
    }

    override fun disposeWidget(widget: StatusBarWidget) {
        Disposer.dispose(widget)
    }

    override fun canBeEnabledOn(statusBar: StatusBar): Boolean = true
}

class AiMdStatusBarWidget(private val project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation {
    override fun ID(): String = "AiMdStatusBar"

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    override fun getText(): String {
        val settings = AiMdSettings.getInstance()
        return if (settings.githubToken.isNotBlank()) {
            "@ai.md \u2713"
        } else {
            "@ai.md"
        }
    }

    override fun getTooltipText(): String = "AI.md — click to save context"

    override fun getAlignment(): Float = 0f

    override fun install(statusBar: StatusBar) {}
    override fun dispose() {}
}
