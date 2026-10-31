/**
 * models-view — the quick model selector (T3/S4), pure state and rendering:
 * filtering to models whose provider has auth, marking the current model, a
 * small key reducer, and the overlay line builder. No Pi API here — the
 * extension wires the registry, `pi.setModel`, a theme-like `fg` function
 * and the terminal size.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fmtTokens } from "../format.ts";
import { models as t } from "../i18n.ts";

export type ViewFg = (role: string, text: string) => string;

export interface ModelCandidate {
	provider: string;
	id: string;
	/** Context window in tokens. */
	contextWindow: number;
	/** Whether the provider has usable credentials; rows without it are filtered out. */
	authAvailable: boolean;
}

export interface ModelRow {
	provider: string;
	id: string;
	contextWindow: number;
	/** The session's current model. */
	current: boolean;
}

/** Only models with auth available, in registry order, with the current one marked. */
export function modelRows(
	candidates: readonly ModelCandidate[],
	currentProvider?: string,
	currentId?: string,
): ModelRow[] {
	return candidates
		.filter((candidate) => candidate.authAvailable)
		.map((candidate) => ({
			provider: candidate.provider,
			id: candidate.id,
			contextWindow: candidate.contextWindow,
			current: candidate.provider === currentProvider && candidate.id === currentId,
		}));
}

// --- State ---------------------------------------------------------------------

export interface ModelsState {
	index: number;
	/** Set by `select`, undefined until then. */
	chosen: number | undefined;
	closed: boolean;
}

export type ModelsAction = "up" | "down" | "select" | "close";

export function initialModelsState(count: number): ModelsState {
	return { index: Math.max(0, Math.min(0, count - 1)), chosen: undefined, closed: false };
}

/** Pure key handling: the selection clamps at the list ends, select records
 * the chosen row and closes, close closes without choosing. */
export function reduceModels(state: ModelsState, action: ModelsAction, count: number): ModelsState {
	switch (action) {
		case "up":
			return { ...state, index: Math.max(0, state.index - 1) };
		case "down":
			return { ...state, index: Math.min(Math.max(0, count - 1), state.index + 1) };
		case "select":
			return { ...state, chosen: count > 0 ? state.index : undefined, closed: true };
		case "close":
			return { ...state, closed: true };
		default:
			return state;
	}
}

// --- Render ---------------------------------------------------------------------

/** One row: `› ● provider/id  ctx-window` — `›` marks the selection, `●` the
 * current model; the window is right-aligned dim. */
export function renderModelsOverlay(rows: readonly ModelRow[], state: ModelsState, width: number, fg: ViewFg): string[] {
	const lines: string[] = [fg("accent", t.title)];
	if (rows.length === 0) {
		lines.push(fg("dim", t.empty));
	} else {
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const selected = i === state.index;
			const marker = (selected ? fg("accent", "›") : " ") + (row.current ? fg("success", "●") : " ");
			const label = `${row.provider}/${row.id}`;
			const window = fg("dim", fmtTokens(row.contextWindow));
			const gap = Math.max(1, width - visibleWidth(label) - visibleWidth(window) - 4);
			const text = selected ? fg("text", label) : fg("muted", label);
			lines.push(truncateToWidth(`${marker} ${text}${" ".repeat(gap)}${window}`, width));
		}
	}
	lines.push(fg("dim", t.hint));
	return lines;
}
