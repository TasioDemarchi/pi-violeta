/**
 * i18n — every user-facing string violeta itself shows, centralized (S10), in
 * ONE dictionary: English (S4). The interface is English-only; there is no
 * language switch, no second dictionary and no lookup at access time — each
 * exported namespace IS its section of the dictionary.
 *
 * Strings are grouped by area, with plain functions for plurals and
 * interpolation: `guard`, `guardReasons`, `handoff`, `agents`, `contract`,
 * `changes`, `todo`, `jobs`, `sidebar`, `ui`, `voice`, `activity`, `notify`,
 * `models`, `context`, `usage`, `palette`, `modes`, `btw`.
 *
 * Two keys here reach a MODEL rather than the screen, and both ask for a
 * Spanish answer while the screen stays English:
 * - `btw.systemPrompt` — the aside replies in Spanish,
 * - `guard.explainPrompt` — the explanation is Spanish, but the three
 *   `Action:/Files:/Folders:` labels (`guard.explainLabels`) are English on
 *   purpose: the parser in src/guard/explain.ts and the dialog key off them.
 *
 * Deliberately NOT here (they stay English):
 * - tool names, parameter names, tool/parameter descriptions and TypeBox
 *   schema text (they are for the model),
 * - code identifiers, comments and README,
 * - status/enum VALUES used as identifiers (`blocked`, `in_progress`,
 *   `job`, `monitor`, thinking levels) and user-provided content,
 * - Pi core's own strings (`Operation aborted`, dialog key hints, `Working`).
 */

/** Display words for task statuses (the values themselves stay identifiers). */
const agentStatuses: Record<string, string> = { queued: "queued", running: "running", completed: "completed", failed: "failed", aborted: "aborted", budget: "stopped at its ceiling" };

/** The accepted todo statuses, written once: the error text repeats them. */
const todoStatuses = "pending, in_progress, blocked, done, or dropped";

/** The accepted todo actions, written once: the error text repeats them. */
const todoActions = "write, add, update, clear, or list";

