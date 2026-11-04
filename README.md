# violeta

A minimal, information-first Pi harness. Runs as its own command with its own agent directory (`~/.violeta/agent`), so it never touches gentle-shell.

## Install on a fresh machine

```sh
curl -fsSL https://raw.githubusercontent.com/TasioDemarchi/pi-violeta/main/install.sh | bash
```

It checks the dependencies (`git`, Node 22+, `npm`, and `jq` — which is not optional, the model catalog resolves the API key with it), clones to `~/violeta`, installs, links `~/.local/bin/violeta`, stores the NaN key in `~/.violeta/agent/auth.json` (imported from gentle-shell when it is there, asked for otherwise) and finishes by running the whole test suite, so a green install is a verified one.

`VIOLETA_DIR`, `NAN_KEY` and `VIOLETA_SKIP_TESTS=1` change where it goes, skip the prompt and skip the tests.

## Run

```sh
violeta            # symlinked at ~/.local/bin/violeta -> bin/violeta
```

## Before you change anything

- **[`CONTINUAR.md`](CONTINUAR.md)** — the handoff: real state, what is half-built, the traps that already cost hours, the decisions not to re-litigate, the measured model data, and the prompt to paste into a new session.
- **[`AGENTS.md`](AGENTS.md)** — how to work in this repo: the one architectural rule, the commands, the conventions.

## What you see

- Header: one line, `▍ violeta · pi <version>`.
- Footer, left: project, git branch, working-tree changes — `+` created (green), `~` updated (yellow), `−` deleted (red).
- Footer, right: model, context usage, tokens in/out, session cost.
- `/sidebar` (`on`, `off`, no argument toggles): hides the footer and shows the same information in more detail in a right-hand sidebar — project (name, path, branch), changes (at most 8 rows: the file names with `+`/`~`/`−`, or — when the list is full and the change types are mixed — one count per group: `+6 creados`, `~3 modificados`, `−1 eliminado`), tasks (the todo list, see below), , model (id, thinking level, context bar), usage (tokens, cost). Falls back to the footer below ~100 columns or outside fullscreen. The choice is remembered in `violeta.json` (default off).
- Theme `violeta`: base `#7502c7` for borders and selection; a lighter tint of the same hue for accent text so it stays legible.
- Activity line: while the agent works, one line above the editor shows the current phase — `▍ thinking` while the model writes, `exploring` for read-only tools (read, grep, find, ls), `implementing` for edit/write, `checking` for test-like bash commands, `running` for other bash — with three dots that appear and disappear in a loop so the line stays animated while the width never shifts. The line is removed entirely when the agent is idle, and Pi's native Working spinner is hidden while it is active.

## Layout

| Path | Role |
|---|---|
| `bin/violeta` | Launcher: isolates `PI_CODING_AGENT_DIR`, seeds settings, syncs `config/models.json` (NaN catalog) on every start |
| `extensions/violeta-ui.ts` | Header, footer, `/sidebar`, `/context` and `/usage` commands, activity line |
| `src/changes.ts`, `src/format.ts`, `src/sidebar-content.ts`, `src/sidebar-state.ts`, `src/activity.ts`, `src/usage.ts` | Pure logic (tested) |
| `extensions/violeta-agents.ts` | Subagent tools, card and `alt+a` view |
| `src/agents/` | Store, runner, definitions, history, card and view rendering (tested) |
| `extensions/violeta-guard.ts`, `src/guard/` | Destructive-command guard and outside-project grants |
| `extensions/violeta-todo.ts`, `src/todo/` | Todo tool and card |
| `extensions/violeta-jobs.ts`, `src/jobs/` | Background jobs, monitors, `/jobs` |
| `extensions/violeta-changes.ts`, `src/changes-view/` | `/changes` diff viewer |
| `extensions/violeta-tools.ts`, `src/tools-view/` | Compact one-line tool renderers |
| `extensions/violeta-notify.ts`, `src/notify/` | `/notify` finish and dialog alerts |
| `extensions/violeta-models.ts`, `src/models-view/` | `/models` quick selector |
| `src/agents/breaker.ts` | Dispatch breaker: reports and asks between subagent dispatches (tested) |
| `extensions/violeta-contract.ts`, `src/contract/` | `contract_check`: zero-token lint of a Jarvis contract (tested) |
| `extensions/violeta-mode.ts`, `src/modes/` | `/mode` philosophy switch (prompt, model and agent roster) |
| `extensions/violeta-btw.ts`, `src/btw/` | `/btw` side chat: state, request and framed panel (tested) |
| `src/frontmatter.ts` | The minimal YAML reader shared by agent and mode definitions |
| `extensions/violeta-palette.ts`, `src/palette/` | `/palette` command palette |
| `src/context-warning.ts` | Context color thresholds and `/compact` hint |
| `agents/`, `modes/` | The shipped roster and philosophies, synced into `~/.violeta/agent/` on every start |
| `config/models.json` | NaN model catalog |
| `config/settings.json` | Settings fragment merged on start (declares the Claude bridge package) |
| `themes/violeta.json` | Palette |

