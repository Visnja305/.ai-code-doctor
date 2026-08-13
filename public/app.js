const ORCHESTRATOR_FILE = 'skills/orchestrator.md';

let auth = null;
let db = null;
let candidates = [];
let routingCandidates = [];
let snapshotUnsub = null;
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
  quotaLabel: document.getElementById('quota-label')
};

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

async function callGemini(systemPrompt, userText) {
  const model = APP_CONFIG.GEMINI_MODEL || 'gemini-1.5-flash';
  const key = APP_CONFIG.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
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

function addMessage(kind, text) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  if (kind === 'assistant' || kind === 'error') {
    if (window.marked) {
      el.innerHTML = window.marked.parse(text);
    } else {
      el.textContent = text;
    }
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

  // 1. Inspector Box
  const boxInspector = document.createElement('div');
  boxInspector.className = 'pipeline-box inspector';
  boxInspector.innerHTML = `
    <div class="pipeline-box-header"><span>🔍</span> Code Inspector Report</div>
    <div class="pipeline-box-body">${window.marked ? window.marked.parse(inspector) : inspector}</div>
  `;
  container.appendChild(boxInspector);

  // 2. Refactor Box
  const boxRefactor = document.createElement('div');
  boxRefactor.className = 'pipeline-box refactor';
  boxRefactor.innerHTML = `
    <div class="pipeline-box-header"><span>🛠️</span> Refactored Code</div>
    <div class="pipeline-box-body">${window.marked ? window.marked.parse(refactor) : refactor}</div>
  `;
  container.appendChild(boxRefactor);

  // 3. Review Box
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
      <div class="lb"></div>
      <div class="lb"></div>
      <div class="lb"></div>
      <div class="lb"></div>
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

async function consumeQuota(uid) {
  const today = new Date().toISOString().slice(0, 10);
  const ref = db.collection('users').doc(uid).collection('usage').doc(today);
  try {
    await db.runTransaction(async (t) => {
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
  const uid = auth.currentUser.uid;
  const today = new Date().toISOString().slice(0, 10);
  const snap = await db.collection('users').doc(uid).collection('usage').doc(today).get();
  const used = snap.exists ? (snap.data().count || 0) : 0;
  const left = Math.max(0, APP_CONFIG.DAILY_REQUEST_LIMIT - used);
  ui.quotaLabel.textContent = `${left} of ${APP_CONFIG.DAILY_REQUEST_LIMIT} requests left today`;
}

function saveMessage(uid, doc) {
  return db.collection('users').doc(uid).collection('messages').add(
    Object.assign({ createdAt: firebase.firestore.FieldValue.serverTimestamp() }, doc)
  );
}

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
  addMessage('user', trimmed);
  ui.chatInput.value = '';

  const statusEl = addStatus('Routing your request…');

  try {
    const inputType = detectInputType(trimmed);
    await saveMessage(user.uid, { role: 'user', text: trimmed, inputType });

    if (inputType !== 'repo' && inputType !== 'snippet') {
      statusEl.remove();
      const errMsg = "Hmm, that doesn't look like a code snippet or a valid GitHub URL. Paste your code, or use a link like: https://github.com/owner/repo";
      addMessage('error', errMsg);
      await saveMessage(user.uid, { role: 'error', text: errMsg, inputType });
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
      statusEl.querySelector('.status-text').textContent = 'Step 1/3: Inspecting code health…';
      const inspectorPrompt = await fetchText('skills/code-inspector-agent.md');
      const inspectorOutput = await callGemini(inspectorPrompt, trimmed);

      statusEl.querySelector('.status-text').textContent = 'Step 2/3: Refactoring code…';
      const refactorPrompt = await fetchText('skills/refactor-agent.md');
      const refactorUserPrompt = [
        "Original code snippet:\n",
        "```\n" + trimmed + "\n```",
        "\nStatic analysis report from Code Inspector Agent:\n",
        inspectorOutput,
        "\nPlease refactor the code based on the analysis report and your instructions. Return only the refactored code and the changes summary."
      ].join('\n');
      const refactorOutput = await callGemini(refactorPrompt, refactorUserPrompt);

      statusEl.querySelector('.status-text').textContent = 'Step 3/3: Comparing & reviewing changes…';
      const reviewPrompt = await fetchText('skills/review-agent.md');
      const reviewUserPrompt = [
        "Original code snippet:\n",
        "```\n" + trimmed + "\n```",
        "\nRefactored code:\n",
        refactorOutput,
        "\nPlease compare the original code against the refactored code and write a structured review report."
      ].join('\n');
      const reviewOutput = await callGemini(reviewPrompt, reviewUserPrompt);

      statusEl.remove();
      addPipelineMessage(inspectorOutput, refactorOutput, reviewOutput);

      await saveMessage(user.uid, {
        role: 'assistant',
        text: 'Pipeline analysis complete.',
        inputType,
        isPipeline: true,
        inspectorOutput,
        refactorOutput,
        reviewOutput
      });
    } else {
      const orchestratorPrompt = await fetchText(ORCHESTRATOR_FILE);
      const orchestratorReply = await callGemini(orchestratorPrompt, trimmed);
      const parsed = parseOrchestratorReply(orchestratorReply);

      if (parsed.type === 'clarify') {
        statusEl.remove();
        addMessage('routing-line', 'Clarifying…');
        addMessage('assistant', orchestratorReply);
        await saveMessage(user.uid, { role: 'assistant', text: orchestratorReply, inputType });
        return;
      }

      const skill = findRoutedSkill(parsed.label);
      if (!skill) {
        statusEl.remove();
        addMessage('error', `I couldn't determine which specialist handles that. Please rephrase your request.`);
        return;
      }

      statusEl.querySelector('.status-text').textContent = 'Analyzing…';
      addMessage('routing-line', parsed.line);

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
      addMessage('assistant', result);
      await saveMessage(user.uid, {
        role: 'assistant',
        text: result,
        inputType,
        routedSkill: skill.name,
        routingLine: parsed.line
      });
    }
  } catch (err) {
    statusEl.remove();
    addMessage('error', friendlyError(err));
  } finally {
    setBusy(false);
  }
}

function renderHistory(snap) {
  ui.messages.innerHTML = '';
  snap.forEach(doc => {
    const d = doc.data();
    if (d.routingLine) addMessage('routing-line', d.routingLine);
    if (d.isPipeline) {
      addPipelineMessage(d.inspectorOutput, d.refactorOutput, d.reviewOutput);
    } else {
      let kind = 'assistant';
      if (d.role === 'user') kind = 'user';
      else if (d.role === 'error') kind = 'error';
      addMessage(kind, d.text);
    }
  });
  ui.messages.scrollTop = ui.messages.scrollHeight;
}

function subscribeMessages(uid) {
  if (snapshotUnsub) snapshotUnsub();
  snapshotUnsub = db.collection('users').doc(uid).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot(renderHistory, () => {});
}

function showChat(user) {
  ui.authView.classList.add('hidden');
  ui.chatView.classList.remove('hidden');
  ui.userEmail.textContent = user.email;
  subscribeMessages(user.uid);
  updateQuotaLabel();
}

function showAuth() {
  ui.chatView.classList.add('hidden');
  ui.authView.classList.remove('hidden');
  if (snapshotUnsub) {
    snapshotUnsub();
    snapshotUnsub = null;
  }
}

function handleAuthForm(e) {
  e.preventDefault();
  const email = ui.authEmail.value.trim();
  const password = ui.authPassword.value;
  const isSignup = ui.tabSignup.classList.contains('active');
  const promise = isSignup
    ? auth.createUserWithEmailAndPassword(email, password)
    : auth.signInWithEmailAndPassword(email, password);
  ui.authError.classList.add('hidden');
  ui.authSubmit.disabled = true;
  promise
    .catch(err => {
      let msg = 'Unable to log in. Please check your details.';
      if (err.code === 'auth/email-already-in-use') msg = 'That email is already registered. Log in instead.';
      if (err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') msg = 'Incorrect email or password.';
      if (err.code === 'auth/invalid-email') msg = 'Please enter a valid email address.';
      if (err.code === 'auth/weak-password') msg = 'Password must be at least 6 characters.';
      ui.authError.textContent = msg;
      ui.authError.classList.remove('hidden');
    })
    .finally(() => {
      ui.authSubmit.disabled = false;
    });
}

function init() {
  firebase.initializeApp(APP_CONFIG.FIREBASE);
  auth = firebase.auth();
  db = firebase.firestore();

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
  ui.chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSend(ui.chatInput.value);
  });
  ui.chatInput.addEventListener('input', () => {
    ui.chatInput.style.height = 'auto';
    ui.chatInput.style.height = Math.min(ui.chatInput.scrollHeight, 200) + 'px';
  });

  loadRegistry().catch(() => {
    addMessage('error', 'Failed to load the skill registry.');
  });

  auth.onAuthStateChanged(user => {
    if (user) showChat(user);
    else showAuth();
  });
}

init();
