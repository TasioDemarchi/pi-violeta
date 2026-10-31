/**
 * thinking — how the model id and its thinking level are shown together
 * (`claude-sonnet-5-5 · medium`) in the footer and the sidebar. Each level
 * has its own theme role so the choice reads at a glance.
 */

const ROLES: Record<string, string> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
};

export type Fg = (role: string, text: string) => string;

/** The theme role for a thinking level; unknown levels read as muted. */
export function thinkingRole(level: string | undefined): string {
	return (level && ROLES[level]) || "muted";
}

/** `model · level` with the level in its own color; the model alone when
 * there is no level, and the dim placeholder when there is no model. */
export function modelWithThinking(modelId: string | undefined, level: string | undefined, fg: Fg, noModel = ""): string {
	if (!modelId) return fg("dim", noModel);
	const model = fg("text", modelId);
	return level ? `${model} ${fg("dim", "·")} ${fg(thinkingRole(level), level)}` : model;
}
