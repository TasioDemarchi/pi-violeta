# violeta

A minimal, information-first Pi harness. Runs as its own command with its own agent directory (`~/.violeta/agent`), so it never touches gentle-shell.

## Run

```sh
violeta            # symlinked at ~/.local/bin/violeta -> bin/violeta
```

## What you see

- Header: one line, `▍ violeta · pi <version>`.
- Footer, left: project, git branch, working-tree changes — `+` created (green), `~` updated (yellow), `−` deleted (red).
- Footer, right: model, context usage, tokens in/out, session cost.
- `/sidebar` (`on`, `off`, no argument toggles): hides the footer and shows the same information in more detail in a right-hand sidebar — project (name, path, branch), changes (counts plus the file names, capped at 12 with `+N more`), model (id, thinking level, context bar), usage (tokens, cost). Falls back to the footer below ~100 columns or outside fullscreen. The choice is remembered in `violeta.json` (default off).
- Theme `violeta`: base `#7502c7` for borders and selection; a lighter tint of the same hue for accent text so it stays legible.
- Activity line: while the agent works, one line above the editor shows the current phase — `▍ thinking` while the model writes, `exploring` for read-only tools (read, grep, find, ls), `implementing` for edit/write, `checking` for test-like bash commands, `running` for other bash — with three dots that appear and disappear in a loop so the line stays animated while the width never shifts. The line is removed entirely when the agent is idle, and Pi's native Working spinner is hidden while it is active.

## Layout

| Path | Role |
|---|---|
| `bin/violeta` | Launcher: isolates `PI_CODING_AGENT_DIR`, seeds settings, syncs `config/models.json` (NaN catalog) on every start |
| `extensions/violeta-ui.ts` | Header, footer, `/sidebar` command, activity line |
| `src/changes.ts`, `src/format.ts`, `src/sidebar-content.ts`, `src/sidebar-state.ts`, `src/activity.ts` | Pure logic (tested) |
| `extensions/violeta-agents.ts` | Subagent tools, card and `alt+a` view |
| `src/agents/` | Store, runner, definitions, history, card and view rendering (tested) |
| `config/models.json` | NaN model catalog |
| `themes/violeta.json` | Palette |

## Subagents

Violeta ships the **visual layer** plus a neutral launcher. It has no built-in agents, roles or workflow; you define those.

- **Define an agent:** a markdown file in `~/.violeta/agent/agents/<name>.md` (frontmatter: `name`, `description`, `model`, `thinking`, `tools`; the body is the prompt).
- **Tools for the model:** `subagent_list_agents`, `subagent_run` (`task` waits, `background` returns an id and delivers the result later), `subagent_status`, `subagent_result`, `subagent_cancel`. Each task is a `pi --mode rpc` child; at most 3 run at once (`VIOLETA_AGENTS_MAX_CONCURRENCY`), the rest are `queued`. Children cannot spawn children.
- **Card above the editor:** `Agents · N active · M done`, one row per task with status glyph, name, label and right-aligned columns `model · effort`, tokens, cost (hidden while $0), elapsed. Finished rows stay one minute; extra rows fold into `… N more · alt+a to view`.
- **`alt+a` or `/agents`:** full-terminal view. Task list on the left (history after active tasks), thread on the right. Keys: `j`/`k` select, `ctrl+j`/`ctrl+k` scroll, `f` follow, `esc` back, `q` close (never cancels children), `alt+s` cancel all active tasks (asks first). Under 60 columns it shows the list only.
- **History:** finished tasks are stored in `~/.violeta/agent/agents-history/` (last 200).

## Notes

- Font is a terminal setting, not Pi's. JetBrains Mono is installed on this machine.
- NaN's key is read at request time from `~/.gentle-shell/agent/auth.json` through `jq`; it is never copied.
- Tests: `npm test`.
