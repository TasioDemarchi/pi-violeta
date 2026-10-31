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
- `/sidebar` (`on`, `off`, no argument toggles): hides the footer and shows the same information in more detail in a right-hand sidebar — project (name, path, branch), changes (counts plus at most 8 file rows: 7 names and a dim `…` when there are more), tasks (the todo list, see below), , model (id, thinking level, context bar), usage (tokens, cost). Falls back to the footer below ~100 columns or outside fullscreen. The choice is remembered in `violeta.json` (default off).
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
| `extensions/violeta-guard.ts`, `src/guard/` | Destructive-command guard and outside-project grants |
| `extensions/violeta-todo.ts`, `src/todo/` | Todo tool and card |
| `extensions/violeta-jobs.ts`, `src/jobs/` | Background jobs, monitors, `/jobs` |
| `extensions/violeta-changes.ts`, `src/changes-view/` | `/changes` diff viewer |
| `extensions/violeta-tools.ts`, `src/tools-view/` | Compact one-line tool renderers |
| `extensions/violeta-notify.ts`, `src/notify/` | `/notify` finish and dialog alerts |
| `extensions/violeta-models.ts`, `src/models-view/` | `/models` quick selector |
| `extensions/violeta-palette.ts`, `src/palette/` | `/palette` command palette |
| `src/context-warning.ts` | Context color thresholds and `/compact` hint |
| `config/models.json` | NaN model catalog |
| `config/settings.json` | Settings fragment merged on start (declares the Claude bridge package) |
| `themes/violeta.json` | Palette |

## Subagents

Violeta ships the **visual layer** plus a neutral launcher. It has no built-in agents, roles or workflow; you define those.

