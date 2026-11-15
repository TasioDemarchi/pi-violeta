/**
 * `contract_check`: the zero-token lint for a Jarvis contract. The shape rules
 * live in src/contract/lint.ts (pure, tested); this file only reads the file
 * and hands the model the verdict.
 *
 * It exists so a contract never reaches the critic (a model call) while it is
 * still missing an acceptance criterion or a runnable check: that is a fact a
 * program can establish for free.
 *
 * A contract that passes the lint is also the moment the session ADOPTS it
 * (S8, estado-de-tareas): the path goes on the branch as a custom entry, so the
 * Todo panel, the writer of `estado:` rows and the verifier read that contract
 * for the rest of the session — including after `/compact` and `/resume` — with
 * the model naming it exactly once. A contract that fails the lint adopts
 * nothing: the session keeps whatever it had.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ACTIVE_CONTRACT_ENTRY_TYPE, activeContractSnapshot } from "../src/contract/active.ts";
import { CONTRACT_APPROVAL_ENTRY_TYPE, approvalFrom, approvalSnapshot, frozenChanges, frozenView } from "../src/contract/approval.ts";
import { contract as tc, guard as tg } from "../src/i18n.ts";
import { setShared, getShared } from "../src/shared-hub.ts";
import { activeContractFrom } from "../src/contract/active.ts";
import { CLOSE_GATE_ENTRY_TYPE, alreadyNudged, closeGate } from "../src/contract/close-gate.ts";
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
			// S8: a contract that passes is this session's contract from now on.
			if (result.ok) pi.appendEntry(ACTIVE_CONTRACT_ENTRY_TYPE, activeContractSnapshot(params.path.trim()));
			return {
				content: [{ type: "text" as const, text: formatLint(result) }],
				details: { ok: result.ok, errors: result.errors.length, warnings: result.warnings.length },
				isError: !result.ok,
			};
		},
		...compactRenderers("contract_check"),
	});

	/** Approval 1 as a fact the harness records (contrato-aprobado). The owner
	 * answers in a dialog, so the model cannot approve for them; the snapshot is
	 * what `jarvis.contract-frozen` compares every later write against. */
	const MAX_DIFF_LINES = 20;
	pi.registerTool({
		name: "contract_approve",
		label: "Approve contract",
		description: tc.approveDescription,
		parameters: Type.Object({
			path: Type.String({ description: "Path of the contract markdown file, relative to the project (usually tasks/<name>.md)." }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const path = params.path.trim();
			const file = resolve(ctx.cwd, path);
			const fail = (text: string) => ({ content: [{ type: "text" as const, text }], details: { approved: false }, isError: true });
			if (!existsSync(file)) return fail(`contract_approve: file not found: ${path}`);
			const text = readFileSync(file, "utf8");
			const lint = lintContract(text);
			if (!lint.ok) return fail(formatLint(lint));

			const previous = approvalFrom(ctx.sessionManager, path);
			if (previous !== undefined && previous === frozenView(text)) {
				return { content: [{ type: "text" as const, text: tc.approveUnchanged(path) }], details: { approved: true } };
			}
			if (!ctx.hasUI || getShared().unattended) return fail(tc.approveNoUser(path));

			let body = tc.approveFirst(path);
			if (previous !== undefined) {
				const { removed, added } = frozenChanges(previous, text);
				const shown = [...removed, ...added].length;
				const keepRemoved = removed.slice(0, MAX_DIFF_LINES);
				const keepAdded = added.slice(0, Math.max(0, MAX_DIFF_LINES - keepRemoved.length));
				const more = shown - keepRemoved.length - keepAdded.length;
				const diff = [...keepRemoved.map((l) => `- ${l}`), ...keepAdded.map((l) => `+ ${l}`), ...(more > 0 ? [tc.approveMoreLines(more)] : [])];
				body = tc.approveChange(path, diff.join("\n"));
			}
			setShared({ notifyNeedsAnswer: true });
			let yes: boolean;
			try {
				yes = (await ctx.ui.select(`${tc.approveTitle}\n${body}`, [tg.yes, tg.no])) === tg.yes;
			} finally {
				setShared({ notifyNeedsAnswer: false });
			}
			if (!yes) return { content: [{ type: "text" as const, text: tc.approveDeclined(path) }], details: { approved: false } };
			pi.appendEntry(ACTIVE_CONTRACT_ENTRY_TYPE, activeContractSnapshot(path));
			pi.appendEntry(CONTRACT_APPROVAL_ENTRY_TYPE, approvalSnapshot(path, text));
			return { content: [{ type: "text" as const, text: tc.approved(path) }], details: { approved: true } };
		},
		...compactRenderers("contract_approve"),
	});

	/** jarvis.close-needs-tester (src/contract/close-gate.ts): at the moment the
	 * session is about to settle, a finished contract with a risky task and no
	 * tester after the last builder gets ONE more model request with the
	 * reason. If it settles again owing the same tester, the owner is warned
	 * instead: a gate that loops would cost more than the close it guards. */
	pi.on("agent_before_settle", async (event, ctx) => {
		if (process.env.VIOLETA_AGENTS_CHILD === "1") return undefined;
		if (event.outcome !== "completed" || event.context?.canContinue === false) return undefined;
		const branch = (ctx.sessionManager as { getBranch?: () => unknown[] } | undefined)?.getBranch?.() ?? [];
		let text: string;
		try {
			text = readFileSync(resolve(ctx.cwd, activeContractFrom(ctx.sessionManager)), "utf8");
		} catch {
			return undefined;
		}
		const verdict = closeGate(text, branch);
		if (!verdict) return undefined;
		const tasks = verdict.risky.map((id) => `T${id}`).join(", ");
		if (alreadyNudged(branch, verdict.key)) {
			if (ctx.hasUI) ctx.ui.notify(tc.closeWarnOwner(tasks), "warning");
			return undefined;
		}
		return {
			entries: [
				{ type: "custom" as const, customType: CLOSE_GATE_ENTRY_TYPE, data: { key: verdict.key } },
				{ type: "custom_message" as const, customType: CLOSE_GATE_ENTRY_TYPE, content: tc.closeNeedsTester(tasks), display: true },
			],
			continue: true,
		};
	});
}
