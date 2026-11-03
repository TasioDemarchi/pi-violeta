/**
 * `contract_check`: the zero-token lint for a Jarvis contract. The shape rules
 * live in src/contract/lint.ts (pure, tested); this file only reads the file
 * and hands the model the verdict.
 *
 * It exists so a contract never reaches the critic (a model call) while it is
 * still missing an acceptance criterion or a runnable check: that is a fact a
 * program can establish for free.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatLint, lintContract } from "../src/contract/lint.ts";
import { compactRenderers } from "../src/tools-view/compact.ts";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "contract_check",
		label: "Check contract",
		description:
			"Lint a Jarvis contract file without calling any model: every spec has Accept and a runnable Check, every task cites existing specs with a test verdict and a risk flag, No-objetivos is not empty, L1 keeps the user's request, and an external system implies an S0/T0 spike. Run it on every contract draft before sending it to the critic.",
		parameters: Type.Object({
			path: Type.String({ description: "Path of the contract markdown file, relative to the project (usually tasks/<name>.md)." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const file = resolve(ctx.cwd, params.path);
			if (!existsSync(file)) {
				return {
					content: [{ type: "text" as const, text: `contract_check: file not found: ${params.path}` }],
					details: { error: "not found" },
					isError: true,
				};
			}
			const result = lintContract(readFileSync(file, "utf8"));
			return {
				content: [{ type: "text" as const, text: formatLint(result) }],
				details: { ok: result.ok, errors: result.errors.length, warnings: result.warnings.length },
				isError: !result.ok,
			};
		},
		...compactRenderers("contract_check"),
	});
}
