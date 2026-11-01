/**
 * shared-hub — the cross-extension state hub (T1/S2).
 *
 * violeta-ui.ts and violeta-todo.ts are separate extension entry points and
 * may load as separate module instances, so a plain module singleton is NOT
 * shared between them. The hub therefore lives on `globalThis` under
 * `Symbol.for("violeta.shared")`, which every module instance resolves to the
 * same object. It carries only what the two extensions need to agree on: the
 * current todo list, its /todo visibility flag, whether the sidebar is active,
 * and the active mode. Pure get/set/subscribe; subscribers never throw.
 */

import type { TodoState } from "./todo/store.ts";

export interface VioletaSharedState {
	/** The current todo list, published by violeta-todo on every change. */
	todoState?: TodoState;
	/** The /todo visibility toggle (in memory), published by violeta-todo. */
	todoVisible?: boolean;
	/** Sidebar active (installed AND fullscreen AND wide enough), published by violeta-ui. */
	sidebarActive?: boolean;
	/** A confirmation dialog is waiting for the user, published by violeta-guard
	 * while a destructive-command or outside-project dialog is open (T3/S3). */
	notifyNeedsAnswer?: boolean;
	/** Unattended mode: the guard refuses instead of asking, so a run never waits
	 * for an answer nobody is there to give. Published by violeta-guard. */
	unattended?: boolean;
	/** The active mode's name, published by violeta-mode. violeta-ui shows it and
	 * violeta-agents filters its definitions by `modeAgents`. */
	activeMode?: string;
	/** Agent names the active mode exposes. `undefined` means every agent; an
	 * empty array means none, which is how `raw` removes the agent layer. */
	modeAgents?: string[];
}

export type SharedListener = (state: VioletaSharedState) => void;

interface Hub {
	state: VioletaSharedState;
	listeners: Set<SharedListener>;
}

const KEY = Symbol.for("violeta.shared");

function hub(): Hub {
	const g = globalThis as typeof globalThis & { [KEY]?: Hub };
	g[KEY] ??= { state: {}, listeners: new Set() };
	return g[KEY];
}

/** The current shared state (never undefined; starts empty). */
export function getShared(): VioletaSharedState {
	return hub().state;
}

/** Merge one patch into the shared state and notify subscribers. */
export function setShared(patch: Partial<VioletaSharedState>): void {
	const h = hub();
	h.state = { ...h.state, ...patch };
	for (const listener of [...h.listeners]) {
		try {
			listener(h.state);
		} catch {
			/* a broken subscriber must never break the writer */
		}
	}
}

/** Subscribe to every state change; returns the unsubscribe function. */
export function subscribeShared(listener: SharedListener): () => void {
	const h = hub();
	h.listeners.add(listener);
	return () => {
		h.listeners.delete(listener);
	};
}
