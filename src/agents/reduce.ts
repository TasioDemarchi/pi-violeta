/** Event-to-store reduction: map one JSONL record from a child `pi --mode rpc`
 * into the task's thread and usage counters. Pure and synchronous: it mutates
 * only the given task and its thread. The runner decides what settlement means. */

import { type AgentStore, type AgentTask, type ThreadItem, type ThreadKind, type ThreadToolStatus } from "./store.ts";

export interface RpcRecord {
	type: string;
	[key: string]: unknown;
}

export interface ReduceResult {
	/** True when the record proves the child is alive (renews the watchdog). */
	activity: boolean;
	/** True on `agent_settled` (completion of the whole run). */
	settled: boolean;
	/** On `agent_settled`: whether the run ended because it was aborted. */
	aborted: boolean;
}

export interface Reducer {
	apply(record: RpcRecord): ReduceResult;
	/** Number of tool calls announced but not finished (watchdog exemption). */
	inFlightCount(): number;
}

interface UsageShape {
	input?: unknown;
	output?: unknown;
	cost?: { total?: unknown } | null;
}

const TOOL_TEXT_MAX = 500;

function asNumber(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function assistantText(message: { content?: unknown }): string {
	if (!Array.isArray(message.content)) return "";
	const parts: string[] = [];
	for (const block of message.content) {
		if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string" && text) parts.push(text);
		}
	}
	return parts.join("\n").trim();
}

/** Short text for a tool item: the command, path or a compact argument
 * summary, kept well below the thread item text cap. */
function toolSummary(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const record = args as Record<string, unknown>;
	for (const key of ["command", "path", "file_path", "pattern", "query"]) {
		const value = record[key];
		if (typeof value === "string" && value) return value.length > TOOL_TEXT_MAX ? value.slice(0, TOOL_TEXT_MAX) : value;
	}
	return "";
}

function resultSummary(result: unknown): string {
	const content = (result as { content?: unknown } | undefined)?.content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && (block as { type?: unknown }).type === "text") {
			const text = (block as { text?: unknown }).text;
			if (typeof text === "string") parts.push(text);
		}
	}
	return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, TOOL_TEXT_MAX);
}

/** Create a reducer wired to the store: deltas append to thread items, tool
 * calls create bounded tool items, assistant usage accumulates. */
export function createReducer(store: AgentStore, task: AgentTask): Reducer {
	const inFlight = new Map<string, number>(); // toolCallId -> thread index
	const append = (kind: ThreadKind, delta: string) => store.appendThreadText(task.id, kind, delta);
	const toolStart = (callId: string, item: ThreadItem) => {
		const before = task.thread.length;
		store.pushThreadItem(task.id, item);
		if (task.thread.length > before) inFlight.set(callId, task.thread.length - 1);
	};
	const toolEnd = (callId: string, status: ThreadToolStatus, summary: string) => {
		const index = inFlight.get(callId);
		if (index === undefined) return;
		inFlight.delete(callId);
		store.updateThreadItem(task.id, index, {
			toolStatus: status,
			text: summary ? `${task.thread[index]?.text ?? ""} → ${summary}` : undefined,
		});
	};
	return {
		apply(record: RpcRecord): ReduceResult {
			const result: ReduceResult = { activity: true, settled: false, aborted: false };
			if (!record || typeof record.type !== "string") return result;

			if (record.type === "message_update") {
				const event = record.assistantMessageEvent as { type?: unknown; delta?: unknown } | undefined;
				if (!event || typeof event.type !== "string") return result;
				const delta = typeof event.delta === "string" ? event.delta : "";
				if (event.type === "thinking_delta" && delta) append("thinking", delta);
				else if (event.type === "text_delta" && delta) append("text", delta);
				return result;
			}

			if (record.type === "message_end") {
				const message = record.message as { role?: unknown; content?: unknown; usage?: UsageShape } | undefined;
				if (!message || message.role !== "assistant") return result;
				const usage = message.usage;
				if (usage) {
					task.tokens += asNumber(usage.input) + asNumber(usage.output);
					task.cost += asNumber(usage.cost?.total);
				}
				const text = assistantText(message);
				if (text) task.result = text;
				store.update(task.id, {});
				return result;
			}

			if (record.type === "tool_execution_start") {
				const toolName = typeof record.toolName === "string" ? record.toolName : "tool";
				toolStart(String(record.toolCallId ?? ""), {
					kind: "tool",
					text: toolSummary(record.args),
					toolName,
					toolStatus: "running",
				});
				return result;
			}

			if (record.type === "tool_execution_end") {
				toolEnd(String(record.toolCallId ?? ""), record.isError === true ? "error" : "done", resultSummary(record.result));
				return result;
			}

			if (record.type === "agent_settled") {
				result.settled = true;
				result.aborted = record.aborted === true;
			}
			return result;
		},
		inFlightCount: () => inFlight.size,
	};
}
