const ORCHESTRATOR_FILE = 'skills/orchestrator.md';

let auth = null;
let db = null;
let candidates = [];
let routingCandidates = [];
let busy = false;

const ui = {
  authView: document.getElementById('auth-view'),
  chatView: document.getElementById('chat-view'),
  tabLogin: document.getElementById('tab-login'),
  tabSignup: document.getElementById('tab-signup'),
  authForm: document.getElementById('auth-form'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  authError: document.getElementById('auth-error'),
  authSubmit: document.getElementById('auth-submit'),
  messages: document.getElementById('messages'),
  chatForm: document.getElementById('chat-form'),
  chatInput: document.getElementById('chat-input'),
  sendBtn: document.getElementById('send-btn'),
  signoutBtn: document.getElementById('signout-btn'),
  userEmail: document.getElementById('user-email'),
  quotaLabel: document.getElementById('quota-label'),
  historyBtn: document.getElementById('history-btn'),
  historyPanel: document.getElementById('history-panel'),
  historyList: document.getElementById('history-list'),
  closeHistoryBtn: document.getElementById('close-history-btn')
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function extractGithubUrl(text) {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/[\w.-]+\/[\w.-]+/);
  return m ? m[0] : null;
}

function detectInputType(text) {
  if (extractGithubUrl(text)) return 'repo';
  if (/```|<\/|=>|function\s*\(|\bfunction\b|def\s+\w+\s*\(/.test(text)) return 'snippet';
  return 'question';
}

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.text();
}

function friendlyError(err) {
  if (err && err.userMessage) return err.userMessage;
  if (err && err.status === 429) return 'The AI service is rate-limited right now. Wait a minute and try again.';
  if (err && err.status === 403) return 'The AI API key was rejected. Check the key and its referrer restrictions.';
  if (err && (err.name === 'TypeError' || err.message === 'Failed to fetch')) return 'Network problem — check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

// ── AI Call ───────────────────────────────────────────────────────────────────

async function callGemini(systemPrompt, userText) {
  const model = APP_CONFIG.GEMINI_MODEL || 'gemini-flash-lite-latest';
  const key = APP_CONFIG.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }]
      })
    });
  } catch (e) {
    const err = new Error('Failed to fetch');
    err.name = 'TypeError';
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Gemini request failed with status ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const text = (data.candidates || [])[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!text) throw new Error('Empty response from AI');
  return text;
}

// ── Skill Routing ─────────────────────────────────────────────────────────────

function parseOrchestratorReply(text) {
  const lines = text.split('\n');
  for (const line of lines) {
    if (/^Routing to/i.test(line.trim())) {
      const m = line.trim().match(/^Routing to\s+(.+?)\s*(?:—|-)/);
      if (m) return { type: 'route', label: m[1].trim(), line: line.trim() };
    }
  }
  return { type: 'clarify' };
}

function findRoutedSkill(label) {
  const norm = normalizeName(label);
  for (const c of routingCandidates) {
    if (normalizeName(c.name) === norm) return c;
  }
  for (const c of routingCandidates) {
    if (norm.includes(normalizeName(c.name))) return c;
  }
  return null;
}

async function loadRegistry() {
  const raw = await fetchText('config/skills.json');
  const data = JSON.parse(raw);
  candidates = data.skills || [];
  routingCandidates = candidates.filter(c => c.file !== ORCHESTRATOR_FILE);
}

// ── Chat UI ───────────────────────────────────────────────────────────────────

function addMessage(kind, text) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  if (kind === 'assistant' || kind === 'error') {
    el.innerHTML = window.marked ? window.marked.parse(text) : text;
  } else {
    el.textContent = text;
  }
  ui.messages.appendChild(el);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  return el;
}

function addPipelineMessage(inspector, refactor, review) {
  const wrapper = document.createElement('div');
  wrapper.className = 'pipeline-wrapper';

  const title = document.createElement('div');
  title.className = 'pipeline-title';
  title.innerHTML = '<span>⚡</span> Code Doctor Triage Pipeline';
  wrapper.appendChild(title);

  const container = document.createElement('div');
  container.className = 'pipeline-container';

  const boxInspector = document.createElement('div');
  boxInspector.className = 'pipeline-box inspector';
  boxInspector.innerHTML = `
    <div class="pipeline-box-header"><span>🔍</span> Code Inspector Report</div>
    <div class="pipeline-box-body">${window.marked ? window.marked.parse(inspector) : inspector}</div>
  `;
  container.appendChild(boxInspector);

  const boxRefactor = document.createElement('div');
  boxRefactor.className = 'pipeline-box refactor';
  boxRefactor.innerHTML = `
    <div class="pipeline-box-header"><span>🛠️</span> Refactored Code</div>
    <div class="pipeline-box-body">${window.marked ? window.marked.parse(refactor) : refactor}</div>
  `;
  container.appendChild(boxRefactor);

  const boxReview = document.createElement('div');
  boxReview.className = 'pipeline-box review';
  boxReview.innerHTML = `
    <div class="pipeline-box-header"><span>📝</span> Review & Verdict Report</div>
    <div class="pipeline-box-body">${window.marked ? window.marked.parse(review) : review}</div>
  `;
  container.appendChild(boxReview);

  wrapper.appendChild(container);
  ui.messages.appendChild(wrapper);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  return wrapper;
}

function addStatus(text) {
  const el = document.createElement('div');
  el.className = 'msg status';
  el.innerHTML = `
    <div class="loader-wrap">
      <div class="lb"></div><div class="lb"></div>
      <div class="lb"></div><div class="lb"></div>
    </div>
    <span class="status-text"></span>`;
  el.querySelector('.status-text').textContent = text;
  ui.messages.appendChild(el);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  return el;
}

function setBusy(state) {
  busy = state;
  ui.sendBtn.disabled = state;
  ui.chatInput.disabled = state;
}

// ── Save / Delete Actions ─────────────────────────────────────────────────────

function addActionButtons(elements, exchangeData) {
  // Remove any leftover action bar from previous response
  const existing = ui.messages.querySelector('.msg-actions');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'msg-actions';
  el.innerHTML = `
    <button class="action-btn save-btn" id="save-response-btn">💾 Save</button>
    <button class="action-btn delete-btn" id="delete-response-btn">🗑 Delete</button>
  `;

  el.querySelector('#save-response-btn').addEventListener('click', async () => {
    const saveBtn = el.querySelector('#save-response-btn');
    const delBtn  = el.querySelector('#delete-response-btn');
    saveBtn.disabled = true;
    delBtn.disabled  = true;
    saveBtn.textContent = 'Saving…';

    try {
      const user = auth.currentUser;
      const ref = await db.collection('users').doc(user.uid).collection('saved').add({
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        ...exchangeData
      });
      saveBtn.textContent = '✓ Saved!';
      // Add immediately to the history panel (no reload needed)
      renderHistoryItem(ref.id, { ...exchangeData, createdAt: new Date() }, true);
      setTimeout(() => el.remove(), 1200);
    } catch (e) {
      saveBtn.textContent = '💾 Save';
      saveBtn.disabled = false;
      delBtn.disabled  = false;
    }
  });

  el.querySelector('#delete-response-btn').addEventListener('click', () => {
    elements.filter(Boolean).forEach(e => e && e.remove());
    el.remove();
  });

  ui.messages.appendChild(el);
  ui.messages.scrollTop = ui.messages.scrollHeight;
  return el;
}

// ── Saved History Panel ───────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(val) {
  const d = val instanceof Date ? val : (val?.toDate ? val.toDate() : new Date());
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function createHistoryItemElement(docId, data) {
  const isPipeline = data.isPipeline || !!(data.inspectorOutput || data.refactorOutput || data.reviewOutput);
  const badge = isPipeline ? '⚡ Pipeline' : data.inputType === 'repo' ? '🔬 Repo Doctor' : '💬 Answer';
  const dateStr = formatDate(data.createdAt);

  const userText = data.userText || data.prompt || (data.role === 'user' ? data.text : '') || '';
  const aiText   = data.aiText || data.response || (data.role === 'assistant' ? data.text : '') || (data.text && !userText ? data.text : '') || '';

  const item = document.createElement('div');
  item.className = 'history-item expanded';
  item.dataset.docId = docId;

  // Render User Input Code/Question
  const userTextHtml = userText ? `
    <div class="history-section">
      <div class="history-section-title">👤 Input Code / Question</div>
      <div class="history-code-block"><pre><code>${escapeHtml(userText)}</code></pre></div>
    </div>` : '';

  // Render AI Output
  let aiOutputHtml = '';
  if (isPipeline) {
    aiOutputHtml = `
      <div class="history-section">
        <div class="history-section-title">⚡ Doctor Triage Pipeline Report</div>
        <div class="history-pipeline-box inspector">
          <div class="hp-box-title">🔍 Code Inspector Report</div>
          <div class="hp-box-content">${window.marked ? window.marked.parse(data.inspectorOutput || 'N/A') : escapeHtml(data.inspectorOutput || 'N/A')}</div>
        </div>
        <div class="history-pipeline-box refactor">
          <div class="hp-box-title">🛠️ Refactored Code</div>
          <div class="hp-box-content">${window.marked ? window.marked.parse(data.refactorOutput || 'N/A') : escapeHtml(data.refactorOutput || 'N/A')}</div>
        </div>
        <div class="history-pipeline-box review">
          <div class="hp-box-title">📝 Review & Verdict Report</div>
          <div class="hp-box-content">${window.marked ? window.marked.parse(data.reviewOutput || 'N/A') : escapeHtml(data.reviewOutput || 'N/A')}</div>
        </div>
      </div>
    `;
  } else if (aiText) {
    aiOutputHtml = `
      <div class="history-section">
        <div class="history-section-title">🤖 AI Diagnosis</div>
        <div class="history-ai-content">${window.marked ? window.marked.parse(aiText) : escapeHtml(aiText)}</div>
      </div>
    `;
  } else if (!userTextHtml) {
    const rawContent = typeof data.text === 'string' ? data.text : JSON.stringify(data, null, 2);
    aiOutputHtml = `
      <div class="history-section">
        <div class="history-section-title">📄 Saved Content</div>
        <div class="history-ai-content">${window.marked ? window.marked.parse(rawContent) : escapeHtml(rawContent)}</div>
      </div>
    `;
  }

  item.innerHTML = `
    <div class="history-item-header">
      <div class="history-item-meta">
        <span class="history-badge">${badge}</span>
        <span class="history-date">${dateStr}</span>
      </div>
      <div class="history-item-actions">
        <button class="history-toggle-btn" type="button">Collapse</button>
        <button class="history-delete-btn" type="button" title="Delete this saved item">🗑 Delete</button>
      </div>
    </div>
    <div class="history-item-body">
      ${userTextHtml}
      ${aiOutputHtml}
    </div>
  `;


  // Toggle Collapse / Expand
  const toggleBtn = item.querySelector('.history-toggle-btn');
  const bodyEl = item.querySelector('.history-item-body');
  toggleBtn.addEventListener('click', () => {
    const isExpanded = item.classList.contains('expanded');
    if (isExpanded) {
      item.classList.remove('expanded');
      bodyEl.style.display = 'none';
      toggleBtn.textContent = 'Expand';
    } else {
      item.classList.add('expanded');
      bodyEl.style.display = 'block';
      toggleBtn.textContent = 'Collapse';
    }
  });

  // Delete Action
  const delBtn = item.querySelector('.history-delete-btn');
  delBtn.addEventListener('click', async e => {
    e.stopPropagation();
    delBtn.textContent = 'Deleting…';
    delBtn.disabled = true;
    try {
      const user = auth.currentUser;
      await db.collection('users').doc(user.uid).collection('saved').doc(docId).delete();
      item.remove();
      if (!ui.historyList.querySelector('.history-item')) {
        ui.historyList.innerHTML = '<p class="history-empty">No saved analyses yet.</p>';
      }
    } catch {
      delBtn.textContent = '🗑 Delete';
      delBtn.disabled = false;
    }
  });

  return item;
}

function renderHistoryItem(docId, data, atTop = false) {
  const empty = ui.historyList.querySelector('.history-empty');
  if (empty) empty.remove();

  const item = createHistoryItemElement(docId, data);
  if (atTop) {
    ui.historyList.insertBefore(item, ui.historyList.firstChild);
  } else {
    ui.historyList.appendChild(item);
  }
}

async function loadSavedHistory(uid) {
  ui.historyList.innerHTML = '<p class="history-empty">Loading saved history…</p>';
  try {
    const snap = await db.collection('users').doc(uid).collection('saved')
      .orderBy('createdAt', 'desc').get();
    ui.historyList.innerHTML = '';
    if (snap.empty) {
      ui.historyList.innerHTML = '<p class="history-empty">No saved analyses yet.</p>';
      return;
    }
    snap.forEach(doc => renderHistoryItem(doc.id, doc.data(), false));
  } catch (err) {
    ui.historyList.innerHTML = '<p class="history-empty">Failed to load history.</p>';
  }
}

function openHistoryPanel() {
  const user = auth.currentUser;
  if (!user) return;
  ui.historyPanel.classList.remove('hidden');
  loadSavedHistory(user.uid);
}


function closeHistoryPanel() {
  ui.historyPanel.classList.add('hidden');
}

// ── Quota ─────────────────────────────────────────────────────────────────────

async function consumeQuota(uid) {
  const today = new Date().toISOString().slice(0, 10);
  const ref = db.collection('users').doc(uid).collection('usage').doc(today);
  try {
    await db.runTransaction(async t => {
      const snap = await t.get(ref);
      const count = snap.exists ? (snap.data().count || 0) : 0;
      if (count >= APP_CONFIG.DAILY_REQUEST_LIMIT) throw new Error('LIMIT_REACHED');
      t.set(ref, { count: count + 1 }, { merge: true });
    });
  } catch (e) {
    if (e.message === 'LIMIT_REACHED') return false;
    throw e;
  }
  await updateQuotaLabel();
  return true;
}

async function updateQuotaLabel() {
  if (!auth.currentUser) return;
  const uid   = auth.currentUser.uid;
  const today = new Date().toISOString().slice(0, 10);
  const snap  = await db.collection('users').doc(uid).collection('usage').doc(today).get();
  const used  = snap.exists ? (snap.data().count || 0) : 0;
  const left  = Math.max(0, APP_CONFIG.DAILY_REQUEST_LIMIT - used);
  ui.quotaLabel.textContent = `${left} of ${APP_CONFIG.DAILY_REQUEST_LIMIT} requests left today`;
}

// ── Send Handler ──────────────────────────────────────────────────────────────

async function handleSend(text) {
  if (busy) return;
  const user = auth.currentUser;
  if (!user) return;

  const trimmed = text.trim();
  if (!trimmed) {
    addMessage('error', 'Please enter a code snippet, a repo URL, or a question.');
    return;
  }

  setBusy(true);
  const userMsgEl = addMessage('user', trimmed);
  ui.chatInput.value = '';

  const statusEl = addStatus('Routing your request…');

  try {
    const inputType = detectInputType(trimmed);

    if (inputType !== 'repo' && inputType !== 'snippet') {
      statusEl.remove();
      userMsgEl.remove();
      addMessage('error', "That doesn't look like a code snippet or a valid GitHub URL. Paste your code, or use a link like: https://github.com/owner/repo");
      setBusy(false);
      return;
    }

    const allowed = await consumeQuota(user.uid);
    if (!allowed) {
      statusEl.remove();
      addMessage('error', 'You have reached your daily request limit. Come back tomorrow.');
      return;
    }

    if (inputType === 'snippet') {
      // ── Pipeline: Inspect → Refactor → Review ──
      statusEl.querySelector('.status-text').textContent = 'Step 1/3: Inspecting code health…';
      const inspectorPrompt = await fetchText('skills/code-inspector-agent.md');
      const inspectorOutput = await callGemini(inspectorPrompt, trimmed);

      statusEl.querySelector('.status-text').textContent = 'Step 2/3: Refactoring code…';
      const refactorPrompt = await fetchText('skills/refactor-agent.md');
      const refactorUserPrompt = [
        'Original code snippet:\n',
        '```\n' + trimmed + '\n```',
        '\nStatic analysis report from Code Inspector Agent:\n',
        inspectorOutput,
        '\nPlease refactor the code based on the analysis report and your instructions. Return only the refactored code and the changes summary.'
      ].join('\n');
      const refactorOutput = await callGemini(refactorPrompt, refactorUserPrompt);

      statusEl.querySelector('.status-text').textContent = 'Step 3/3: Comparing & reviewing changes…';
      const reviewPrompt = await fetchText('skills/review-agent.md');
      const reviewUserPrompt = [
        'Original code snippet:\n',
        '```\n' + trimmed + '\n```',
        '\nRefactored code:\n',
        refactorOutput,
        '\nPlease compare the original code against the refactored code and write a structured review report.'
      ].join('\n');
      const reviewOutput = await callGemini(reviewPrompt, reviewUserPrompt);

      statusEl.remove();
      const pipelineEl = addPipelineMessage(inspectorOutput, refactorOutput, reviewOutput);

      addActionButtons(
        [userMsgEl, pipelineEl],
        { userText: trimmed, inputType, isPipeline: true, inspectorOutput, refactorOutput, reviewOutput }
      );

    } else {
      // ── Repo / Skill routing ──
      const orchestratorPrompt = await fetchText(ORCHESTRATOR_FILE);
      const orchestratorReply  = await callGemini(orchestratorPrompt, trimmed);
      const parsed = parseOrchestratorReply(orchestratorReply);

      if (parsed.type === 'clarify') {
        statusEl.remove();
        addMessage('routing-line', 'Clarifying…');
        addMessage('assistant', orchestratorReply);
        return;
      }

      const skill = findRoutedSkill(parsed.label);
      if (!skill) {
        statusEl.remove();
        addMessage('error', "I couldn't determine which specialist handles that. Please rephrase your request.");
        return;
      }

      statusEl.querySelector('.status-text').textContent = 'Analyzing…';
      const routingLineEl = addMessage('routing-line', parsed.line);

      let userContent = trimmed;
      const repoUrl = extractGithubUrl(trimmed);
      if (repoUrl) {
        statusEl.querySelector('.status-text').textContent = 'Fetching repository…';
        const { bundle, includedFiles, skippedFiles } = await window.GitHubRepoFetcher.buildRepoBundle(repoUrl);
        userContent = [
          trimmed,
          `Included ${includedFiles.length} files from the repository${skippedFiles.length ? ` (${skippedFiles.length} skipped for size)` : ''}:`,
          bundle
        ].join('\n\n');
      }

      statusEl.querySelector('.status-text').textContent = 'Analyzing…';
      const skillPrompt = await fetchText(skill.file);
      const result = await callGemini(skillPrompt, userContent);

      statusEl.remove();
      const responseEl = addMessage('assistant', result);

      addActionButtons(
        [userMsgEl, routingLineEl, responseEl],
        { userText: trimmed, inputType, isPipeline: false, aiText: result, routingLine: parsed.line, routedSkill: skill.name }
      );
    }
  } catch (err) {
    statusEl.remove();
    addMessage('error', friendlyError(err));
  } finally {
    setBusy(false);
  }
}

// ── View Transitions ──────────────────────────────────────────────────────────

function showChat(user) {
  ui.authView.classList.add('hidden');
  ui.chatView.classList.remove('hidden');
  ui.userEmail.textContent = user.email;
  ui.messages.innerHTML = ''; // Session-only — fresh empty chat on every sign-in
  updateQuotaLabel();
}

function showAuth() {
  ui.chatView.classList.add('hidden');
  ui.historyPanel.classList.add('hidden');
  ui.authView.classList.remove('hidden');
  ui.messages.innerHTML = '';
}

// ── Auth Form ─────────────────────────────────────────────────────────────────

function handleAuthForm(e) {
  e.preventDefault();
  const email    = ui.authEmail.value.trim();
  const password = ui.authPassword.value;
  const isSignup = ui.tabSignup.classList.contains('active');
  const promise  = isSignup
    ? auth.createUserWithEmailAndPassword(email, password)
    : auth.signInWithEmailAndPassword(email, password);
  ui.authError.classList.add('hidden');
  ui.authSubmit.disabled = true;
  promise
    .catch(err => {
      let msg = 'Unable to log in. Please check your details.';
      if (err.code === 'auth/email-already-in-use')                             msg = 'That email is already registered. Log in instead.';
      if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') msg = 'Incorrect email or password.';
      if (err.code === 'auth/invalid-email')                                    msg = 'Please enter a valid email address.';
      if (err.code === 'auth/weak-password')                                    msg = 'Password must be at least 6 characters.';
      ui.authError.textContent = msg;
      ui.authError.classList.remove('hidden');
    })
    .finally(() => { ui.authSubmit.disabled = false; });
}

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  firebase.initializeApp(APP_CONFIG.FIREBASE);
  auth = firebase.auth();
  db   = firebase.firestore();

  ui.tabLogin.addEventListener('click', () => {
    ui.tabLogin.classList.add('active');
    ui.tabSignup.classList.remove('active');
    ui.authSubmit.textContent = 'Log in';
  });
  ui.tabSignup.addEventListener('click', () => {
    ui.tabSignup.classList.add('active');
    ui.tabLogin.classList.remove('active');
    ui.authSubmit.textContent = 'Sign up';
  });

  ui.authForm.addEventListener('submit', handleAuthForm);
  ui.signoutBtn.addEventListener('click', () => auth.signOut());

  ui.chatForm.addEventListener('submit', e => {
    e.preventDefault();
    handleSend(ui.chatInput.value);
  });
  ui.chatInput.addEventListener('input', () => {
    ui.chatInput.style.height = 'auto';
    ui.chatInput.style.height = Math.min(ui.chatInput.scrollHeight, 200) + 'px';
  });

  ui.historyBtn.addEventListener('click', openHistoryPanel);
  ui.closeHistoryBtn.addEventListener('click', closeHistoryPanel);

  loadRegistry().catch(() => {
    addMessage('error', 'Failed to load the skill registry.');
  });

  auth.onAuthStateChanged(user => {
    if (user) showChat(user);
    else showAuth();
  });
}

init();
