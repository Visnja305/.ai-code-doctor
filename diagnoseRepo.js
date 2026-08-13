/**
 * diagnoseRepo.js
 *
 * Ties githubRepoFetcher.js to the Gemini API using the Repo Doctor skill
 * as the system prompt. Call diagnoseRepo(repoUrl) and get back the model's
 * fix report as a string.
 *
 * Env vars required:
 *   GEMINI_API_KEY  - your Gemini API key (billing-linked project, see earlier fixes)
 *   GITHUB_TOKEN    - optional, needed for private repos / higher rate limits
 */

const fs = require('fs');
const path = require('path');
const { buildRepoBundle } = require('./githubRepoFetcher');

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

// Load the Repo Doctor skill markdown as the system prompt.
const SKILL_PROMPT = fs.readFileSync(
  path.join(__dirname, 'repo_doctor_skill.md'),
  'utf-8'
);

async function callGeminiWithRetry(payload, retries = 3, delay = 1000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (res.status === 503 && attempt < retries) {
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      continue;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `Request failed with ${res.status}`);
    }

    return res.json();
  }
}

/**
 * Fetches the repo, builds the flattened bundle, and asks the model to
 * diagnose it per the Repo Doctor skill. Optionally pass a userNote with
 * an error message or description of the bug the developer is hitting.
 */
async function diagnoseRepo(repoUrl, userNote = '') {
  const { bundle, includedFiles, skippedFiles } = await buildRepoBundle(repoUrl);

  const userMessage = [
    userNote ? `Developer's note: ${userNote}\n` : '',
    'Here is the repository to diagnose:\n',
    bundle
  ].join('\n');

  const payload = {
    system_instruction: {
      parts: [{ text: SKILL_PROMPT }]
    },
    contents: [
      { role: 'user', parts: [{ text: userMessage }] }
    ]
  };

  const data = await callGeminiWithRetry(payload);
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).join('\n') || '';

  return { report: text, includedFiles, skippedFiles };
}

module.exports = { diagnoseRepo };

// Example CLI usage: node diagnoseRepo.js https://github.com/owner/repo "app crashes on login"
if (require.main === module) {
  const [, , repoUrl, userNote] = process.argv;
  if (!repoUrl) {
    console.error('Usage: node diagnoseRepo.js <github-repo-url> ["optional note about the bug"]');
    process.exit(1);
  }
  diagnoseRepo(repoUrl, userNote)
    .then(({ report, includedFiles, skippedFiles }) => {
      console.log(`\nAnalyzed ${includedFiles.length} files` +
        (skippedFiles.length ? ` (skipped ${skippedFiles.length} for size)` : '') + '\n');
      console.log(report);
    })
    .catch(err => {
      console.error('Diagnosis failed:', err.message);
      process.exit(1);
    });
}
