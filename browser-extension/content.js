/**
 * AI.md — Content Script
 *
 * Injects an "@AI.md" floating button and handles AIMD_INJECT messages from
 * the popup. Supports Claude, ChatGPT, Gemini, and AI Studio.
 *
 * v2: Smart continuous monitoring — buffers important turns, auto-saves on
 *     triggers (tab close, token limit, battery low), and supports in-context
 *     AI-powered updates where the AI you're chatting with writes the .ai.md.
 */

(function () {
  'use strict';

  // ─── Platform map ─────────────────────────────────────────────────────────────

  const PLATFORMS = {
    'claude.ai': {
      inputSel:       '.ProseMirror[contenteditable], [data-testid="chat-input"], [contenteditable="true"]',
      name:           'Claude',
      insertMode:     'prosemirror',
      userTurnSel:    '[data-testid="human-turn"], .human-turn',
      aiTurnSel:      '[data-testid="ai-turn"], .ai-turn',
      sendBtnSel:     'button[aria-label="Send message"], [data-testid="send-button"]',
      generatingSel:  '[data-testid="stop-button"], [aria-label="Stop response"], button[aria-label="Stop"]',
      tokenWarnSel:   '[data-testid="token-count-warning"], .token-warning, [class*="context-window"]',
    },
    'chat.openai.com': {
      inputSel:       '#prompt-textarea, [contenteditable="true"]',
      name:           'ChatGPT',
      insertMode:     'react-contenteditable',
      userTurnSel:    '[data-message-author-role="user"]',
      aiTurnSel:      '[data-message-author-role="assistant"]',
      sendBtnSel:     'button[data-testid="send-button"], button[aria-label="Send prompt"]',
      generatingSel:  '[data-testid="stop-button"], button[aria-label="Stop generating"]',
      tokenWarnSel:   '.context-window-warning, [class*="context-exceeded"]',
    },
    'chatgpt.com': {
      inputSel:       '#prompt-textarea, [contenteditable="true"]',
      name:           'ChatGPT',
      insertMode:     'react-contenteditable',
      userTurnSel:    '[data-message-author-role="user"]',
      aiTurnSel:      '[data-message-author-role="assistant"]',
      sendBtnSel:     'button[data-testid="send-button"], button[aria-label="Send prompt"]',
      generatingSel:  '[data-testid="stop-button"], button[aria-label="Stop generating"]',
      tokenWarnSel:   '.context-window-warning, [class*="context-exceeded"]',
    },
    'gemini.google.com': {
      inputSel:       '.ql-editor[contenteditable], rich-textarea [contenteditable], [contenteditable="true"]',
      name:           'Gemini',
      insertMode:     'quill',
      userTurnSel:    '.query-text, user-query',
      aiTurnSel:      '.response-container, model-response',
      sendBtnSel:     'button[aria-label="Send message"], .send-button-container button',
      generatingSel:  'button[aria-label="Stop response"], .stop-button',
      tokenWarnSel:   '[class*="token-limit"], [class*="context-limit"]',
    },
    'aistudio.google.com': {
      inputSel:       'textarea, [contenteditable="true"]',
      name:           'AI Studio',
      insertMode:     'textarea',
      userTurnSel:    '.turn.user-turn, [class*="user"]',
      aiTurnSel:      '.turn.model-turn, [class*="model"]',
      sendBtnSel:     'button[aria-label="Run"], button[mattooltip="Run"]',
      generatingSel:  'button[aria-label="Stop"], .stop-button',
      tokenWarnSel:   '[class*="token-limit"], .token-warning',
    },
  };

  const host     = location.hostname;
  const platform = Object.keys(PLATFORMS).find(k => host.includes(k));
  if (!platform) return;

  const cfg = PLATFORMS[platform];
  let btnEl = null;

  // ─── Message listener (from popup / background) ───────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'AIMD_INJECT') {
      doInject(msg.filename)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }

    if (msg.type === 'AIMD_INJECT_RAW') {
      // Inject pre-loaded content directly (used for dual-file combined inject)
      insertIntoInput(msg.content)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ error: e.message }));
      return true;
    }

    if (msg.type === 'CAPTURE_CHAT') {
      try {
        sendResponse({ ok: true, data: captureConversation() });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
      return true;
    }

    if (msg.type === 'REQUEST_AI_UPDATE') {
      requestAIContextUpdate(msg.mode ?? 'suggest')
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    if (msg.type === 'GET_TURN_STATS') {
      sendResponse({
        ok: true,
        buffered: turnState.buffer.length,
        totalTracked: turnState.totalTracked,
        lastSaveTime: turnState.lastSaveTime,
      });
      return true;
    }
  });

  // ─── Core inject ──────────────────────────────────────────────────────────────

  async function doInject(filename) {
    const resp = await chrome.runtime.sendMessage({ type: 'LOAD_CONTEXT', filename });
    if (!resp?.ok) throw new Error(resp?.error ?? 'Failed to load context from Gist');
    await insertIntoInput(resp.content);
  }

  // ─── Platform-specific text insertion ─────────────────────────────────────────

  async function insertIntoInput(text) {
    const input = await waitForInput(3000);
    if (!input) throw new Error(`Chat input not found on ${cfg.name} — try refreshing`);

    input.focus();
    await delay(80);

    switch (cfg.insertMode) {
      case 'textarea':
        return insertTextarea(input, text);
      case 'react-contenteditable':
        return insertReact(input, text);
      case 'quill':
        return insertQuill(input, text);
      case 'prosemirror':
      default:
        return insertProseMirror(input, text);
    }
  }

  function insertTextarea(el, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) { setter.call(el, text); } else { el.value = text; }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function insertProseMirror(el, text) {
    el.focus();
    document.execCommand('selectAll', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: text,
      }));
    }
  }

  function insertReact(el, text) {
    el.focus();
    document.execCommand('selectAll', false, null);
    const cmdOk = document.execCommand('insertText', false, text);
    if (cmdOk && el.textContent.includes(text.slice(0, 30))) return;

    const reactPropsKey = Object.keys(el).find(k => k.startsWith('__reactProps'));
    el.innerHTML = '';
    el.appendChild(document.createTextNode(text));
    if (reactPropsKey) {
      const props = el[reactPropsKey];
      if (typeof props?.onChange === 'function') {
        props.onChange({ target: el, currentTarget: el, bubbles: true });
      }
    }
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertText', data: text,
    }));
  }

  function insertQuill(el, text) {
    el.focus();
    document.execCommand('selectAll', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (ok) return;

    el.innerHTML = text.split('\n').map(line => `<p>${line || '<br>'}</p>`).join('');
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true, inputType: 'insertFromPaste',
    }));
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // ─── Wait for input (SPA navigation) ─────────────────────────────────────────

  function waitForInput(timeoutMs) {
    const el = getInputEl();
    if (el) return Promise.resolve(el);
    return new Promise(resolve => {
      const deadline = Date.now() + timeoutMs;
      const interval = setInterval(() => {
        const found = getInputEl();
        if (found || Date.now() > deadline) {
          clearInterval(interval);
          resolve(found ?? null);
        }
      }, 150);
    });
  }

  function getInputEl() {
    const sels = cfg.inputSel.split(', ');
    for (const sel of sels) {
      const candidates = document.querySelectorAll(sel.trim());
      for (const el of candidates) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 50 && rect.height > 8) return el;
      }
    }
    return null;
  }

  // ─── Floating button ──────────────────────────────────────────────────────────

  function injectButton() {
    if (btnEl && document.contains(btnEl)) return;
    document.getElementById('aimd-btn')?.remove();

    btnEl = document.createElement('button');
    btnEl.id        = 'aimd-btn';
    btnEl.innerHTML = '<span style="color:#888;margin-right:3px;font-weight:400">@</span>AI.md';
    btnEl.title     = `Inject saved project context into ${cfg.name}`;

    Object.assign(btnEl.style, {
      position:      'fixed',
      bottom:        '90px',
      right:         '20px',
      zIndex:        '2147483647',
      background:    '#0c0c0c',
      color:         '#e0e0e0',
      border:        '1px solid #282828',
      borderRadius:  '8px',
      padding:       '7px 13px',
      fontFamily:    "'Courier New', Courier, monospace",
      fontSize:      '13px',
      fontWeight:    '700',
      cursor:        'pointer',
      boxShadow:     '0 4px 20px rgba(0,0,0,0.5)',
      letterSpacing: '0.2px',
      lineHeight:    '1',
      userSelect:    'none',
      transition:    'background 0.12s, border-color 0.12s, box-shadow 0.12s',
    });

    btnEl.addEventListener('mouseenter', () => {
      Object.assign(btnEl.style, { background: '#181818', borderColor: '#3a3a3a' });
    });
    btnEl.addEventListener('mouseleave', () => {
      Object.assign(btnEl.style, { background: '#0c0c0c', borderColor: '#282828' });
    });
    btnEl.addEventListener('click', handleBtnClick);
    document.body.appendChild(btnEl);
  }

  async function handleBtnClick() {
    const origHTML = btnEl.innerHTML;
    btnEl.innerHTML = '&#x27F3;';
    btnEl.disabled  = true;

    try {
      const { githubToken, gistId, defaultProject } = await chrome.storage.sync.get([
        'githubToken', 'gistId', 'defaultProject',
      ]);
      if (!githubToken) {
        showToast('Set up AI.md first — click the toolbar icon', true);
        return;
      }
      const project  = (defaultProject ?? '').trim();
      const filename = toFilename(project);
      await doInject(filename);
      showToast(`\u2713 ${filename} \u2192 ${cfg.name}`);
    } catch (err) {
      showToast(`\u2717 ${err.message}`, true);
    } finally {
      btnEl.innerHTML = origHTML;
      btnEl.disabled  = false;
    }
  }

  // ─── Toast ────────────────────────────────────────────────────────────────────

  function showToast(msg, isError = false) {
    document.getElementById('aimd-toast')?.remove();
    const t = document.createElement('div');
    t.id = 'aimd-toast';
    t.textContent = msg;
    Object.assign(t.style, {
      position:      'fixed',
      bottom:        '138px',
      right:         '20px',
      zIndex:        '2147483647',
      background:    isError ? '#3a0a0a' : '#0a1a0a',
      color:         isError ? '#ff8080' : '#80ffb0',
      border:        `1px solid ${isError ? '#6a1a1a' : '#1a4a2a'}`,
      padding:       '7px 14px',
      borderRadius:  '6px',
      fontFamily:    "'Courier New', Courier, monospace",
      fontSize:      '12px',
      maxWidth:      '320px',
      boxShadow:     '0 2px 12px rgba(0,0,0,0.5)',
      opacity:       '1',
      transition:    'opacity 0.3s ease',
      lineHeight:    '1.4',
    });
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, 3500);
  }

  // ─── Conversation capture ─────────────────────────────────────────────────────

  function captureConversation() {
    const userNodes = cfg.userTurnSel ? [...document.querySelectorAll(cfg.userTurnSel)] : [];
    const aiNodes   = cfg.aiTurnSel   ? [...document.querySelectorAll(cfg.aiTurnSel)]   : [];

    const extractText = (el) => {
      const raw = el.innerText?.trim() ?? el.textContent?.trim() ?? '';
      return raw.replace(/\n{3,}/g, '\n\n').trim();
    };

    const userMessages = userNodes
      .map(extractText)
      .filter(t => t.length > 2)
      .slice(-10);

    return {
      platform:      cfg.name,
      capturedAt:    new Date().toISOString(),
      url:           location.href,
      userMessages,
      totalTurns:    userNodes.length + aiNodes.length,
      bufferedTurns: turnState.buffer.slice(), // include smart-tracked turns
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // SMART CONTINUOUS MONITORING — v2
  //
  // Watches for completed AI responses. After each, scores the turn for
  // importance. When enough important turns accumulate or a trigger fires,
  // auto-saves the buffer to cloud storage.
  // ═══════════════════════════════════════════════════════════════════════════════

  // ─── Importance scoring ─────────────────────────────────────────────────────

  function isImportantTurn(userMsg, aiMsg) {
    const combined = (userMsg + ' ' + aiMsg).toLowerCase();
    let score = 0;

    if (combined.length > 600)                                                  score++;
    if (/```/.test(combined))                                                   score += 2; // code blocks
    if (/`[a-zA-Z_.\-/]+`/.test(combined))                                     score++;    // inline code refs
    if (/\b(function|class|def |const |import |export |interface )\b/.test(combined)) score++;
    if (/\.(js|ts|py|go|rs|java|tsx|jsx|md|json|yaml|sh|css|html|vue|svelte)\b/.test(combined)) score++;
    if (/\b(error|bug|fix|implement|create|build|add|update|refactor|install|deploy|migrate)\b/.test(combined)) score++;
    if (aiMsg.includes('\n') && aiMsg.length > 400)                             score++;    // structured long response
    if (userMsg.split(/\s+/).length > 20)                                       score++;    // detailed prompt
    if (/\b(how|why|what|can you|please|help|make|write|generate)\b/i.test(userMsg)) score++;

    return score >= 3;
  }

  function extractAISummary(text) {
    // First 600 chars, ending at a sentence boundary if possible
    if (text.length <= 600) return text;
    const truncated = text.slice(0, 600);
    const lastPeriod = truncated.lastIndexOf('. ');
    return (lastPeriod > 200 ? truncated.slice(0, lastPeriod + 1) : truncated) + '...';
  }

  // ─── Turn state + monitor ──────────────────────────────────────────────────

  const turnState = {
    buffer:         [],     // buffered important turns not yet saved
    lastSaveTime:   0,
    totalTracked:   0,
    wasGenerating:  false,
    aiTurnCount:    0,
    tokenWarned:    false,
    SAVE_EVERY_N:   5,                  // auto-save after N important turns
    SAVE_INTERVAL:  8 * 60 * 1000,      // or every 8 minutes
  };

  let turnPollId = null;

  function startTurnMonitor() {
    if (turnPollId) return;
    turnState.aiTurnCount = cfg.aiTurnSel
      ? document.querySelectorAll(cfg.aiTurnSel).length : 0;
    turnPollId = setInterval(pollForTurnCompletion, 2000);
  }

  function pollForTurnCompletion() {
    const isGen = cfg.generatingSel ? !!document.querySelector(cfg.generatingSel) : false;
    const aiNodes = cfg.aiTurnSel ? document.querySelectorAll(cfg.aiTurnSel) : [];
    const newCount = aiNodes.length;

    // Token warning detection
    if (!turnState.tokenWarned && cfg.tokenWarnSel && document.querySelector(cfg.tokenWarnSel)) {
      turnState.tokenWarned = true;
      triggerAutoSave('token_limit');
    }

    // Detect turn completion: was generating, now stopped, new turn appeared
    if (turnState.wasGenerating && !isGen && newCount > turnState.aiTurnCount) {
      turnState.aiTurnCount = newCount;
      onTurnCompleted(aiNodes);
    }
    // Also handle quiet completions (generating never detected)
    else if (!isGen && newCount > turnState.aiTurnCount) {
      turnState.aiTurnCount = newCount;
      setTimeout(() => onTurnCompleted(aiNodes), 1500); // delay — ensure render done
    }

    turnState.wasGenerating = isGen;
  }

  function onTurnCompleted(aiNodes) {
    const userNodes = cfg.userTurnSel ? [...document.querySelectorAll(cfg.userTurnSel)] : [];
    const lastUser  = userNodes[userNodes.length - 1]?.innerText?.trim() ?? '';
    const lastAI    = [...aiNodes][aiNodes.length - 1]?.innerText?.trim() ?? '';

    if (!lastUser || !lastAI) return;
    if (lastUser.includes('[AI.md') || lastUser.includes('AI.md:')) return; // skip meta-prompts

    turnState.totalTracked++;

    if (!isImportantTurn(lastUser, lastAI)) return;

    turnState.buffer.push({
      prompt:  lastUser.slice(0, 600),
      summary: extractAISummary(lastAI),
      ts:      new Date().toISOString(),
    });

    // Auto-save when buffer fills or time threshold exceeded
    const msSinceSave = Date.now() - turnState.lastSaveTime;
    if (
      turnState.buffer.length >= turnState.SAVE_EVERY_N ||
      (turnState.buffer.length > 0 && msSinceSave > turnState.SAVE_INTERVAL)
    ) {
      triggerAutoSave('smart_batch');
    }
  }

  // ─── Auto-save triggers ───────────────────────────────────────────────────

  let autoSavePending = false;

  function triggerAutoSave(reason) {
    if (autoSavePending) return;
    autoSavePending = true;

    setTimeout(async () => {
      try {
        const { defaultProject, autoSaveEnabled } = await chrome.storage.sync.get([
          'defaultProject', 'autoSaveEnabled',
        ]);

        // autoSaveEnabled defaults to true — only skip if explicitly false
        if (autoSaveEnabled === false) { autoSavePending = false; return; }

        const filename = toFilename((defaultProject ?? '').trim());
        const captured = captureConversation(); // includes bufferedTurns
        turnState.buffer = [];
        turnState.lastSaveTime = Date.now();

        await chrome.runtime.sendMessage({
          type:        'SAVE_CHAT_CONTEXT',
          filename,
          captureData: captured,
          reason,
        });

        // Silent for periodic batches, visible for events
        if (reason !== 'smart_batch') {
          showToast(`\u2713 Context auto-saved (${reason.replace(/_/g, ' ')})`, false);
        }
      } catch {
        // Silent — auto-save should never interrupt the user
      } finally {
        autoSavePending = false;
      }
    }, 600);
  }

  function setupAutoSaveTriggers() {
    // 1. Tab / window closing
    window.addEventListener('beforeunload', () => {
      if (turnState.buffer.length > 0 || turnState.totalTracked > 2) {
        triggerAutoSave('session_end');
      }
    });

    // 2. User switches away (minimize, alt-tab, focus lost)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && turnState.buffer.length > 0) {
        triggerAutoSave('visibility_hidden');
      }
    });

    // 3. Battery running low
    if (typeof navigator.getBattery === 'function') {
      navigator.getBattery().then(battery => {
        const check = () => {
          if (!battery.charging && battery.level <= 0.10) {
            triggerAutoSave('battery_low');
          }
        };
        battery.addEventListener('levelchange', check);
        battery.addEventListener('chargingchange', check);
      }).catch(() => {});
    }

    // 4. Periodic check: every 10min, if anything is buffered, save it
    setInterval(() => {
      if (turnState.buffer.length > 0) {
        triggerAutoSave('periodic');
      }
    }, 10 * 60 * 1000);
  }

  // ─── In-context AI update ─────────────────────────────────────────────────
  //
  // Injects a structured meta-prompt asking the AI you're currently chatting
  // with (Claude, ChatGPT, Gemini) to write an updated AI.md context doc.
  //
  // Modes:
  //   'suggest'  — injects text into the input box. User reviews and sends.
  //   'auto'     — injects + clicks Send + captures the AI response + saves.
  //   'watch'    — just starts listening for the next AI response that looks
  //                like an AI.md doc (user composes the prompt themselves).

  function buildUpdatePrompt() {
    return [
      '---',
      '**[AI.md: Context Update Request]**',
      '',
      'Please write TWO updated AI.md files for this session.',
      '',
      '**FILE 1 — Technical Context:**',
      '```markdown',
      '# AI Context',
      '',
      `> **Session:** ${new Date().toLocaleDateString()}  |  **Platform:** ${cfg.name}`,
      '',
      '## Current Task',
      '[What we are working on right now — be specific]',
      '',
      '## Progress This Session',
      '- [List each concrete thing accomplished or discussed]',
      '',
      '## Key Technical Details',
      '- [Important files, code patterns, commands, errors from this session]',
      '',
      '## Next Steps',
      '1. [Ordered list of what to do next time]',
      '',
      '## Context Notes',
      '[Constraints, decisions, things to remember]',
      '```',
      '',
      '**FILE 2 — Preferences (only if you learned something new about how I prefer responses):**',
      '```markdown',
      '# AI Preferences',
      '',
      '## Response Style',
      '| Setting | Value |',
      '|---|---|',
      '| Style | [concise/detailed/step-by-step] |',
      '| Tone | [professional/casual/technical] |',
      '',
      '## Rules & Constraints',
      '- [Any rules learned from this conversation]',
      '```',
      '',
      '*Reply with the markdown documents above. Separate them with `---`. They will be auto-captured by AI.md.*',
      '---',
    ].join('\n');
  }

  async function requestAIContextUpdate(mode = 'suggest') {
    const prompt = buildUpdatePrompt();

    if (mode === 'watch') {
      showToast('Watching for AI.md context in next AI response...', false);
      watchForContextResponse();
      return;
    }

    const input = await waitForInput(3000);
    if (!input) throw new Error('Chat input not found');
    await insertIntoInput(prompt);

    if (mode !== 'auto') {
      showToast('Update prompt ready \u2014 review and send it', false);
      watchForContextResponse(); // start watching even in suggest mode
      return;
    }

    // Auto mode: click Send + capture
    await delay(500);
    const sendBtn = cfg.sendBtnSel ? document.querySelector(cfg.sendBtnSel) : null;

    if (!sendBtn || sendBtn.disabled) {
      showToast('Prompt ready \u2014 click Send. AI.md will capture the response.', false);
      watchForContextResponse();
      return;
    }

    const beforeCount = cfg.aiTurnSel
      ? document.querySelectorAll(cfg.aiTurnSel).length : 0;

    sendBtn.click();
    showToast('\u27F3 AI is generating context update\u2026', false);

    try {
      const response = await waitForAIResponse(beforeCount, 90000);
      if (response && looksLikeContextDoc(response)) {
        await saveAIGeneratedContext(response);
        showToast('\u2713 AI-generated context saved!', false);
      } else {
        showToast('Response captured but doesn\'t look like AI.md format. Skipped.', true);
      }
    } catch {
      showToast('Timeout \u2014 try sending the prompt manually', true);
    }
  }

  function looksLikeContextDoc(text) {
    const markers = ['## Current Task', '## Progress', '## Next Steps', '# AI Context', '# AI Preferences', '## Response Style'];
    return markers.filter(m => text.includes(m)).length >= 2;
  }

  async function waitForAIResponse(beforeCount, timeoutMs = 90000) {
    await delay(2000);
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const poll = setInterval(() => {
        const isGen = cfg.generatingSel ? !!document.querySelector(cfg.generatingSel) : false;
        const nodes = cfg.aiTurnSel ? [...document.querySelectorAll(cfg.aiTurnSel)] : [];

        if (nodes.length > beforeCount && !isGen) {
          clearInterval(poll);
          const last = nodes[nodes.length - 1]?.innerText?.trim() ?? '';
          resolve(last);
        }

        if (Date.now() > deadline) {
          clearInterval(poll);
          reject(new Error('Timeout'));
        }
      }, 1500);
    });
  }

  function watchForContextResponse() {
    const beforeCount = cfg.aiTurnSel
      ? document.querySelectorAll(cfg.aiTurnSel).length : 0;

    waitForAIResponse(beforeCount, 180000).then(async (text) => {
      if (text && looksLikeContextDoc(text)) {
        await saveAIGeneratedContext(text);
        showToast('\u2713 AI context update captured and saved!', false);
      }
    }).catch(() => { /* timeout or user never sent — silent */ });
  }

  async function saveAIGeneratedContext(content) {
    const { defaultProject } = await chrome.storage.sync.get('defaultProject');
    const project = (defaultProject ?? '').trim();
    const base = project?.toLowerCase()?.replace(/\s+/g, '-') || 'ai';

    // Check if the AI returned both files (split by ---)
    const parts = content.split(/\n---\n/).filter(p => p.trim().length > 50);
    const hasTech = content.includes('# AI Context') || content.includes('## Current Task');
    const hasPrefs = content.includes('# AI Preferences') || content.includes('## Response Style');

    if (hasTech) {
      // Extract technical part
      const techPart = hasPrefs
        ? parts.find(p => p.includes('# AI Context') || p.includes('## Current Task')) ?? content
        : content;

      await chrome.runtime.sendMessage({
        type:     'SAVE_AI_GENERATED_CONTEXT',
        filename: `${base}.technical.ai.md`,
        content:  techPart.trim(),
        platform: cfg.name,
      });
    }

    if (hasPrefs) {
      const prefPart = parts.find(p => p.includes('# AI Preferences') || p.includes('## Response Style'));
      if (prefPart) {
        await chrome.runtime.sendMessage({
          type:     'SAVE_AI_GENERATED_CONTEXT',
          filename: `${base}.preferences.ai.md`,
          content:  prefPart.trim(),
          platform: cfg.name,
        });
      }
    }

    // Also save legacy combined file for backwards compat
    await chrome.runtime.sendMessage({
      type:     'SAVE_AI_GENERATED_CONTEXT',
      filename: toFilename(project),
      content,
      platform: cfg.name,
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function toFilename(project) {
    if (!project || project === 'ai.md') return 'ai.md';
    if (project.endsWith('.ai.md')) return project;
    return `${project.toLowerCase().replace(/\s+/g, '-')}.ai.md`;
  }

  function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ─── MutationObserver — debounced, survives SPA navigation ───────────────────

  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!document.getElementById('aimd-btn')) {
        btnEl = null;
        injectButton();
      }
    }, 400);
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true });
    injectButton();
    setupAutoSaveTriggers();
    startTurnMonitor();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 1200);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 1200));
  }

})();
