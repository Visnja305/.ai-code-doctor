# AI-code-doctor Agent System

The internal agent system for AI-code-doctor: a registry of skills the agent can run, plus persistent memory across sessions.

## Folder Structure

- `config/` — `skills.json`, the skill registry that maps names to skill files and trigger phrases.
- `memory/` — `context.json`, persistent session history and usage counts.
- `skills/` — one Markdown file per skill, each containing the skill's system prompt and workflow.

## Adding a New Skill

1. Write the skill's system prompt.
2. Save it as a `.md` file in `skills/` (e.g. `skills/refactor.md`).
3. Add an entry to `config/skills.json` with its name, description, trigger phrases, and file path.

## Running a Skill in Antigravity IDE

Open the skills file and run it as an agent (assign it to a sub-agent), then invoke it with one of its trigger phrases. The orchestrator skill can chain multiple skills together.