## Modes

The engine is neutral, so a philosophy enters in exactly one place, as data: a markdown file in `~/.violeta/agent/modes/<name>.md`.

- **Define a mode:** frontmatter `name`, `description`, `model` (the model the main session switches to), `thinking` (the reasoning level it pins) and `agents` (the roster it exposes); the body is appended to the main session's system prompt.
- **Reasoning level:** a mode owns it because more reasoning is not uniformly better — some models reach the right approach and then reason themselves out of it at maximum effort.
- **`/mode`** with no argument reports the active mode and the catalogue; `/mode <name>` switches, persists the choice in `violeta.json` and shows the mode in the header, so you always know which philosophy is running. In fullscreen the header is pinned above the conversation and never scrolls away (outside fullscreen the terminal owns the scrollback and it cannot be pinned).
- **Agents:** an absent `agents` list exposes every agent; a declared empty one exposes none. These are different statements, and the second is how a mode removes the agent layer entirely.
- **`raw`** is built in and always available: no prompt, no agents, no ceremony. A `raw.md` replaces it. It exists so a missing or broken catalogue still leaves a usable session.
- The prompt is appended through `systemPromptOptions.appendSystemPrompt`, never by replacing `systemPrompt`: replacing would drop Pi's own tool and environment sections. Appending also keeps the cached prefix stable, so switching costs one cache miss rather than one per turn.
- A mode file that fails to parse is reported, never swallowed: a session that quietly runs unguided is worse than one that says what broke.

The repo ships one: **`jarvis`** (the default — contract first, two approvals, see below). Three earlier modes (`odd`, `scout`, `vault`) were removed once `jarvis` covered the work: a half-finished philosophy is a liability, since the mode decides how every task is run. `agents/` and `modes/` live in git and are synced into `~/.violeta/agent/` on every start, so the philosophy survives a reinstall; files you add there yourself are left alone.

**No agent costs money** — Claude is reached only by raising the session model with `/models`. Everything runs on the flat-rate cluster, whose allowances are large enough that a heavy day of iterating spends a few percent of one pool. Roles are therefore assigned by fit, not by pool:

| Role | Model | Chosen because |
| :--- | :--- | :--- |
| Orchestrator (`jarvis`) | `deepseek-v4-flash` | the one model with reports praising its natural-language handling, and ~3x the output speed, which matters while talking |
| `scout` | `deepseek-v4-flash` | general workhorse, 1M context |
| `builder` | `deepseek-v4-flash` | best of four in a replay of three real tasks (see Bake-off): fastest, fewest tokens, no false "completed" |
| `critico` | `qwen3.8-flash` | not the orchestrator's model, so it questions the contract instead of agreeing with its author |
| `judge` | `qwen3.8-flash` | never the model that wrote the change |
| `probador` | `deepseek-v4-flash` | it drives a running program over many turns, so speed is what it spends |

`config/models.json` is the catalogue for the **nan_member** plan. `glm5.3` (as opposed to `glm5.3-flash`) belongs to the 200 EUR premium tier and is deliberately absent: a model that is real but out of plan fails at request time rather than at startup, so a test pins its absence.

## Jarvis

`/mode jarvis` is the philosophy for work where the user decides and the agents execute. It is deliberately short (166 lines) because everything that must always hold is code, not prose.

