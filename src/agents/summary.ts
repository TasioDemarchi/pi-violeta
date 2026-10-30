/** Title and summary extraction for subagent tasks (S9): pure text rules, no
 * engine or view logic. The runner computes the title when a task starts and
 * the summary when it settles; the views only read the stored fields. */

export const TITLE_MAX = 60;
export const SUMMARY_MAX = 200;

/** First sentence of the task text: the first non-empty line, cut at the first
 * sentence terminator (`.` `!` `?`) followed by whitespace or end of line, then
 * trimmed to `TITLE_MAX` chars. Empty when the task text is empty. */
export function fallbackTitle(task: string): string {
	const line = task.split("\n").map((l) => l.trim()).find((l) => l !== "") ?? "";
	const match = line.match(/^([\s\S]+?[.!?])(?:\s|$)/);
	let title = match ? match[1] : line;
	if (title.length > TITLE_MAX) title = title.slice(0, TITLE_MAX).trimEnd();
	return title;
}

/** The task's display title: the explicit label when present (trimmed), else
 * the first sentence of the task text. */
export function taskTitle(label: string | undefined, task: string): string {
	const clean = label?.trim();
	if (clean) return clean;
	return fallbackTitle(task);
}

function cap(text: string): string {
	return text.length > SUMMARY_MAX ? text.slice(0, SUMMARY_MAX) : text;
}

/** The summary of a finished result: the `summary:` line when present, else
 * the first non-empty line, capped at `SUMMARY_MAX` chars. */
export function extractSummary(result: string | undefined): string | undefined {
	if (!result) return undefined;
	const lines = result.split("\n").map((l) => l.trim());
	for (const line of lines) {
		const match = line.match(/^summary\s*:\s*(.+)$/i);
		if (match) return cap(match[1].trim());
	}
	const first = lines.find((l) => l !== "");
	return first ? cap(first) : undefined;
}

/** First line of an error or abort reason, capped. */
export function firstLine(text: string | undefined): string | undefined {
	const line = text?.split("\n").map((l) => l.trim()).find((l) => l !== "");
	return line ? cap(line) : undefined;
}

/** The title a view shows: the stored title, else the label, else the agent
 * name — so records saved by older versions or built without a title still
 * render instead of crashing. */
export function displayTitle(task: { title?: string; label?: string; name: string }): string {
	if (typeof task.title === "string" && task.title.trim() !== "") return task.title;
	if (typeof task.label === "string" && task.label.trim() !== "") return task.label;
	return task.name;
}
