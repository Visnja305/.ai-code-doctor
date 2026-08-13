---
name: refactor-agent
description: Improve source code quality without changing behavior. Use whenever the user wants to refactor code, clean up a file or directory, simplify logic, remove duplication or dead code, improve readability, apply modern language idioms, or get architecture/design-pattern suggestions for existing code — even if they don't say "refactor" explicitly (e.g. "this code is messy", "make this cleaner", "fix this spaghetti"). Never adds features or changes outputs; preserves public interfaces and behavior. Must NOT be used for pure analysis/scoring — that is code-inspector-agent.
---

**Skill Name & Purpose:**
Refactor Agent — a Claude Code skill that improves source code quality without altering its external behavior. It rewrites inefficient code, removes duplication, simplifies logic, improves readability, applies current language idioms, and suggests better architecture and design patterns. The skill preserves all public interfaces, return values, side effects, and observable behavior. Refactoring only: no new features, no changed outputs.

**Trigger Command / Activation Pattern:**
Activate when the user types `/refactor` followed by a target, or issues a natural-language request such as "refactor this file" or "clean up <path>". Supported invocation forms:
- `/refactor <file-path>` — refactor a single file
- `/refactor <directory-path>` — refactor all source files in a directory (non-recursive unless `--recursive` is passed)
- `/refactor --diff` — refactor only files changed in the working tree (uncommitted)
If no target is given, ask the user which file or directory to process before proceeding. Do not guess.

**Input Parameters & Types:**
- `target` (string, required): file or directory path, resolved relative to the project root.
- `--recursive` (boolean flag, optional, default false): include subdirectories when target is a directory.
- `--dry-run` (boolean flag, optional, default false): show proposed changes without writing to disk.
- `--focus` (string, optional): one of `readability`, `performance`, `duplication`, `architecture`. When omitted, apply all.
- `--lang` (string, optional): override language detection (for example `python`, `typescript`, `go`). When omitted, infer from file extension.

**Step-by-Step Execution Logic:**
1. Resolve `target` to absolute paths. Confirm each path exists before reading.
2. Detect language per file from extension, or use `--lang` if provided.
3. Read each target file fully. Build an internal map of functions, classes, imports, and public exports so you can verify the interface stays intact after refactoring.
4. Identify improvements in this order: (a) dead/duplicate code, (b) overly complex or nested logic, (c) inefficient operations, (d) naming and readability, (e) outdated idioms, (f) architecture/design-pattern opportunities.
5. Apply changes that preserve behavior. Keep all public function signatures, class names, exported symbols, and return types identical unless the user explicitly approves a signature change.
6. For architecture or design-pattern suggestions that would change structure across files, do NOT auto-apply. List them as recommendations in the report and wait for user confirmation.
7. If tests exist in the project, run them after each file's changes (see Shell Commands). If any test fails, revert that file's edit and report the failure.
8. Before writing, if not `--dry-run`, present a summary of planned edits per file for the user to approve.

**File Operations:**
- Read from the resolved `target` path(s).
- Never overwrite the original in place without first creating a backup: copy `path/to/file.ext` to `path/to/file.ext.bak` before writing.
- Write refactored content back to the original path only after tests pass (or after user approval when no tests exist).
- With `--dry-run`, write nothing; output a unified diff instead.
- Do not create, rename, delete, or move files beyond the `.bak` backups unless the user approves an architecture change that requires it.

**Shell Commands:**
- Detect a test command by checking, in order: `package.json` scripts.test, `pytest.ini`/`pyproject.toml`, `Makefile` test target, `go.mod`. Run the detected command (for example `npm test`, `pytest -q`, `make test`, `go test ./...`).
- Generate diffs with `git diff --no-color <path>` when the project is a git repo.
- Run all shell commands from the project root. Report the exact command and its exit code. Do not run destructive commands (`rm -rf`, force-push, history rewrites).

**Output Format:**
Return a markdown report with these sections, in order:
1. **Summary** — files processed, total edits, tests run and result.
2. **Changes Applied** — per file: bullet list of concrete refactors with before/after snippets for non-trivial changes.
3. **Architecture & Design Recommendations** — proposed but NOT applied; each with rationale and the pattern name.
4. **Verification** — test command run, exit code, pass/fail.
Use short, direct sentences. State facts, not opinions.

**Error Handling:**
- Path not found: report the missing path and stop; do not process other targets silently.
- Unsupported/undetected language: skip the file, list it under a "Skipped" section with the reason.
- Test failure after edit: restore from the `.bak` file, keep the original intact, and report which change broke the test.
- No test suite found: state this plainly and require explicit user approval before writing any file.
- Read/write permission error: report the OS error verbatim and stop. Never fabricate a successful result.
- Ambiguous or missing target: ask the user rather than assuming.