const dictionary = {
	guardReasons: {
		recursiveRemoval: "recursive file removal",
		forcedRemoval: "forced file removal",
		findDelete: "find -delete",
		shred: "shred",
		ddDevice: "dd writes to a device",
		mkfs: "mkfs",
		killEverything: "kill of a whole process group",
		killUnknownTarget: "kill of a target that is not a literal PID",
		killPattern: (name: string) => `${name} by pattern`,
		recursiveBroadPath: (name: string) => `recursive ${name} on a broad path`,
		gitForcePush: "git force push",
		gitResetHard: "git reset --hard",
		gitCleanForce: "git clean -f",
		gitBranchDelete: "git branch -D",
		gitStashDropClear: "git stash drop/clear",
		gitCheckoutWholeTree: "git checkout of the whole tree",
		gitRestoreWholeTree: "git restore of the whole tree",
		sqlDropTruncate: "SQL DROP/TRUNCATE statement",
		sqlDeleteWithoutWhere: "DELETE without WHERE",
		inlinePayload: "inline code in an interpreter (there is no way to read what it does)",
	},
	handoff: {
		"missing-status": "The harness rejects this delivery: it carries no `status:` line from its return contract " +
			"(completed, partial, blocked, interaction_required), so it did not finish. What is above is what the worker " +
			"said; do not take it as a delivery. Dispatch a fresh one with whatever is already in the tree.",
		"partial-without-remaining": "The harness rejects this delivery: it says `status: partial` and carries no " +
			"`remaining:`, so nobody can continue it. Dispatch a fresh one and ask it to state what is left.",
		"missing-extras": "The harness rejects this delivery: a builder never omits `extras:`, and \"none\" is the " +
			"expected answer. It exists so you can reject unasked work in one turn instead of finding it in review.",
		"required-test-skipped": "The harness rejects this delivery: the task row says `test: required` and `RED:` is " +
			"`n/a` or missing. A test nobody saw fail proves nothing. Dispatch a fresh one and ask for the observed RED.",
	},
	guard: {
		yes: "Yes",
		no: "No",
		destructiveTitle: "Destructive command",
		explainWorking: "Reading the command…",
		explainLabels: { action: "Action", files: "Files", folders: "Folders" },
		explainCommandLabel: "Command",
		explainWhy: (reasons: readonly string[]) => `Why: ${reasons.join("; ")}.`,
		explainQuestion: "Run it anyway?",
		explainPrompt: (command: string) =>
			`This shell command is about to run on the user's computer:\n\n${command}\n\n` +
			"Explain what it will do in exactly three lines with this format, writing the content of every line in Spanish:\n\n" +
			"Action: what it does, in one short sentence and no jargon.\n" +
			'Files: the files it touches, comma separated, or "none".\n' +
			'Folders: the folders it touches, comma separated, or "none".\n\n' +
			"Keep those three labels exactly as written and answer with the three lines only.",
		destructiveBody: (command: string, reasons: readonly string[]) =>
			`${command}\n\nWhy: ${reasons.join("; ")}. Run it anyway?`,
		declined: (command: string) =>
			`The user declined this destructive command: ${command}. Find a safer way.`,
		blocked: (reasons: readonly string[]) =>
			`Blocked: ${reasons.join("; ")}. No interactive user is available to approve it.`,
		catastrophic: (reason: string) => `Catastrophic target denied without a prompt: ${reason}.`,
		writeLocked: (path: string, contract: string) =>
			`Blocked by jarvis.write-lock: do not write ${path} while ${contract} has unfinished tasks. ` +
			'If this is field work no subagent can reach, add "— quién: Jarvis" to that task\'s row, ' +
			"tell the user and try again. Otherwise dispatch a builder for the task.",
		testsLocked: (path: string) =>
			`Blocked by jarvis.tests-readonly: do not write ${path}. ` +
			"Tests are written by a builder, never by the session that wrote the code. Dispatch a builder for that task.",
		bashLocked: (path: string, contract: string) =>
			`Blocked by jarvis.bash-write: this command writes ${path}, and ${contract} has unfinished tasks. ` +
			'If this is field work no subagent can reach, add "— quién: Jarvis" to that task\'s row, ' +
			"tell the user and try again. Otherwise dispatch a builder for the task.",
		agentReadOnly: (agent: string, path: string) =>
			`Blocked by agent.read-only: you are ${agent} and you write nothing — ${path}. ` +
			"Look and report: what you found goes in your report, not on disk.",
		agentScratchOnly: (path: string, scratch: string) =>
			`Blocked by agent.scratch-only: you write only under ${scratch}, and ${path} is outside it. ` +
			"Copy what you need there and run everything from that copy.",
		criticContractOnly: (path: string) =>
			`Blocked by critic.contract-only: you read the contract you were given, not the repository — ${path}. ` +
			"What you cannot tell from the page alone is exactly the finding.",
		agentNoSecrets: (path: string) =>
			`Blocked by agent.no-secrets: ${path} is a secret and its contents reach no model. ` +
			"If the task needs it, say so in `risks` and let the owner resolve it.",
		agentNoDelivery: (what: string) =>
			`Blocked by agent.no-delivery: \`${what}\` delivers, and delivery is the owner's. ` +
			"Leave the work in the tree and report it; the commit, the push and the PR are theirs.",
		outsideTitle: "Outside-project access",
		outsideBody: (dir: string) =>
			`Allow access outside the project: ${dir}? The grant lasts only for this session.`,
		outsideNeedsGrant: (dir: string, cwd: string) =>
			`Access outside the project (${dir}) needs a grant and there is no UI to ask. Grant it in an interactive session, or keep work inside ${cwd}.`,
		outsideDeclined: (dir: string, cwd: string) =>
			`Access to ${dir} was not approved. Stay inside ${cwd} or ask the user to grant it.`,
		grantsDescription: "List outside-project grants, or clear them with /grants revoke",
		grantsRevoked: (n: number) => `Revoked ${n} outside-project grant(s).`,
		grantsNothingToRevoke: "No outside-project grants to revoke.",
		grantsList: (dirs: readonly string[]) =>
			`Outside-project grants for this session:\n${dirs.map((dir) => `- ${dir}`).join("\n")}\n\n/grants revoke clears them.`,
		grantsEmpty: "No outside-project grants in this session.",
		unattendedDescription: "Unattended mode: refuse destructive commands without asking and allow reads outside the project (/unattended on|off)",
		unattendedUsage: "usage: /unattended [on|off]",
		unattendedOn:
			"Unattended mode ON: destructive commands are refused without asking, reading outside the project is always approved, writing outside the project is refused.",
		unattendedOff: "Unattended mode off: I ask again.",
		unattendedBlocked: (reasons: readonly string[]) =>
			`Refused (unattended mode): ${reasons.join("; ")}. It did not run. Skip this step, use a safer alternative and carry on with the rest of the work.`,
		unattendedOutsideWrite: (dir: string, cwd: string) =>
			`Refused (unattended mode): outside the project (${dir}) you can only read, using read, grep, find or ls. To write or execute stay inside ${cwd}; carry on with the rest of the work.`,
		checkUnattended: "unattended mode: automatic verification does not run. Run the Check again in an interactive session.",
		inlineTitle: "Command with inline code",
	},
	agents: {
		statuses: agentStatuses,
		toolStatuses: { running: "running", done: "done", error: "error" } as Record<string, string>,
		queued: "queued",
		cardTitle: (active: number, done: number, failed: number) => {
			const parts = [`${active} active`, `${done} done`];
			if (failed > 0) parts.push(`${failed} failed`);
			return `Agents · ${parts.join(" · ")}`;
		},
		fold: (n: number, viewKey: string) => `… ${n} more · ${viewKey} to view`,
		listHeader: (active: number, finished: number) => {
			// The original skipped zero segments (never all of them).
			const parts: string[] = [];
			if (active > 0) parts.push(`${active} active`);
			if (finished > 0) parts.push(`${finished} finished`);
			return parts.length > 0 ? parts.join(" · ") : "0 active · 0 finished";
		},
		sectionResult: "── Result ──",
		sectionThread: "── Thread ──",
		inProgress: "in progress…",
		hint: (mode: "split" | "narrow") =>
			mode === "split"
				? "j/k task  ctrl+j/k scroll  f follow  esc back  q close"
				: "j/k select  enter thread  esc back  q close",
		overlayNeedsTui: "The agents overlay requires interactive mode.",
		agentsDescription: "Show the subagents overlay (active tasks and their threads)",
		shortcutOverlay: "Show the subagents overlay",
		shortcutStop: "Stop the active subagents (asks first)",
		stopTitle: "Stop subagents",
		stopBody: (n: number) => `Cancel ${n} active subagent task(s)? The children are stopped.`,
		stopNone: "No active subagent tasks.",
		stopCancelled: (n: number) => `Cancelled ${n} subagent task(s).`,
		finishedMessage: (title: string, name: string, id: string, status: string) =>
			`Subagent finished: ${title} (${name}, ${id})\nStatus: ${status}`,
		noOutput: "(no output)",
		noAnswer: "(no answer)",
		backgroundStarted: (name: string, id: string) =>
			`Subagent "${name}" started in the background with task id ${id}. Its result will be delivered when it finishes; check progress with subagent_status.`,
		cancelledByCaller: (name: string, id: string) => `Subagent "${name}" (${id}) was cancelled because the caller aborted.`,
		budgetStopped: (limit: string, turns: number, tokens: number) =>
			`The subagent stopped at its ${limit === "maxTurns" ? "turn" : "token"} ceiling (${turns} turns · ${tokens} tokens). This is not a failure: its partial handoff follows. To continue, launch a fresh subagent with what is left.`,
		unknownAgent: (name: string, available: string) => `Unknown agent "${name}". Available: ${available}. Use subagent_list_agents first.`,
		noneAvailable: "(none)",
		breakerSummary: (dispatches: number, minutes: number, tokens: number, by: string, rows: string) =>
			`${dispatches} subagents in ${minutes} min · ${tokens} tokens · ${by || "-"}${rows ? `\n${rows}` : ""}`,
		breakerRow: (agent: string, label: string, status: string, turns: number) => `  ${agent} «${label}» · ${status} · ${turns} t`,
		breakerReport: (summary: string) => `▸ You have not spoken for a while; still working: ${summary}`,
		breakerTitle: "Keep launching subagents?",
		breakerConfirmLoop: (agent: string, label: string, count: number, summary: string) =>
			`"${agent}" is about to run with "${label}" for the ${count}th time. This may be a loop.\n\n${summary}\n\nContinue?`,
		breakerConfirmCeiling: (dispatches: number, minutes: number, summary: string) =>
			`${dispatches} subagents and ${minutes} min without you speaking.\n\n${summary}\n\nContinue?`,
		breakerDeclined: "The user did not authorize launching more subagents. Do not launch another: tell them what is done, what is left, and wait for their reply.",
		noDefinitions: "No subagent definitions found. Create markdown files with YAML frontmatter (name, description, model, thinking, tools, maxTurns, maxTokens) and a system prompt body in the agents directory.",
		noTasksYet: "No subagent tasks yet.",
		unknownTaskId: (id: string) => `Unknown task id ${id}.`,
		noResultYet: "— no result yet.",
		taskStatusWord: (status: string) => `task ${agentStatuses[status] ?? status}`,
		cancelled: (id: string) => `Cancelled task ${id}.`,
		notCancellable: (id: string) => `Task ${id} cannot be cancelled (unknown id or already finished).`,
	},
	contract: {
		resumeTitle: "Rebuild a task that is already built?",
		resumeCommitBody: (task: number, commit: string, subject: string) =>
			`T${task} is already committed: ${commit} "${subject}". Building it again can overwrite what works.\n\nRebuild it anyway?`,
		resumeEstadoBody: (task: number) => `T${task} was already verified by the harness: its Check passed.\n\nRebuild it anyway?`,
		resumeDeclined: (task: number, proof: string) =>
			`Task T${task} is already built (${proof}). Do not rebuild it: read the contract and git log, and carry on with the next task. If it really has to be redone, tell the owner why and wait for their yes.`,
		resumeDeclinedByOwner: (task: number) =>
			`The owner did not authorize rebuilding T${task}. Do not rebuild it: tell them what is done, what is left, and wait for their reply.`,
	},
	changes: {
		created: (n: number) => `${n} created`,
		updated: (n: number) => `${n} updated`,
		deleted: (n: number) => `${n} deleted`,
		empty: "No changes.",
		loading: "loading…",
		binary: "binary",
		moreLines: (n: number) => `… ${n} more line${n === 1 ? "" : "s"}`,
		hint: (mode: "split" | "narrow") =>
			mode === "split"
				? "j/k file  ctrl+j/k scroll  g/G top/bottom  o open  esc close"
				: "j/k file  enter diff  esc back  q close",
		overlayNeedsTui: "The changes overlay requires interactive mode.",
		description: "Show the changes viewer (files and their diff)",
		shortcut: "Show the changes viewer",
	},
	todo: {
		cardTitle: (open: number, done: number) => `Todo · ${open} open · ${done} done`,
		fold: (n: number) => `… ${n} more`,
		ellipsis: "…",
		empty: "No tasks.",
		blockedNeedsNote: "blocked needs a note naming what it waits for",
		titleRequired: "title is required",
		statusList: todoStatuses,
		unknownStatus: (value: string) => `unknown status "${value}" (use ${todoStatuses})`,
		nothingToUpdate: "nothing to update: pass status, title, or note",
		noTask: (id: number | undefined) => `no task #${id}`,
		actionList: todoActions,
		unknownAction: (action: string) => `unknown action "${action}" (use ${todoActions})`,
		description: "Toggle the todo card above the editor",
		shown: "Todo card shown.",
		hidden: "Todo card hidden.",
	},
	jobs: {
		jobRunning: "running",
		jobStopped: "stopped",
		jobFinished: "finished",
		jobFailed: (error: string | undefined) => `failed: ${error ?? "unknown error"}`,
		jobSignal: (signal: string | null | undefined) => `killed by signal ${signal ?? "unknown"}`,
		jobExited: (code: number) => `exited with code ${code}`,
		couldNotRun: (error: string | undefined) => `could not run: ${error ?? "unknown error"}`,
		indicator: (n: number) => `jobs: ${n} running`,
		overlayHeader: (running: number, finished: number) => {
			const parts = [`${running} running`];
			if (finished > 0) parts.push(`${finished} finished`);
			return `Jobs · ${parts.join(" · ")}`;
		},
		listEmpty: "No jobs.",
		listEmptyHint: "No jobs. Start one with bash_background or monitor.",
		confirmStop: (id: string, label: string) => `s again to stop ${id} (${label})`,
		hint: "j/k select  s stop  q close",
		overlayNeedsTui: "The jobs overlay requires interactive mode.",
		description: "Show the background jobs overlay (running and finished)",
		jobStart: (id: string, label: string, outputPath: string) => `Started job ${id} (${label}). Output: ${outputPath}`,
		monitorStart: (id: string, label: string, seconds: number, outputPath: string) =>
			`Started monitor ${id} (${label}) for up to ${seconds}s. Output: ${outputPath}`,
		willNotify: "You will be notified once when it exits; keep working or end your turn.",
		monitorWillNotify: "Each new output line reaches you as an event; keep working or end your turn.",
		jobExitHeader: (id: string, label: string, outcome: string, duration: string) =>
			`Job ${id} (${label}) ${outcome} after ${duration}.`,
		jobExitCommand: (command: string) => `Command: ${command}`,
		jobExitLastOutput: "Last output:",
		jobExitNoOutput: "No output.",
		jobExitFullOutput: (path: string) => `Full output: ${path}`,
		monitorReported: (id: string, label: string, lines: number) =>
			`Monitor ${id} (${label}) reported ${lines} ${lines === 1 ? "new line" : "new lines"}:`,
		linesDropped: (n: number) => `(+${n} lines dropped)`,
		monitorStoppedTimeout: (id: string, label: string, seconds: number, path: string) =>
			`Monitor ${id} (${label}) was stopped: it reached its ${seconds}s timeout. Full output: ${path}`,
		monitorStoppedFlood: (id: string, label: string, path: string) =>
			`Monitor ${id} (${label}) was stopped: it printed more than 120 lines within 60 seconds. Full output: ${path}`,
		capError: (max: number) => `At most ${max} jobs can run at once; stop one with job_stop first.`,
		timeoutSecondsInvalid: (max: number) => `timeout_seconds is required and must be a whole number from 1 to ${max}.`,
		jobStopUnknown: (id: string) => `Unknown job id ${id}. Use job_list to see the current jobs.`,
		jobStopNotRunning: (id: string, label: string, state: string) => `Job ${id} (${label}) is not running anymore: ${state}.`,
		jobStoppedNotice: (id: string, label: string) => `Stopped job ${id} (${label}).`,
	},
	sidebar: {
		project: "PROJECT",
		created: (n: number) => `+${n} created`,
		updated: (n: number) => `~${n} updated`,
		deleted: (n: number) => `−${n} deleted`,
		changes: "CHANGES",
		tasks: "TASKS",
		model: "MODEL",
		usage: "USAGE",
		noRepo: "no repo",
		clean: "clean",
		noModel: "no model",
		ellipsis: "…",
	},
	ui: {
		unattendedLabel: "unattended",
		sidebarDescription: "Toggle the right sidebar (the footer hides while it is active)",
		sidebarUsage: "usage: /sidebar [on|off]",
		sidebarNeedsFullscreen: "Sidebar needs fullscreen mode; showing the footer instead.",
	},
	activity: {
		phases: {
			thinking: "thinking",
			exploring: "exploring",
			implementing: "implementing",
			checking: "checking",
			running: "running",
		} as Record<string, string>,
	},
	voice: {
		description: "Turn voice on or off: Jarvis teaches aloud (/voice on|off, completo|resumen, speed 1.1)",
		usage: "usage: /voice [on|off], /voice completo|resumen or /voice speed <rate>",
		modeFull: "Voice in full mode: the whole reply is read (code and tables stay on screen).",
		modeSummary: "Voice in summary mode: only a short script written by Jarvis is read.",
		speedUsage: (min: number, max: number) => `usage: /voice speed <number between ${min} and ${max}> (1 is normal, lower is slower)`,
		speedSet: (speed: number) => `Voice speed: ${speed}. It applies from the next reply.`,
		enabled: "Voice on: Jarvis will read the whole reply aloud. Dictate with /dictar and change the pace with /voice speed.",
		disabled: "Voice off.",
		dictateDescription: "Dictate with the microphone: the text lands in the editor for you to review",
		dictateNeedsVoice: "Turn voice on first with /voice on.",
		recordingTitle: "🎙 Recording… speak now",
		finish: "Finish",
		cancel: "Cancel",
		dictateCancelled: "Dictation cancelled.",
		nothingHeard: "Nothing was understood. Try again, closer to the microphone.",
		dictated: "Dictation ready: review it and press Enter to send.",
		noKey: "Voice needs the NaN key (auth.json) and I could not find it.",
		noPlayer: "No audio player found (pw-play or aplay).",
		noRecorder: "No audio recorder found (pw-record or arecord).",
		playerFailed: (message: string) => `Could not play the audio: ${message}`,
		recorderFailed: (message: string) => `Could not record: ${message}`,
		speakFailed: (message: string) => `Voice failed (everything else keeps working): ${message}`,
		dictateFailed: (message: string) => `Dictation failed: ${message}`,
	},
	notify: {
		description: "Notify when a long run finishes or a dialog waits for your answer",
		usage: "usage: /notify [on|off]",
		enabled: "Notifications on.",
		disabled: "Notifications off.",
		finished: (phrase: string) => `Finished: ${phrase}`,
		needsAnswer: "Needs your answer",
	},
	models: {
		description: "Show the quick model selector",
		shortcut: "Show the model selector",
		overlayNeedsTui: "The model selector requires interactive mode.",
		title: "Models",
		empty: "No models with available authentication.",
		hint: "j/k select  enter switch  esc close",
		switched: (id: string) => `Switched to ${id}.`,
		switchFailed: (id: string) => `Could not switch to ${id} (no authentication).`,
	},
	context: {
		compactSuggest: "Context is at 80%. Consider /compact.",
		description: "Show how much context the session has left.",
		line: (percent: string, window: string) => `Context: ${percent} of ${window} tokens.`,
		usedFree: (used: string, free: string) => `Used ${used} · Free ${free}`,
		unknown: "No context reading yet in this session.",
	},
	usage: {
		description: "Show the session's tokens and cost.",
		empty: "The model has not answered yet in this session.",
		title: (replies: number) => `Session usage · ${replies} ${replies === 1 ? "reply" : "replies"}`,
		titleWithModel: (replies: number, model: string) =>
			`Session usage · ${replies} ${replies === 1 ? "reply" : "replies"} · ${model}`,
		tokens: (input: string, output: string, cost: string) => `In ${input} · Out ${output} · Cost ${cost}`,
		cache: (read: string, written: string) => `Cache: ${read} read · ${written} written`,
		byModel: "By model:",
		modelLine: (model: string, replies: number, tokens: string, cost: string) =>
			`  ${model} · ${replies} ${replies === 1 ? "reply" : "replies"} · ${tokens} · ${cost}`,
		unknownModel: "(unnamed)",
	},
	modes: {
		description: "Switch the active philosophy, or show it with no argument.",
		current: (name: string, description: string) =>
			`Active mode: ${name}${description ? ` — ${description}` : ""}`,
		available: (names: readonly string[]) => `Available: ${names.join(", ")}. Use /mode <name> to switch.`,
		switched: (name: string, description: string) =>
			`Mode ${name}${description ? ` — ${description}` : ""}`,
		modelSwitched: (model: string) => `Session model: ${model}.`,
		modelMissing: (model: string) =>
			`The mode asks for model "${model}", which is not available. The session keeps its current model.`,
		unknown: (name: string, available: readonly string[]) =>
			`Unknown mode "${name}". Available: ${available.join(", ")}.`,
		loadError: (source: string, message: string) => `Could not read mode ${source}: ${message}`,
		agentsHidden: (name: string) => `Mode ${name} exposes no subagents.`,
		promptHeading: (name: string) =>
			`# Active mode: ${name}\n\nThese are the rules in force NOW. If earlier turns in this conversation say you are in another mode, those turns are stale: they describe how you used to work, not how you work now.`,
		promptSwitched: (from: string, to: string) =>
			`[violeta] The user switched the mode from "${from}" to "${to}". From here on follow only the rules of "${to}". What you said earlier under "${from}" no longer applies, including any role or restriction you announced.`,
	},
	btw: {
		description: "Side chat: ask with the session's context, without breaking the thread (/btw [message])",
		descriptionNew: "Side chat with no context: clears the previous conversation (/btwn [message])",
		title: "By the way",
		thinking: "thinking…",
		empty: "/btw <question> to ask without breaking the main thread.",
		opened: "Side chat open.",
		closed: "Side chat closed.",
		cleared: "Side chat: conversation cleared.",
		noModel: "No active model: the side chat cannot ask.",
		busy: "The side chat is already waiting for an answer.",
		overlayNeedsTui: "The side chat reader requires interactive mode.",
		viewDescription: "Open the side chat full screen, with scrolling",
		viewShortcut: "Open the side chat reader",
		viewHint: "j/k scroll  ctrl+j/k page  g/G top/bottom  esc close",
		viewPosition: (from: number, to: number, total: number) => `${from}-${to}/${total}`,
		failed: (message: string) => `I could not ask: ${message}`,
		systemPrompt:
			"You are an aside inside a working session. The user is asking you something while another agent works on their project. Answer in Spanish, direct and short, in prose, with no headings or lists unless the question asks for them. You have no tools: you cannot read or write files or run anything, so do not say you will. If you are given the main conversation, it is context to understand the question only: do not continue it and do not opine on what the other agent should do unless asked. If you do not know something, say so in one line.",
	},
	palette: {
		description: "Show the command palette",
		shortcut: "Show the command palette",
		overlayNeedsTui: "The command palette requires interactive mode.",
		title: "Command palette",
		empty: "No matches.",
		hint: "type to filter  enter run  esc close",
		groups: { session: "Session", interface: "Interface", tools: "Tools", other: "Other" },
		sources: { pi: "pi", extension: "extension", prompt: "template", skill: "skill" },
		shortcutsTitle: "Shortcuts",
		shortcuts: {
			agents: "agents",
			changes: "changes",
			models: "models",
			palette: "palette",
			stop: "stop agents",
			expandTools: "expand tools",
		},
	},
};

// The dictionary sections ARE the exports: no proxy, no lookup, no switch. --------

export const guardReasons = dictionary.guardReasons;
/** The harness verdict on the shape of a subagent handoff. */
export const handoff = dictionary.handoff;
export const guard = dictionary.guard;
export const agents = dictionary.agents;
export const contract = dictionary.contract;
export const changes = dictionary.changes;
export const todo = dictionary.todo;
export const jobs = dictionary.jobs;
export const sidebar = dictionary.sidebar;
export const ui = dictionary.ui;
export const voice = dictionary.voice;
export const activity = dictionary.activity;
export const notify = dictionary.notify;
export const models = dictionary.models;
export const context = dictionary.context;
export const usage = dictionary.usage;
export const palette = dictionary.palette;
export const modes = dictionary.modes;
export const btw = dictionary.btw;
