package com.aimd

import com.intellij.openapi.options.Configurable
import javax.swing.*
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.Insets

/**
 * Settings UI: Settings > Tools > AI.md
 */
class AiMdSettingsConfigurable : Configurable {
    private var tokenField: JPasswordField? = null
    private var gistIdField: JTextField? = null
    private var projectField: JTextField? = null
    private var autoCloseCheck: JCheckBox? = null
    private var autoFocusCheck: JCheckBox? = null
    private var providerCombo: JComboBox<String>? = null

    override fun getDisplayName(): String = "AI.md"

    override fun createComponent(): JComponent {
        val panel = JPanel(GridBagLayout())
        val gbc = GridBagConstraints().apply {
            fill = GridBagConstraints.HORIZONTAL
            insets = Insets(4, 4, 4, 4)
            weightx = 1.0
        }

        var row = 0

        // Cloud Provider
        gbc.gridy = row; gbc.gridx = 0; gbc.weightx = 0.0
        panel.add(JLabel("Cloud Provider:"), gbc)
        gbc.gridx = 1; gbc.weightx = 1.0
        providerCombo = JComboBox(arrayOf("GitHub Gist", "Google Drive", "Local File"))
        panel.add(providerCombo, gbc)

        // GitHub Token
        row++
        gbc.gridy = row; gbc.gridx = 0; gbc.weightx = 0.0
        panel.add(JLabel("GitHub Token:"), gbc)
        gbc.gridx = 1; gbc.weightx = 1.0
        tokenField = JPasswordField(30)
        panel.add(tokenField, gbc)

        // Gist ID
        row++
        gbc.gridy = row; gbc.gridx = 0; gbc.weightx = 0.0
        panel.add(JLabel("Gist ID:"), gbc)
        gbc.gridx = 1; gbc.weightx = 1.0
        gistIdField = JTextField(30)
        panel.add(gistIdField, gbc)

        // Project
        row++
        gbc.gridy = row; gbc.gridx = 0; gbc.weightx = 0.0
        panel.add(JLabel("Project Name:"), gbc)
        gbc.gridx = 1; gbc.weightx = 1.0
        projectField = JTextField(30)
        panel.add(projectField, gbc)

        // Auto-save checkboxes
        row++
        gbc.gridy = row; gbc.gridx = 0; gbc.gridwidth = 2
        autoCloseCheck = JCheckBox("Auto-save on project close", true)
        panel.add(autoCloseCheck, gbc)

        row++
        gbc.gridy = row
        autoFocusCheck = JCheckBox("Auto-save on window focus loss", true)
        panel.add(autoFocusCheck, gbc)

        // Spacer
        row++
        gbc.gridy = row; gbc.weighty = 1.0
        panel.add(JPanel(), gbc)

        return panel
    }

    override fun isModified(): Boolean {
        val s = AiMdSettings.getInstance()
        return tokenField?.let { String(it.password) } != s.githubToken ||
               gistIdField?.text != s.gistId ||
               projectField?.text != s.projectName ||
               autoCloseCheck?.isSelected != s.autoSaveOnClose ||
               autoFocusCheck?.isSelected != s.autoSaveOnFocusLoss
    }

    override fun apply() {
        val s = AiMdSettings.getInstance()
        s.githubToken = tokenField?.let { String(it.password) } ?: ""
        s.gistId = gistIdField?.text ?: ""
        s.projectName = projectField?.text ?: ""
        s.autoSaveOnClose = autoCloseCheck?.isSelected ?: true
        s.autoSaveOnFocusLoss = autoFocusCheck?.isSelected ?: true
        s.cloudProvider = when (providerCombo?.selectedIndex) {
            1 -> "gdrive"
            2 -> "local"
            else -> "gist"
        }
    }

    override fun reset() {
        val s = AiMdSettings.getInstance()
        tokenField?.text = s.githubToken
        gistIdField?.text = s.gistId
        projectField?.text = s.projectName
        autoCloseCheck?.isSelected = s.autoSaveOnClose
        autoFocusCheck?.isSelected = s.autoSaveOnFocusLoss
        providerCombo?.selectedIndex = when (s.cloudProvider) {
            "gdrive" -> 1
            "local" -> 2
            else -> 0
        }
    }
}
