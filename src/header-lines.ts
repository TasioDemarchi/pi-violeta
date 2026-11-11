import { ui as t } from "./i18n.ts";

export interface HeaderStyle {
	fg: (role: string, text: string) => string;
	bold: (text: string) => string;
}

export interface HeaderData {
	name: string;
	version: string;
	mode?: string;
	unattended?: boolean;
	/** basename of the working directory */
	project?: string;
	/** null outside a git repository, exactly like the footer's branch */
	branch?: string | null;
}

/**
 * The header title: `violeta · pi <version> · <mode> · <project> · <branch>`.
 * Mode, project and branch are dropped when absent; the unattended warning
 * closes the line.
 */
export function headerTitle(data: HeaderData, style: HeaderStyle): string {
	let line = style.fg("borderAccent", "▍") + " " + style.bold(style.fg("accent", data.name));
	line += style.fg("dim", ` · pi ${data.version}`);
	if (data.mode) line += style.fg("accent", ` · ${data.mode}`);
	if (data.project) line += style.fg("text", ` · ${data.project}`);
	if (data.branch) line += style.fg("muted", ` · ${data.branch}`);
	if (data.unattended) line += style.fg("warning", ` · ${t.unattendedLabel}`);
	return line;
}

/** Title plus the faint rule that closes the header. Full width so it reads as
 * the edge of a region, not as text. */
export function headerLines(data: HeaderData, width: number, style: HeaderStyle): string[] {
	return [headerTitle(data, style), style.fg("borderMuted", "─".repeat(Math.max(1, width)))];
}
