/**
 * btw state — the side chat's conversation, as a pure reducer.
 *
 * `/btw` is an aside: a question answered with the session's context without
 * becoming a turn of the session. The main agent never sees it, so the state
 * lives here and nowhere else, in memory: closing violeta forgets it, the same
 * way the sidebar flag and the unattended toggle are forgotten.
 *
 * Every operation returns a new state, so the extension can publish it on the
 * shared hub (the reader repaints from it as an answer streams in) without
 * anyone mutating what someone else is rendering.
 */

/** One line of the side conversation. `error` is a failed request, kept in the
 * panel instead of a notification that scrolls away. */
export type BtwRole = "user" | "assistant" | "error";

export interface BtwTurn {
	role: BtwRole;
	text: string;
}

export interface BtwState {
	turns: readonly BtwTurn[];
	/** A question is in flight: the reader says so and a second one is refused. */
	asking: boolean;
}

export function emptyBtw(): BtwState {
	return { turns: [], asking: false };
}

/** A question: the conversation grows and the reader, open or not, repaints from
 * this published state. Whether the overlay is on screen is the overlay's own
 * business (`closed` in BtwViewState) -- a flag here would be written once and
 * never read, because esc closes the reader without telling this reducer. */
export function askBtw(state: BtwState, question: string): BtwState {
	return { turns: [...state.turns, { role: "user", text: question }], asking: true };
}

export function answerBtw(state: BtwState, answer: string): BtwState {
	return { ...state, turns: [...state.turns, { role: "assistant", text: answer }], asking: false };
}

export function failBtw(state: BtwState, message: string): BtwState {
	return { ...state, turns: [...state.turns, { role: "error", text: message }], asking: false };
}

/** `/btw` means "show the side chat" with no argument and "a question" with
 * one. Whitespace is not an argument. */
export type BtwCommand = { kind: "window" } | { kind: "ask"; message: string };

export function parseBtwArgs(args: string): BtwCommand {
	const message = args.trim();
	return message === "" ? { kind: "window" } : { kind: "ask", message };
}
