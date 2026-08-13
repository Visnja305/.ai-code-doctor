window.GitHubRepoFetcher = (function () {
  const GITHUB_API = 'https://api.github.com';
  const RAW_BASE = 'https://raw.githubusercontent.com';

  const IGNORED_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
    'venv', '.venv', '__pycache__', 'vendor', 'coverage',
    '.cache', 'target', 'out', '.turbo', '.svelte-kit'
  ]);

  const IGNORED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff',
    '.woff2', '.ttf', '.eot', '.mp4', '.mov', '.zip', '.tar', '.gz',
    '.pdf', '.lock'
  ]);

  const IGNORED_FILENAMES = new Set([
    'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', '.DS_Store'
  ]);

  const PRIORITY_FILENAMES = new Set([
    'package.json', 'requirements.txt', 'pyproject.toml', 'go.mod',
    'Cargo.toml', 'composer.json', 'Gemfile',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    'vercel.json', 'render.yaml', 'Procfile', 'netlify.toml',
    '.env.example', 'README.md', 'tsconfig.json', 'next.config.js',
    'vite.config.js', 'vite.config.ts', 'webpack.config.js'
  ]);

  const MAX_BUNDLE_CHARS = 400_000;
  const MAX_FILE_CHARS = 40_000;

  function parseRepoUrl(url) {
    const match = url.match(/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?(?:[\/\s]|$)/);
    if (!match) {
      const err = new Error('Could not parse a GitHub repository URL from your message.');
      err.userMessage = err.message;
      throw err;
    }
    return { owner: match[1], repo: match[2] };
  }

  async function getDefaultBranch(owner, repo) {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (res.status === 404 || res.status === 403) {
      const err = new Error('That repository is private or does not exist — only public repositories are supported.');
      err.userMessage = err.message;
      throw err;
    }
    if (!res.ok) {
      throw new Error(`GitHub is not responding right now (${res.status}). Try again shortly.`);
    }
    const data = await res.json();
    return data.default_branch;
  }

  async function getTree(owner, repo, branch) {
    const res = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!res.ok) {
      throw new Error(`GitHub is not responding right now (${res.status}). Try again shortly.`);
    }
    const data = await res.json();
    if (data.truncated) {
      console.warn('GitHub truncated the file tree for this very large repo.');
    }
    return (data.tree || []).filter(item => item.type === 'blob');
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
    if (PRIORITY_FILENAMES.has(filename)) return 0;
    if (/^(index|main|app|server)\.(js|ts|py|go|rb)$/i.test(filename)) return 1;
    if (/\/(routes|api|controllers|models|services)\//i.test(path)) return 2;
    return 3;
  }

  function encodePath(path) {
    return path.split('/').map(seg => encodeURIComponent(seg)).join('/');
  }

  async function getFileContent(owner, repo, branch, path) {
    const res = await fetch(`${RAW_BASE}/${owner}/${repo}/${branch}/${encodePath(path)}`, {
      headers: { Accept: 'text/plain' }
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.includes('\u0000')) return null;
    return text;
  }

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
      const content = await getFileContent(owner, repo, branch, file.path);
      if (content === null) continue;
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

  return { buildRepoBundle, parseRepoUrl };
})();
