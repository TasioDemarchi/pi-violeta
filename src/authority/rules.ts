/** The shapes every harness-enforced rule is written against.
 *
 * A rule is data plus one pure predicate: given what is about to happen, it
 * either names the path it refuses or says nothing. It never formats a message
 * and never reads a file — the extension does both, so the same rule can be
 * tested without a terminal, a model or a disk (AGENTS.md: pure logic lives in
 * `src/`, extensions only wire it).
 *
 * The id is the contract with the owner: it travels in the block message and is
 * the string to look up in `~/dev/pi-violeta-estatuto.md`, where the criterion
 * behind the rule is written. A rule whose id is not in `RuleId` cannot ship,
 * which is the point: the set of things the harness enforces is enumerable. */

/** Every rule this harness can enforce. Adding one is a deliberate edit here. */
export type RuleId =
	| "jarvis.write-lock"
	| "jarvis.tests-readonly"
	| "jarvis.bash-write"
	| "agent.read-only"
	| "agent.scratch-only"
	| "critic.contract-only"
	| "agent.no-secrets"
	| "agent.no-delivery";

/** Who is asking. A subagent runs with `VIOLETA_AGENTS_CHILD=1`; everything
 * else is the session the owner is talking to. Rules bind callers explicitly,
 * because a future rule may bind the ones these two do not. */
export type Caller = "session" | "subagent";

/** The tools that put bytes on disk. `bash` is deliberately absent: a shell
 * that writes is a different surface, with its own guard, and this contract
 * does not cover it. */
export const WRITE_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

export interface AuthorityRequest {
	/** The tool name as the runtime reports it. */
	tool: string;
	caller: Caller;
	/** Absolute, already-resolved paths the call would write. */
	paths: readonly string[];
	/** Absolute paths the call would READ. Only the rules that scope reading
	 * look at it, so it is optional: absent reads as "nothing to scope". */
	reads?: readonly string[];
	/** Every path the call MENTIONS, read or written, including the ones a shell
	 * command names. A deny-list does not care which it is: a secret is a secret
	 * whether it is opened or overwritten. */
	touches?: readonly string[];
	/** The shell command itself, for the rules that judge its shape rather than
	 * its paths. Absent for everything that is not a shell tool. */
	command?: string;
	/** Absolute project root. */
	root: string;
	/** Absolute scratch directory the harness owns and the model may use. */
	scratch: string;
	/** Which agent is asking, when `caller` is a subagent: the name the runner
	 * put in `VIOLETA_AGENT_NAME`. Absent means nobody said, and a rule bound to
	 * a list of agents simply does not apply — never "applies to all". */
	agent?: string;
	/** The active contract, when the session has one: absolute path and the raw
	 * text. Absent is a normal state, not an error. */
	contract?: { path: string; text: string };
}

/** What a block carries: which rule refused, and the path it refused. */
export interface Block {
	rule: RuleId;
	path: string;
}

export type Decision = { allowed: true } | ({ allowed: false } & Block);

export interface Rule {
	id: RuleId;
	/** The path this rule refuses, or `undefined` to let the request through.
	 * Must be total: any request, including a malformed contract, gets an
	 * answer instead of an exception. */
	check(request: AuthorityRequest): string | undefined;
}

/** The project-relative scratch space the prose already names (`builder.md`,
 * `tester.md`): the one place inside the repo a rule never refuses. */
export const PROJECT_SCRATCH = ".violeta/scratch";
