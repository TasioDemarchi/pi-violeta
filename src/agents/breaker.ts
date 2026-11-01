/**
 * Dispatch breaker: the one rule about subagents that cannot live in a prompt.
 *
 * An orchestrator once spent 1.5 hours in a judge -> fixer -> judge loop without
 * telling the user, although its prompt required a checkpoint. Prose is
 * followed when the model remembers; this is enforced by code at the single
 * choke point every subagent goes through.
 *
 * Two functions, deliberately separate:
 * - **report** (never stops anything): after enough dispatches or minutes
 *   without the user speaking, the harness itself tells the user what is going
 *   on. The model is not asked to cooperate.
 * - **confirm** (the only stop): a dialog at the boundary between tasks, for the
 *   two cases where continuing is harmful: the same dispatch for the Nth time
 *   (a loop) and a hard ceiling. Nothing in flight is killed, so no file is left
 *   half-written; the work simply waits for an answer.
 *
 * The window restarts whenever the user speaks (`userTurn`) or approves a
 * confirmation (`approve`). Time is only checked when something is about to be
 * dispatched: a quiet session has nothing to report.
 */

export interface BreakerConfig {
	/** Report after this many dispatches without the user speaking. */
	reportEvery: number;
	/** ...or after this much time, whichever comes first. */
	reportMs: number;
	/** Ask before the next dispatch once this many have run in the window. */
	hardDispatches: number;
	/** ...or once the window is this old. */
	hardMs: number;
	/** The Nth dispatch of the same agent and label asks first. */
	loopRepeat: number;
}

export const DEFAULT_BREAKER: BreakerConfig = {
	reportEvery: 4,
	reportMs: 15 * 60_000,
	hardDispatches: 12,
	hardMs: 60 * 60_000,
	loopRepeat: 3,
};

function positive(value: string | undefined): number | undefined {
	const n = Number.parseInt(value ?? "", 10);
	return Number.isFinite(n) && n >= 1 ? n : undefined;
}

/** Defaults overridden by `VIOLETA_BREAKER_*` variables, so the numbers can be
 * retuned from measurements without editing code. */
export function breakerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BreakerConfig {
	const minutes = (name: string, fallback: number) => {
		const n = positive(env[name]);
		return n === undefined ? fallback : n * 60_000;
	};
	return {
		reportEvery: positive(env.VIOLETA_BREAKER_REPORT_EVERY) ?? DEFAULT_BREAKER.reportEvery,
		reportMs: minutes("VIOLETA_BREAKER_REPORT_MINUTES", DEFAULT_BREAKER.reportMs),
		hardDispatches: positive(env.VIOLETA_BREAKER_HARD_DISPATCHES) ?? DEFAULT_BREAKER.hardDispatches,
		hardMs: minutes("VIOLETA_BREAKER_HARD_MINUTES", DEFAULT_BREAKER.hardMs),
		loopRepeat: positive(env.VIOLETA_BREAKER_LOOP_REPEAT) ?? DEFAULT_BREAKER.loopRepeat,
	};
}

export type BreakerDecision =
	| { kind: "allow" }
	| { kind: "report" }
	| { kind: "confirm"; reason: "loop"; agent: string; label: string; count: number }
	| { kind: "confirm"; reason: "ceiling"; dispatches: number; minutes: number };

export interface DispatchRecord {
	id: string;
	agent: string;
	label: string;
}

export interface TaskView {
	status: string;
	turns: number;
	tokens: number;
}

export interface WindowSummary {
	dispatches: number;
	minutes: number;
	tokens: number;
	counts: Record<string, number>;
	recent: Array<{ agent: string; label: string; status: string; turns: number }>;
}

const keyOf = (agent: string, label: string) => `${agent}\u0000${label.trim().toLowerCase()}`;

export class DispatchBreaker {
	private readonly config: BreakerConfig;
	private readonly now: () => number;
	private windowStart: number;
	private dispatched: DispatchRecord[] = [];
	private repeats = new Map<string, number>();
	private reportedAtCount = 0;
	private reportedAtTime: number;

	constructor(config: BreakerConfig = DEFAULT_BREAKER, now: () => number = Date.now) {
		this.config = config;
		this.now = now;
		this.windowStart = this.now();
		this.reportedAtTime = this.windowStart;
	}

	/** The user spoke: a new window, nothing carried over. */
	userTurn(): void {
		this.windowStart = this.now();
		this.dispatched = [];
		this.repeats.clear();
		this.reportedAtCount = 0;
		this.reportedAtTime = this.windowStart;
	}

	/** The user approved continuing past a confirmation: same as speaking. */
	approve(): void {
		this.userTurn();
	}

	/** What to do before dispatching `agent`/`label`. A `report` decision marks
	 * the report as delivered, so the caller must really deliver it. */
	beforeDispatch(agent: string, label: string): BreakerDecision {
		const now = this.now();
		const priorSame = this.repeats.get(keyOf(agent, label)) ?? 0;
		if (priorSame + 1 >= this.config.loopRepeat) {
			return { kind: "confirm", reason: "loop", agent, label, count: priorSame + 1 };
		}
		const count = this.dispatched.length;
		const age = now - this.windowStart;
		if (count >= this.config.hardDispatches || (count > 0 && age >= this.config.hardMs)) {
			return { kind: "confirm", reason: "ceiling", dispatches: count, minutes: Math.round(age / 60_000) };
		}
		const dueByCount = count - this.reportedAtCount >= this.config.reportEvery;
		const dueByTime = count > this.reportedAtCount && now - this.reportedAtTime >= this.config.reportMs;
		if (dueByCount || dueByTime) {
			this.reportedAtCount = count;
			this.reportedAtTime = now;
			return { kind: "report" };
		}
		return { kind: "allow" };
	}

	record(entry: DispatchRecord): void {
		this.dispatched.push(entry);
		const key = keyOf(entry.agent, entry.label);
		this.repeats.set(key, (this.repeats.get(key) ?? 0) + 1);
	}

	/** Deterministic status of the current window, for the report and the dialog.
	 * Structured on purpose: the words belong to i18n, not to this module. */
	summary(lookup: (id: string) => TaskView | undefined): WindowSummary {
		const counts: Record<string, number> = {};
		let tokens = 0;
		const recent: WindowSummary["recent"] = [];
		for (const entry of this.dispatched) {
			const view = lookup(entry.id);
			const status = view?.status ?? "unknown";
			counts[status] = (counts[status] ?? 0) + 1;
			tokens += view?.tokens ?? 0;
			recent.push({ agent: entry.agent, label: entry.label, status, turns: view?.turns ?? 0 });
		}
		return {
			dispatches: this.dispatched.length,
			minutes: Math.max(0, Math.round((this.now() - this.windowStart) / 60_000)),
			tokens,
			counts,
			recent: recent.slice(-5),
		};
	}
}
