/**
 * frontmatter — the minimal YAML reader shared by agent and mode definitions.
 *
 * Deliberately not a YAML library: violeta's definition files are flat `key:
 * value` scalars, `key:` followed by `- item` lines, and inline `[a, b]` lists.
 * Unknown keys are ignored, which keeps every definition forward-compatible
 * without taking a dependency.
 */

export function unquote(value: string): string {
	const trimmed = value.trim();
	if ((trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

/** Minimal YAML: `key: value` scalars, `key:` followed by `- item` lines, and
 * inline `[a, b]` lists. Unknown keys are ignored; that keeps definitions
 * forward-compatible without a YAML dependency. */
export function parseFrontmatter(text: string, source: string): Map<string, string | string[]> {
	const lines = text.split("\n");
	if (lines[0]?.trim() !== "---") {
		throw new Error(`${source}: missing YAML frontmatter (the file must start with ---)`);
	}
	const data = new Map<string, string | string[]>();
	let key: string | undefined;
	let closed = false;
	let index = 1;
	for (; index < lines.length; index++) {
		const line = lines[index]!;
		if (line.trim() === "---") {
			index++;
			closed = true;
			break;
		}
		const list = line.match(/^\s*-\s+(.*)$/);
		if (list && key) {
			const existing = data.get(key);
			const items = Array.isArray(existing) ? existing : [];
			items.push(unquote(list[1]!));
			data.set(key, items);
			continue;
		}
		const entry = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!entry) continue;
		key = entry[1]!;
		const value = entry[2]!.trim();
		if (value === "") {
			data.set(key, []);
		} else if (value.startsWith("[") && value.endsWith("]")) {
			data.set(key, value.slice(1, -1).split(",").map(unquote).filter((item) => item !== ""));
		} else {
			data.set(key, unquote(value));
		}
	}
	if (!closed) {
		throw new Error(`${source}: unterminated frontmatter (no closing ---)`);
	}
	return data;
}

