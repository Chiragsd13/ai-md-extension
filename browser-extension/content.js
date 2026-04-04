/**
 * AI.md — Content Script
 *
 * Injects an "@AI.md" floating button and handles AIMD_INJECT messages from
 * the popup. Supports Claude, ChatGPT, Gemini, and AI Studio.
 */

(function () {
  'use strict';

  // ─── Platform map ─────────────────────────────────────────────────────────────

  const PLATFORMS = {
    'claude.ai': {
      inputSel: '.ProseMirror[contenteditable], [data-testid="chat-input"], [contenteditable="true"]',
      name: 'Claude',
      insertMode: 'prosemirror',
    },
    'chat.openai.com': {
      inputSel: '#prompt-textarea, [contenteditable="true"]',
      name: 'ChatGPT',
      insertMode: 'react-contenteditable',
    },
    'chatgpt.com': {
      inputSel: '#prompt-textarea, [contenteditable="true"]',
      name: 'ChatGPT',
      insertMode: 'react-contenteditable',
    },
    'gemini.google.com': {
      inputSel: '.ql-editor[contenteditable], rich-textarea [contenteditable], [contenteditable="true"]',
      name: 'Gemini',
      insertMode: 'quill',
    },
    'aistudio.google.com': {
      inputSel: 'textarea, [contenteditable="true"]',
      name: 'AI Studio',
      insertMode: 'textarea',
    },
  };

  const host     = location.hostname;
  const platform = Object.keys(PLATFORMS).find(k => host.includes(k));
  if (!platform) return;

  const cfg = PLATFORMS[platform];
  let btnEl = null;

  // ─── Message listener (from popup) ────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'AIMD_INJECT') {
      doInject(msg.filename)
        .then(() => sendResponse({ ok: true }))
        .catch(e => sendResponse({ error: e.message }));
      return true; // keep channel open for async
    }
  });

  // ─── Core inject ──────────────────────────────────────────────────────────────

  async function doInject(filename) {
    const resp = await chrome.runtime.sendMessage({ type: 'LOAD_CONTEXT', filename });
    if (!resp?.ok) throw new Error(resp?.error ?? 'Failed to load context from Gist');
    await insertIntoInput(resp.content);
  }

  // ─── Platform-specific text insertion ─────────────────────────────────────────
  //
  // Different AI platforms use different editor frameworks:
  //   Claude       → ProseMirror (contenteditable, execCommand works best)
  //   ChatGPT      → React-controlled contenteditable (needs React fiber trigger)
  //   Gemini       → Quill.js (contenteditable, dispatchEvent approach)
  //   AI Studio    → plain <textarea>

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

  // Plain <textarea> (AI Studio)
  function insertTextarea(el, text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(el, text);
    } else {
      el.value = text;
    }
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ProseMirror (Claude) — execCommand is the most reliable approach
  function insertProseMirror(el, text) {
    el.focus();
    // Select all and replace
    document.execCommand('selectAll', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (!ok) {
      // Fallback: direct DOM manipulation + dispatch
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true,
        inputType: 'insertText', data: text,
      }));
    }
  }

  // React-controlled contenteditable (ChatGPT)
  // React tracks input via its own synthetic event system. We need to
  // find the React fiber's onChange and call it, or use a nativeInputValueSetter
  // trick via Object.getOwnPropertyDescriptor.
  function insertReact(el, text) {
    el.focus();

    // Try execCommand first — works if React is listening to beforeinput
    document.execCommand('selectAll', false, null);
    const cmdOk = document.execCommand('insertText', false, text);
    if (cmdOk && el.textContent.includes(text.slice(0, 30))) return;

    // Fallback: set innerHTML directly and trigger React's event listener
    // React 16+ uses a "__reactFiber" or "__reactInternals" key
    const reactKey = Object.keys(el).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    const reactPropsKey = Object.keys(el).find(k => k.startsWith('__reactProps'));

    // Clear and set content
    el.innerHTML = '';
    const textNode = document.createTextNode(text);
    el.appendChild(textNode);

    // Trigger React's onChange via synthetic event
    if (reactPropsKey) {
      const props = el[reactPropsKey];
      if (typeof props?.onChange === 'function') {
        props.onChange({ target: el, currentTarget: el, bubbles: true });
      }
    }

    // Also dispatch native events as fallback
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true,
      inputType: 'insertText', data: text,
    }));
  }

  // Quill (Gemini) — Quill listens to clipboard events and beforeinput
  function insertQuill(el, text) {
    el.focus();

    // Quill responds best to execCommand
    document.execCommand('selectAll', false, null);
    const ok = document.execCommand('insertText', false, text);
    if (ok) return;

    // Quill fallback: set innerHTML with <p> tags per line, then dispatch
    const html = text
      .split('\n')
      .map(line => `<p>${line || '<br>'}</p>`)
      .join('');
    el.innerHTML = html;

    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: true,
      inputType: 'insertFromPaste',
    }));

    // Move cursor to end
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // ─── Wait for input to appear (for SPA navigation) ────────────────────────────

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
    btnEl.innerHTML = '⟳';
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
      showToast(`✓ ${filename} → ${cfg.name}`);
    } catch (err) {
      showToast(`✗ ${err.message}`, true);
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
    }, 400); // debounce: fire at most once per 400ms
  });

  function start() {
    observer.observe(document.body, { childList: true, subtree: true });
    injectButton();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 1200);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(start, 1200));
  }

})();
