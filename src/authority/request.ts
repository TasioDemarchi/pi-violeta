/** From a tool call to the paths it would write.
 *
 * The one place that knows how each door puts bytes on disk: `write`/`edit`
 * carry their path as an argument, a shell tool hides it inside a command. The
 * extension must not decide this — it only wires — so the translation lives
 * here, pure and testable, and a tool that writes nothing simply yields no
 * paths and never reaches a rule. */

import { SHELL_COMMAND_TOOLS } from "../guard/command-guard.ts";
import { resolvePath, toolCallPaths } from "../guard/paths.ts";
import { bashWrites } from "./bash-writes.ts";
import { WRITE_TOOLS } from "./rules.ts";

export function writePaths(toolName: string, input: Record<string, unknown>, cwd: string, home: string): string[] {
	if (SHELL_COMMAND_TOOLS.has(toolName)) {
		const command = input?.command;
		return typeof command === "string" ? bashWrites(command, cwd, home) : [];
	}
	if (!WRITE_TOOLS.has(toolName)) return [];
	return toolCallPaths(toolName, input).map((path) => resolvePath(path, cwd, home));
}