- **Define an agent:** a markdown file in `~/.violeta/agent/agents/<name>.md` (frontmatter: `name`, `description`, `model`, `thinking`, `tools`; the body is the prompt).
- **Tools for the model:** `subagent_list_agents`, `subagent_run` (`task` waits, `background` returns an id and delivers the result later), `subagent_status`, `subagent_result`, `subagent_cancel`. Each task is a `pi --mode rpc` child; at most 3 run at once (`VIOLETA_AGENTS_MAX_CONCURRENCY`), the rest are `queued`. Children cannot spawn children.
- **Titles:** `label` is required in `subagent_run` (what the agent does, 3 to 6 words, phrased as an action), so you can tell tasks apart without reading their context. If it is missing, the first sentence of the task is used.
- **Card above the editor:** `Agentes · N activos · M terminados`, one row per task: status glyph, **title**, the agent role dimmed, then tokens, cost (hidden while $0) and elapsed; `model · effort` shows when there is room. Finished rows stay one minute; extra rows fold into `… N más · alt+a para ver`.
- **`alt+a` or `/agents`:** full-terminal view. Task list on the left (glyph + title, history after active tasks). On the right: title, `role · status · model · tokens · elapsed`, a **Result** section (the task's `summary:` line, else the first line of its answer, plus a few more lines), then the full **Thread**. Keys: `j`/`k` select, `ctrl+j`/`ctrl+k` scroll, `f` follow, `esc` back, `q` close (never cancels children), `alt+s` cancel all active tasks (asks first). Under 60 columns it shows the list only.
- **History:** finished tasks are stored in `~/.violeta/agent/agents-history/` (last 200), with title and summary.

## Safety guard

`extensions/violeta-guard.ts` checks every `bash`, `bash_background` and `monitor` call, and every file tool.

- **Destructive commands** (recursive/forced removal, `find -delete`, `shred`, `dd` to devices, `mkfs`, recursive `chmod`/`chown`, force push including `+refspec`, hard reset, `clean -f`, whole-tree checkout/restore, `branch -D`, `stash drop|clear`, SQL `DROP`/`TRUNCATE`/`DELETE` without `WHERE`) ask for confirmation showing the exact command. Targets like `/`, `~`, `$HOME` and their globs are denied outright. Quoted text, heredoc data and look-alikes are not flagged. It recognises common forms; it is not a sandbox.
- **Outside the project:** a path outside the working directory asks once per directory per session. Grants live in memory only. `/grants` lists them, `/grants revoke` clears them. The violeta agent dir is always allowed.
- **Subagent children** have no UI, so anything that would ask is blocked instead.

## Todo list

The `todo` tool (`write`, `add`, `update`, `clear`, `list`; statuses `pending`, `in_progress`, `blocked` (needs a note), `done`, `dropped`) keeps a list that is saved in the session and restored on resume. A card above the editor shows `Tareas · N abiertas · M hechas`; when the sidebar is active the same list appears there as a `TAREAS` section instead (and not above the editor). `/todo` hides or shows it wherever it is drawn. It disappears a minute after everything is finished.

## Background jobs

- `bash_background` starts a command and returns at once; the model is woken once when it exits, with the exit code and the last lines of output (full output in a 0600 temp file).
- `monitor` turns each output line of a long-running command into an event (batched in 200 ms, at most 20 lines per notice; `timeout_seconds` 1–1800 is mandatory; it stops itself after more than 120 lines in 60 s).
- `job_list` and `job_stop` (kills the whole process tree). At most 25 run at once, and all are killed when violeta exits.
- `/jobs` opens the list (`j`/`k`, `s` then `s` again to stop, `q` to close); `jobs: N en ejecución` shows above the editor.

## More tools

All on demand; nothing extra is drawn by default.

| Command | Shortcut | What it does |
|---|---|---|
| `/changes` | `alt+g` | Full-terminal view: files grouped created/updated/deleted on the left, the diff of the selected one on the right. `j`/`k` file, `ctrl+j`/`ctrl+k` scroll, `g`/`G` top/bottom, `o` opens it in `$VISUAL`/`$EDITOR`, `esc`/`q` close. The sidebar summarizes; this shows everything. |
| `/models` | `alt+m` | Lists models with auth available (current marked, context window); `Enter` switches for the session. |
| `/palette` | `alt+k` | Search every command (violeta's, Pi's, extensions') grouped Session/Interface/Tools/Other, plus a shortcuts list. `Enter` puts the command in the editor (Pi has no API to run a slash command without starting a model turn). |
| `/notify on\|off` | | Opt-in. Terminal bell plus `notify-send` (if installed) when a run longer than 20 s ends or a confirmation dialog waits. Off by default, remembered in `violeta.json`. |
| `/language es\|en` | | See Language below. |

- **Compact tools:** every tool call collapses to one line (`✓ read README.md`, `✓ bash npm test · 0 · 1.2s`, `✗ bash … · exit 1`); `ctrl+o` expands the full output. Display only: what the model receives is unchanged and the guard still intercepts.
- **Context warning:** the `ctx N%` indicator turns warning color from 70% and error color from 90%; once per session at 80% a notice suggests `/compact` (re-arms below 60%).

## Claude models

`config/settings.json` declares `npm:pi-claude-bridge`; `bin/violeta` merges it into `~/.violeta/agent/settings.json` on every start (idempotent) and Pi installs the package into `~/.violeta/agent/npm` on first launch (needs network once). The bridge drives your logged-in `claude` CLI: no key or token is copied and nothing under `~/.gentle-shell` or `~/.claude` is touched. Models show up as `claude-bridge/...` in `/models`. Note from the package README: it uses your regular subscription quota like Claude Code, and Anthropic has changed how Agent SDK usage is billed before, so it could be billed as extra usage in the future.

## Language

Violeta speaks Spanish by default. `/language es|en` (no argument toggles) switches between Spanish and English and remembers the choice in `~/.violeta/agent/violeta.json`. It applies at once to cards, sidebar, footer, overlays, dialogs and notices; command descriptions refresh on the next start. All text lives in `src/i18n.ts`. Tool names, parameter names and their descriptions stay in English because they are for the model. Pi's own built-in texts (`Operation aborted`, the key-hint line under dialogs, `Working`) are not translatable from an extension.

## Notes

- Font is a terminal setting, not Pi's. JetBrains Mono is installed on this machine.
- NaN's key is read at request time from `~/.gentle-shell/agent/auth.json` through `jq`; it is never copied.
- Tests: `npm test`.
