package com.aimd

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

@State(name = "AiMdSettings", storages = [Storage("aimd.xml")])
class AiMdSettings : PersistentStateComponent<AiMdSettings.State> {

    data class State(
        var githubToken: String = "",
        var gistId: String = "",
        var projectName: String = "",
        var cloudProvider: String = "gist",  // gist | gdrive | local
        var autoSaveOnClose: Boolean = true,
        var autoSaveOnFocusLoss: Boolean = true,
        var aiUpdateMode: String = "suggest", // suggest | auto | watch
    )

    private var myState = State()

    override fun getState(): State = myState
    override fun loadState(state: State) { myState = state }

    var githubToken: String
        get() = myState.githubToken
        set(value) { myState.githubToken = value }

    var gistId: String
        get() = myState.gistId
        set(value) { myState.gistId = value }

    var projectName: String
        get() = myState.projectName
        set(value) { myState.projectName = value }

    var cloudProvider: String
        get() = myState.cloudProvider
        set(value) { myState.cloudProvider = value }

    var autoSaveOnClose: Boolean
        get() = myState.autoSaveOnClose
        set(value) { myState.autoSaveOnClose = value }

    var autoSaveOnFocusLoss: Boolean
        get() = myState.autoSaveOnFocusLoss
        set(value) { myState.autoSaveOnFocusLoss = value }

    companion object {
        fun getInstance(): AiMdSettings =
            ApplicationManager.getApplication().getService(AiMdSettings::class.java)
    }
}
