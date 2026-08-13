---
name: code-inspector-agent
description: Analyze code health and quality with a read-only static analysis report. Use whenever the user wants to inspect code, analyze code health, check code quality, review code, find bugs or potential runtime errors, spot security vulnerabilities, identify inefficient or bad-practice code, or get a 1-10 quality score for a file, directory, or whole repository — even if they don't say "inspect" or "analyze" explicitly (e.g. "is my code any good?", "this script feels off", "audit my repo"). Never modifies code; analysis and reporting only.
---

**Skill Name & Purpose:**
Code Inspector Agent. A read-only static analysis skill that inspects source code files and produces an objective health report. It detects bugs and potential runtime errors, flags inefficient code, finds security vulnerabilities, identifies bad coding practices, checks adherence to the language's official conventions, and assigns a code quality score from 1 to 10. It never modifies code — analysis and reporting only.

**Trigger Command / Activation Pattern:**
Activate when the user runs `inspect <path>` or asks to "inspect", "analyze code health", or "review code quality" for a file, directory, or the whole repository. If `<path>` is omitted, default to the current working directory. Accept a `--lang <language>` override and a `--fail-below <n>` threshold flag.

**Input Parameters & Types:**
- `path` (string, required unless defaulted): file or directory to inspect. Resolve relative to the project root.
- `lang` (string, optional): force a language when auto-detection is ambiguous (e.g. `python`, `javascript`, `typescript`, `go`, `rust`, `java`).
- `fail_below` (integer 1–10, optional): if any file scores below this, exit non-zero.
- `include_globs` / `exclude_globs` (string arrays, optional): file patterns to include or skip. Always skip `node_modules/`, `.git/`, `dist/`, `build/`, `vendor/`, and lockfiles by default.

**Step-by-Step Execution Logic:**
1. Resolve `path`. If it does not exist, stop and report the error.
2. Enumerate target files, applying default and user-supplied ignore patterns.
3. Detect each file's language from extension and shebang; honor `--lang` when set.
4. For each file, read the full contents and analyze across six categories: (a) bugs / potential errors, (b) inefficiencies, (c) security vulnerabilities, (d) bad practices, (e) language-convention compliance, (f) overall quality.
5. Where a suitable installed linter or scanner exists, run it and fold its output into the report (see Shell Commands). Do not install anything.
6. For each finding, record file path, line number(s), category, severity (Critical / High / Medium / Low), a one-line description, and a concrete suggested fix.
7. Compute a 1–10 quality score per file and a repo-wide weighted average. State the scoring rubric used: start at 10, subtract for weighted severity density (Critical −3, High −2, Medium −1, Low −0.5 per finding, normalized by file length), floor at 1.
8. Think through the analysis before writing output; present only the finished report.

**File Operations:**
Read-only. Read source files and any config that clarifies conventions (`.eslintrc*`, `pyproject.toml`, `.editorconfig`, `tsconfig.json`, `go.mod`). Never edit, create, move, or delete source files. Optionally write the report to `./code-inspection-report.md` only when the user passes `--save`; otherwise print to stdout.

**Shell Commands:**
Before running any external tool, check it is installed (e.g. `command -v <tool>`); if missing, skip it and note the gap rather than failing. Use available tools that match the detected language, for example: `ruff check <path>`, `bandit -r <path>`, `eslint <path>`, `tsc --noEmit`, `go vet ./...`, `gosec ./...`, `cargo clippy`. Run all commands read-only — never with `--fix`, `--write`, or any mutating flag. Never run `git commit`, `git push`, or package installs.

**Output Format:**
Produce a Markdown report with this structure:
- **Summary** — repo-wide quality score (X/10), file count, total findings by severity.
- **Per-File Findings** — one section per file, findings in a table: Line | Category | Severity | Description | Suggested Fix.
- **Language Convention Check** — pass/fail notes per file against the language's standard style.
- **Score Breakdown** — each file's score and the rubric math behind it.
Tone is objective and factual — state what is wrong and how to fix it, no praise or hedging. Order findings by severity, highest first.

**Error Handling:**
- Path missing or unreadable: report it and stop; do not guess intent.
- Unrecognized language: skip the file, list it under "Skipped (unknown language)", continue.
- External tool absent or errored: note it, fall back to manual analysis, keep going.
- Empty or binary files: skip and list them.
- If `--fail-below` is set and any file scores under the threshold, print the report then exit non-zero.
- Never fabricate line numbers, findings, or tool output — report only what the file contents and actual tool runs support.
