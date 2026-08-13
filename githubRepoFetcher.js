/**
 * githubRepoFetcher.js
 *
 * Fetches a GitHub repository's file tree, filters it down to the files
 * that actually matter for diagnosing a full-stack app, pulls their
 * contents, and flattens everything into a single text bundle that can
 * be dropped straight into the Repo Doctor skill's prompt.
 *
 * Usage:
 *   const { buildRepoBundle } = require('./githubRepoFetcher');
 *   const bundle = await buildRepoBundle('https://github.com/owner/repo');
 *
 * Env vars:
 *   GITHUB_TOKEN (optional) - needed for private repos and higher rate limits.
 *                              Without it you get 60 req/hr from GitHub's API;
 *                              with it, 5000 req/hr.
 */

const GITHUB_API = 'https://api.github.com';

// Directories we never want to pull content from — build artifacts,
// dependency folders, and version control internals.
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'venv', '.venv', '__pycache__', 'vendor', 'coverage',
  '.cache', 'target', 'out', '.turbo', '.svelte-kit'
]);

// File extensions that are almost never useful for diagnosing app bugs
// (binaries, images, fonts, lockfiles are noisy and huge).
const IGNORED_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff',
  '.woff2', '.ttf', '.eot', '.mp4', '.mov', '.zip', '.tar', '.gz',
  '.pdf', '.lock'
]);

// Filenames that are almost always noise even if they slip past the
// extension filter.
const IGNORED_FILENAMES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store'
]);

// Filenames that are high-signal and should always be included if present,
// regardless of other heuristics.
const PRIORITY_FILENAMES = new Set([
  'package.json', 'requirements.txt', 'pyproject.toml', 'go.mod',
  'Cargo.toml', 'composer.json', 'Gemfile',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  'vercel.json', 'render.yaml', 'Procfile', 'netlify.toml',
  '.env.example', 'README.md', 'tsconfig.json', 'next.config.js',
  'vite.config.js', 'vite.config.ts', 'webpack.config.js'
]);

// Rough cap on total bundle size (characters) sent to the model, so a huge
// repo doesn't blow the context window or the API bill. Tune as needed.
const MAX_BUNDLE_CHARS = 400_000;
// Skip individual files bigger than this — almost certainly generated
// or data files, not hand-written logic.
const MAX_FILE_CHARS = 40_000;

function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) {
    throw new Error(`Could not parse a GitHub owner/repo from: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}

function authHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function getDefaultBranch(owner, repo) {
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
    headers: authHeaders()
  });
  if (!res.ok) {
    throw new Error(`Failed to load repo metadata (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  return data.default_branch;
}

async function getTree(owner, repo, branch) {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    throw new Error(`Failed to load file tree (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  if (data.truncated) {
    console.warn('Warning: GitHub truncated the tree response — very large repo, some files may be missing.');
  }
  return data.tree.filter(item => item.type === 'blob');
}

function shouldIncludeFile(path) {
  const segments = path.split('/');
  if (segments.some(seg => IGNORED_DIRS.has(seg))) return false;

  const filename = segments[segments.length - 1];
  if (IGNORED_FILENAMES.has(filename)) return false;

  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  if (IGNORED_EXTENSIONS.has(ext.toLowerCase())) return false;

  return true;
}

function filePriority(path) {
  const filename = path.split('/').pop();
  if (PRIORITY_FILENAMES.has(filename)) return 0; // highest priority
  // Entry points and common source dirs rank next.
  if (/^(index|main|app|server)\.(js|ts|py|go|rb)$/i.test(filename)) return 1;
  if (/\/(routes|api|controllers|models|services)\//i.test(path)) return 2;
  return 3;
}

async function getFileContent(owner, repo, sha) {
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/git/blobs/${sha}`,
    { headers: authHeaders() }
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch blob ${sha} (${res.status})`);
  }
  const data = await res.json();
  if (data.encoding !== 'base64') return null; // skip anything unexpected
  const buf = Buffer.from(data.content, 'base64');
  // Cheap binary check: if it contains a null byte, treat as binary and skip.
  if (buf.includes(0)) return null;
  return buf.toString('utf-8');
}

/**
 * Fetches a repo and returns a single flattened text bundle:
 * a file tree overview followed by the contents of the most relevant files,
 * ready to paste into a model prompt.
 */
async function buildRepoBundle(repoUrl) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const branch = await getDefaultBranch(owner, repo);
  const allFiles = await getTree(owner, repo, branch);

  const candidateFiles = allFiles
    .filter(f => shouldIncludeFile(f.path))
    .sort((a, b) => filePriority(a.path) - filePriority(b.path));

  const treeOverview = allFiles.map(f => f.path).join('\n');

  let bundle = `# Repository: ${owner}/${repo} (branch: ${branch})\n\n`;
  bundle += `## Full file tree\n\`\`\`\n${treeOverview}\n\`\`\`\n\n`;
  bundle += `## File contents (filtered, priority-ordered)\n\n`;

  let usedChars = bundle.length;
  const included = [];
  const skippedForSize = [];

  for (const file of candidateFiles) {
    if (usedChars >= MAX_BUNDLE_CHARS) {
      skippedForSize.push(file.path);
      continue;
    }
    const content = await getFileContent(owner, repo, file.sha);
    if (content === null) continue; // binary or unreadable
    if (content.length > MAX_FILE_CHARS) {
      skippedForSize.push(file.path);
      continue;
    }

    const section = `### ${file.path}\n\`\`\`\n${content}\n\`\`\`\n\n`;
    if (usedChars + section.length > MAX_BUNDLE_CHARS) {
      skippedForSize.push(file.path);
      continue;
    }

    bundle += section;
    usedChars += section.length;
    included.push(file.path);
  }

  if (skippedForSize.length) {
    bundle += `\n## Files omitted (size/context limits)\n`;
    bundle += skippedForSize.map(p => `- ${p}`).join('\n');
    bundle += `\n\nIf a diagnosis depends on one of these, ask the user to share it directly.\n`;
  }

  return { bundle, includedFiles: included, skippedFiles: skippedForSize, owner, repo, branch };
}

module.exports = { buildRepoBundle, parseRepoUrl };