- **Flow:** understand (at most five questions, each with a recommended answer) -> one-page contract (`tasks/<name>.md`) -> `contract_check` -> `critico` once -> **approval 1** -> `builder` per task, each `Check` re-run by the orchestrator -> `judge` only on `riesgo: sí` tasks -> **approval 2** (the user reads the result; commit is theirs).
- **Roster:** `scout` (optional), `critico` (reads only the contract, at most seven closed questions, never rewrites), `builder`, `judge` (one independent reviewer; findings go to the user, who chooses what to fix) and `probador` (runs a copy of the finished program from the outside and tries to break it; only when the work runs something and a task is `riesgo: sí`; if it is cut at its ceiling, its progress file `.violeta/scratch/probe/informe.md` is the report).
- **Contract:** `No-objetivos`, `Specs` (each with `Accept` and `Check`), `Tasks` (each with `specs`, `test`, `riesgo`), `Decisiones`, `Log` (`L1` is the user's request, verbatim). An external system implies an `S0`/`T0` spike unless the contract says `Externo: no`.
- **`contract_check`** runs before any model reads the contract: missing sections, a spec without a runnable `Check`, a task citing no spec, an uncovered spec, a missing `L1`, a missing spike.

## Dispatch breaker

Every subagent goes through `subagent_run`, so the harness can count. Two separate behaviours, both measured from the user's last message:

- **Report (never stops anything):** after 4 dispatches or 15 minutes, the harness shows a status line itself. The model is not asked to cooperate.
- **Confirm (the only stop):** a dialog **between** tasks, never inside one, when the same agent and task is launched for the 3rd time, or after 12 dispatches or 60 minutes. Nothing in flight is killed, so no file is left half-written. Without a UI the answer is no.

Tune with `VIOLETA_BREAKER_REPORT_EVERY`, `_REPORT_MINUTES`, `_HARD_DISPATCHES`, `_HARD_MINUTES`, `_LOOP_REPEAT`. The numbers come from the replay of one real project and are to be retuned with measurements. A prompt typed by the user restarts the window; a background result being delivered does not.

## Bake-off (builder choice)

Replay of three real tasks from the Android project (T2 `record.ts`, T5 `runner.ts`, T6 the pure classifier) plus a spec-review task with three injected defects that the existing tests do not catch. Same `builder.md`, same runner, isolated copies. Turns / tokens / wall time per run:

| Model | T2 | T6 | T5 | Defects found (of 3, three runs) |
| :--- | :--- | :--- | :--- | :--- |
| `deepseek-v4-flash` | 16 / 68k / 250s, 18 / 98k / 576s | 17 / 83k / 186s, 18 / 99k / 247s | 14 / 80k / 193s, 25 / 92k / 257s | 2, 2, 2 |
| `qwen3.8-flash` | 23 / 86k / 443s | 19 / 86k / 470s | 19 / 92k / 512s | 1, 2, 2 |
| `glm5.3-flash` | 23 / 47k / 621s | 21 / 406k / 841s | 10 / 97k / 388s | 2, 2 |
| `mimo-v2.6-flash` | failed, then "completed" with no files | 12 / 113k / 977s | not run | not run |

- **Every run that finished passed its own tests.** The tests the model writes are a weak signal; the original tests could not be used as a hidden check because the contract does not pin export names (an import error, not a reasoning error). Lesson for contracts: when one task depends on another's API, the `Check` names the exports.
- **DeepSeek was the fastest and consistent**; Qwen 3.8 completed everything but wrote 1.3 to 1.7x more code. No model found the subtlest defect (a strict `>` versus `>=` boundary).
- **MiMo with reasoning `medium`** spends turns of about six minutes and about 18k tokens thinking; NaN closes reasoning-only streams after 420 s, which produces `settled without an answer`. With reasoning `off` it is fast but ran out of its 30-turn ceiling. It is not in the Jarvis roster.
- Small sample (one project, 2 to 3 runs per cell). Retune with real use.

## Subagents

Violeta ships the **visual layer** plus a neutral launcher. It has no built-in agents, roles or workflow; you define those.

- **Define an agent:** a markdown file in `~/.violeta/agent/agents/<name>.md` (frontmatter: `name`, `description`, `model`, `thinking`, `tools`, `maxTurns`, `maxTokens`; the body is the prompt).
- **Settling is not answering:** a child that ends with no text is recorded as `failed`, not `completed` — observed twice in real use (a worker that produced no files, and a child its provider cut off), both of which looked like success to the caller.
- **Wrap-up notice:** when a run reaches 75% of its turn or token ceiling (ceilings of 10 turns or more), the runner sends it one `steer` message asking for its complete final report now. Measured need: a tester used 70 turns probing and its only handoff was its first sentence.
- **Ceilings:** `maxTurns` and `maxTokens` are total limits, unlike the stall watchdog's renewable silence budgets — a talkative child renews the watchdog forever and still stops at its ceiling. Reaching one tears the child down with status `budget` (glyph `◼`, counted as finished, never as failed) and **keeps its last answer as the handoff**, because a context that keeps growing costs more per turn and is read worse at the far end; a fresh child continues from that handoff. The ceiling is acted on when the child reaches for more work, so a run that settles on its last allowed turn is `completed`. A definition without them has no ceiling. `VIOLETA_AGENT_MAX_TURNS` and `VIOLETA_AGENT_MAX_TOKENS` override every definition, to retune budgets without editing files.
- **Tools for the model:** `subagent_list_agents`, `subagent_run` (`task` waits, `background` returns an id and delivers the result later), `subagent_status`, `subagent_result`, `subagent_cancel`. Each task is a `pi --mode rpc` child; at most 3 run at once (`VIOLETA_AGENTS_MAX_CONCURRENCY`), the rest are `queued`. Children cannot spawn children.
- **Titles:** `label` is required in `subagent_run` (what the agent does, 3 to 6 words, phrased as an action), so you can tell tasks apart without reading their context. If it is missing, the first sentence of the task is used.
- **Card above the editor:** `Agentes · N activos · M terminados`, one row per task: status glyph, **title**, the agent role dimmed, then tokens, cost (hidden while $0) and elapsed; `model · effort` shows when there is room. Finished rows stay one minute; extra rows fold into `… N más · alt+a para ver`.
- **`alt+a` or `/agents`:** full-terminal view. Task list on the left (glyph + title, history after active tasks). On the right: title, `role · status · model · tokens · elapsed`, a **Result** section (the task's `summary:` line, else the first line of its answer, plus a few more lines), then the full **Thread**. Keys: `j`/`k` select, `ctrl+j`/`ctrl+k` scroll, `f` follow, `esc` back, `q` close (never cancels children), `alt+s` cancel all active tasks (asks first). Under 60 columns it shows the list only.
- **History:** finished tasks are stored in `~/.violeta/agent/agents-history/` (last 200), with title and summary.

## Safety guard

`extensions/violeta-guard.ts` checks every `bash`, `bash_background` and `monitor` call, and every file tool.

- **Destructive commands** (recursive/forced removal, `find -delete`, `shred`, `dd` to devices, `mkfs`, recursive `chmod`/`chown`, force push including `+refspec`, hard reset, `clean -f`, whole-tree checkout/restore, `branch -D`, `stash drop|clear`, SQL `DROP`/`TRUNCATE`/`DELETE` without `WHERE`) ask for confirmation showing the exact command. Targets like `/`, `~`, `$HOME` and their globs are denied outright. Quoted text, heredoc data and look-alikes are not flagged. It recognises common forms; it is not a sandbox.
- **Outside the project:** a path outside the working directory asks once per directory per session. **Temp paths collapse to the temp root**, so a `mktemp -d` directory does not ask again every run. Grants live in memory only. `/grants` lists them, `/grants revoke` clears them. The violeta agent dir is always allowed.
- **Unattended mode** (`/unattended on|off`, or launch with `VIOLETA_UNATTENDED=1`) is for leaving a run going while you are away: **nothing is ever asked**. Destructive commands are refused with a message telling the model to skip them and carry on (catastrophic targets stay hard-denied). Outside the project, `read`, `grep`, `find` and `ls` pass without a prompt; `write`, `edit` and any shell command touching an outside path are refused (use the read tools to look outside). The dispatch breaker also refuses instead of asking, so a runaway stops by itself. The header shows `· sin supervisión` while it is on. It is never saved: every new session starts attended. It applies to the main session; subagents keep their own stricter rules. Approvals that Jarvis asks in the conversation (contract, final result) are still waiting for you.
- **Subagent children** have no UI, so anything that would ask is blocked instead.


## Side chat

`/btw` is an aside: a question answered **beside** the work instead of inside it. The main agent never sees the question, the session never takes a turn for it, and nothing you ask there ends up in the context the agent is working with.

| Command | What it does |
|---|---|
| `/btw` | Opens and closes the window |
| `/btw <message>` | Asks with the session's conversation as context (opens the window if it was closed) |
| `/btwn` | Forgets the side conversation, keeps the window |
| `/btwn <message>` | Asks as a new session: no session context and no previous aside |

- **Where it is drawn.** While the sidebar is active (`/sidebar on`, fullscreen, 100 columns or more) **the sidebar becomes the chat**: the framed panel takes the whole column and project, changes and model come back the moment it closes. With no room for a sidebar the same panel is a framed box above the editor. Both are drawn by one function, so the two placements cannot drift, and the frame is the point: the aside must not read as part of the conversation.
- **Everything is typed in the main editor.** Only `/btw` and `/btwn` reach the side chat.
- **Which model answers.** The session's current model, so the aside answers with the same head as the main thread. Raising the session model with `/models` raises the side chat too — including the Claude bridge, which is the one model that spends real money.
- **What travels.** The conversation only: user and assistant text, in order, cut to the most recent 40,000 characters (`BTW_CONTEXT_CHARS`). Tool calls and tool output are left out — they are the bulk of a session's tokens and none of its conversation. `/btwn` sends none of it.
- **It answers in the background.** The command returns at once, the panel says `pensando…`, and you keep typing meanwhile. A second question while one is in flight is refused, not queued. A failure becomes a line in the panel instead of a notification that scrolls away.
- **Nothing is saved.** The side conversation lives in memory: a new session starts empty and closing violeta forgets it.
- While the side chat owns the sidebar, the `TAREAS` section is not drawn; `/todo` and `/changes` still show the same information on demand.

## Voice (opt-in)

`/voice on|off` (no argument toggles; saved in `violeta.json`, **off by default**). While it is off nothing changes: no prompt addition, no network call, no process. While it is on:

- **`/voice completo` (default): the whole reply is read.** Code does the cleaning, so it does not depend on the model obeying a format: code blocks and tables become a short notice ("Hay código en pantalla", "Hay una tabla en pantalla"), markup, emoji and arrows disappear (an arrow becomes a pause), each list item becomes its own sentence, and the plain-Spanish glossary is read. The system prompt only asks Jarvis to write so it also works heard (say what the thing is before how it works, explain terms, ask first if the question is too open). Capped at 12,000 characters (about twelve minutes), cut at a sentence end.
- **`/voice resumen`: a separate spoken script.** The prompt asks for a closing `Voz:` section written for the ear (the answer itself, self-contained, taught in order with an everyday example); only that is read. It depends on the model following the format, which a flash model does unevenly.
- **How it plays.** The text is split by paragraph, each one synthesized with NaN's `kokoro` (three at a time) and joined with a 0.7 s pause. Playback goes in groups of about 1,200 characters: the first group starts as soon as it is ready while the next ones are still being made. A new prompt or `/voice off` stops the audio and stops requesting more.
- **Pace.** `/voice speed <0.5-1.3>` (default 1.1, just above the model's own pace; lower is slower) is saved in `violeta.json`; `VIOLETA_VOICE_SPEED` overrides it. It was 0.85 and then 1, and both were slow by ear: slowing a small TTS down is most of what makes it sound synthetic.
- **`/dictar` listens.** It records from the microphone while a dialog is open, you choose *Terminar*, the audio goes to NaN's `whisper` (Spanish), and the text lands **in the editor** for you to read and send. Nothing is sent to the agent by itself, so a misheard word is never executed.

Players and recorders are programs already on the machine (`pw-play` or `aplay`; `pw-record` or `arecord`). Any failure is one notification per session and never touches the conversation. Subagents never use voice. Settings by environment: `VIOLETA_VOICE_NAME` (default `ef_dora(2)+em_alex(1)` — kokoro accepts a blend with weights, and this one was picked by ear over each single voice; the Spanish voices on their own are `ef_dora`, `em_alex` and `em_santa`), `VIOLETA_VOICE_TTS_MODEL`, `VIOLETA_VOICE_STT_MODEL`, `VIOLETA_VOICE_BASE_URL`. Each spoken script and each dictation uses NaN quota for those two models.

## Morning brief

Every new session opens with one question — **Parte de la mañana: "Con voz" or "Solo en pantalla"** — and then the brief: the greeting the hour deserves, the time in words, the weather where you are, the day's story, and "¿En qué trabajaremos hoy?".

- The answer **is** the voice setting, so this is also how voice gets turned on and off day to day. Either way the brief is written to the screen, because audio goes by once and a headline is worth re-reading; "Solo en pantalla" skips the speaking, not the brief.
- **Escape answers nothing, and nothing happens**: no feed is read and no model is called. Someone who dismissed the question did not ask for a brief.
- The question is asked without blocking: a dialog awaited inside `session_start` would hold up every other extension's handler behind it.
- **`/goodmorn`** runs the same brief by hand, always out loud, and turns the voice on like `/voice on`.

- **Three services, no account and no key:** the city from your IP (`ifconfig.co`, then `ipwho.is`), the weather from Open-Meteo (a WMO code, translated to words in Spanish), the headlines from Google News' RSS feed for Argentina.
- **Every clause is optional.** A service that fails drops its own clause: with no network at all the brief is still the greeting, the time and the question. It never says it has no data and never reads an error out loud.
- **The news is the owner's subjects, not the day's front page.** One Google News search feed per topic (`NEWS_TOPICS` in `src/goodmorning/sources.ts`: AI, gaming hardware, video games), each keeping its own four slots, because a single OR query is dominated by whichever topic published most in the last hour. The general Argentine feed was dropped: its top story is the dollar, an accident or a football match, and the brief is for one person. Changing those three lines changes what the brief is about.
- **The choice is still a judgement.** Every fresh story (at most 8) goes to the session's model in one call, each with the headlines several outlets ran about it; the model picks the most interesting one and says it in one sentence opening with "Hoy". What a topic feed cannot tell apart is a real development from a local course, an upcoming event or a colour piece, which is what fills it on a slow day, so the prompt asks for the former. The other outlets' headlines are what make the sentence possible: a front page's own headline is often "a cuánto cotiza, minuto a minuto", while the ones beside it carry the facts.
- **The language is code, not a request.** The prompt is written in Spanish and says to answer in Spanish, and the model still summarized an Argentine feed in English — twice, out loud, in the middle of the brief. So the sentence must open with the dictionary's `opener` ("Hoy"), which the prompt asks for anyway; one that does not is dropped and the story the model picked is read as a headline instead. The judgement survives, the foreign sentence does not.
- **A story is told once.** The feed barely moves in an hour and the model is deterministic — the same candidates produce the same sentence, word for word — so five sessions in an afternoon told the same news five times. The model answers with the number of the story it picked, that title goes into `briefSaid` in `violeta.json` (the last 40), and told stories are dropped from the candidates before the cap, so heard news cannot crowd out what is new. Once everything fresh has been told the day's line falls to the joke, which is the honest answer to "nothing new since you last looked".
- **Symbols become words in code, not in the prompt** (`forTheEar`): `USD $500` is said as "500 dólares", `3,5%` as "3,5 por ciento", a bare `$1.480` as pesos. Asked to do this in prose, the model also turned `RTX 5090` into "el modelo cinco mil noventa" and spent half again as many tokens reasoning; a product name is not a number to spell out.
- **No outlet is named** (the owner's call): the brief says what happened, not who reported it. The fallback, when the model answers nothing, is the newest headline read as it stands — worse, since a headline is written to be read and not heard, which is the whole reason for the sentence.
- **Only a day with no news gets a joke**, asked of the same model, and the prompt forbids it from reading as a fact.
- **Prompts are short on purpose.** A first version carried a word ceiling and five prohibitions; a reasoning model spent its entire token budget counting words and auditing the rules, and answered with nothing at all. One positive rule is cheaper to obey than five negative ones.
- **Spoken numbers are spelled out** ("diecinueve grados"), because a small TTS reads `18,9` unevenly.
- **It is spoken one sentence at a time**, with 450 ms of real silence between them. Inside a sentence the pauses are the voice model's to make; between sentences they were left to it and did not land. The value was chosen by ear against 400, 500 and 650.
- What the owner is called is `VIOLETA_OWNER_NAME`, defaulting to `Tachi`, and it is said on its own with no title in front of it.

## Todo list

The `todo` tool (`write`, `add`, `update`, `clear`, `list`; statuses `pending`, `in_progress`, `blocked` (needs a note), `done`, `dropped`) keeps a list that is saved in the session and restored on resume. A card above the editor shows `Tareas · N abiertas · M hechas`; when the sidebar is active the same list appears there as a `TAREAS` section instead (and not above the editor). In the sidebar the section is compact: 5 rows and then a bare `…` (the framed card above the editor keeps 8 and `… N más`). `/todo` hides or shows it wherever it is drawn. It disappears a minute after everything is finished.

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
| `/context` | | What the footer shows in one glyph, written out: percent, window size, tokens used and tokens left. From 80% it repeats the `/compact` suggestion. |
| `/usage` | | The session's tokens and cost, split by model — which the footer and the sidebar do not show, and which is the only part that costs money when the session runs on a paid model. |
| `/notify on\|off` | | Opt-in. Terminal bell plus `notify-send` (if installed) when a run longer than 20 s ends or a confirmation dialog waits. Off by default, remembered in `violeta.json`. |
| `/btw`, `/btwn` | | The side chat; see Side chat above. |
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
