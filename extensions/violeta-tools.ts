/**
 * violeta-tools — compact one-line tool rendering (T2/S2).
 *
 * Re-registers Pi's built-in tools (read, bash, edit, write, grep, find, ls)
 * with the SAME execute behavior — each definition comes from Pi's own
 * factory and only renderCall/renderResult are overridden — so every tool
 * call and result in the transcript collapses to ONE line:
 *
 *   ◐ read README.md          (running glyph while in flight)
 *   ✓ bash npm test · 0 · 1.2s
 *   ✗ bash ls /x · exit 2 · ls: cannot access '/x': …
 *   ✓ edit src/a.ts +3 −1
 *
 * The full call/result comes back with Pi's existing tool-output expansion
 * toggle (app.tools.expand, ctrl+o); errors always show their first error
 * line even collapsed. Renderers are display-only: the model receives
 * byte-identical results (execute is the original function; asserted in
 * tests/tools-view.test.ts), and the violeta-guard's tool_call interception
 * is unaffected (tool_call fires per call, regardless of which registration
 * executes; pty-verified).
 *
 * Subagent children (VIOLETA_AGENTS_CHILD=1) have no UI and skip this.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { withCompactRenderer } from "../src/tools-view/compact.ts";

export default function (pi: ExtensionAPI) {
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	const cwd = process.cwd();

	pi.registerTool(withCompactRenderer("read", createReadToolDefinition(cwd)));
	pi.registerTool(withCompactRenderer("bash", createBashToolDefinition(cwd)));
	pi.registerTool(withCompactRenderer("edit", createEditToolDefinition(cwd)));
	pi.registerTool(withCompactRenderer("write", createWriteToolDefinition(cwd)));
	pi.registerTool(withCompactRenderer("grep", createGrepToolDefinition(cwd)));
	pi.registerTool(withCompactRenderer("find", createFindToolDefinition(cwd)));
	pi.registerTool(withCompactRenderer("ls", createLsToolDefinition(cwd)));
}
