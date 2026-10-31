/**
 * context-warning — the pure threshold + hysteresis logic behind the
 * `ctx N%` indicator and the /compact suggestion (T3/S5).
 *
 * - Color thresholds: <70% normal (muted), >=70% warning, >=90% error.
 * - Once per crossing of 80% a notification suggests /compact; it re-arms
 *   when usage drops below 60% (after a compaction). Unknown usage never
 *   fires and never disturbs the armed state.
 */

export type ContextRole = "muted" | "warning" | "error";

export const WARNING_AT = 70;
export const ERROR_AT = 90;
export const COMPACT_AT = 80;
export const REARM_BELOW = 60;

/** The theme role for the `ctx N%` indicator at this usage percent. */
export function contextRole(percent: number | null | undefined): ContextRole {
	if (percent == null) return "muted";
	if (percent >= ERROR_AT) return "error";
	if (percent >= WARNING_AT) return "warning";
	return "muted";
}

export interface CompactWarner {
	/** Feed one usage reading; returns true exactly once per crossing of 80%.
	 * Re-arms when a later reading drops below 60%. */
	check(percent: number | null | undefined): boolean;
	/** Whether a crossing of 80% would currently fire. */
	armed(): boolean;
}

/** One warner per session (the footer and the sidebar share the instance). */
export function createCompactWarner(): CompactWarner {
	let armed = true;
	return {
		check(percent) {
			if (percent == null) return false;
			if (percent < REARM_BELOW) {
				armed = true;
				return false;
			}
			if (percent >= COMPACT_AT && armed) {
				armed = false;
				return true;
			}
			return false;
		},
		armed() {
			return armed;
		},
	};
}
