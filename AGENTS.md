# Working in this repo

violeta is a personal Pi harness. One owner, no users, no backend, no releases.
The owner is an engineer who judges outcomes, time, cost and risk — not code.
Optimise for that, not for looking thorough.

## Read first

`CONTINUAR.md` is the handoff: current state, what is half-built, the traps that
already cost hours, and the prompt to paste. Read it before proposing anything.

## The one architectural rule

**The engine is neutral; a philosophy is data.** A mode is a markdown file in
`modes/` whose frontmatter picks the model, the thinking level and the agent
roster, and whose body is appended to the system prompt. Nothing about a
philosophy belongs in TypeScript. When something must always hold, it is enforced
by the harness (ceilings, guard, dispatch breaker), never by prose alone.

## Commands

```bash
npm test                                  # every test, the whole suite
node --test tests/guard-paths.test.ts     # one file
node --test --test-name-pattern='redirect' tests/guard-paths.test.ts
./install.sh                              # install/refresh, then runs the suite
```

## Conventions

- **Reply to the owner in Spanish.** Files in the repo are in English, because
  they tokenise better.
- **Test-first for real behaviour.** A test that can never fail is not a test.
  If an existing test goes red, stop and report — never weaken it to get green.
- **Pure logic lives in `src/`, extensions only wire it.** Everything in `src/`
  is testable without a terminal or a model.
- **Never claim a command passed without running it.** Copy the real output.
- **Commit at the end of each finished piece**, in Spanish or English but with a
  message that says *why*, not just what.
- Do not add a dependency for something stdlib does.

## Traps that are already fixed — do not reintroduce them

- Guard tests must `delete process.env.VIOLETA_AGENTS_CHILD`. A subagent exports
  it, and the guard then answers "no UI" to every dialog: seven tests fail for a
  reason unrelated to the code.
- `config/models.json` resolves the NaN key with `jq` at request time. `jq` is a
  hard dependency, not a nicety.
- The API key normally lives in `~/.gentle-shell/agent/auth.json`; violeta reads
  either that or its own `~/.violeta/agent/auth.json`.
- `bashPathTargets` treats a slash-delimited token as a path, so
  `sed -n '/foo/,+2p'` is mistaken for `/foo`. Use `grep -A` when scripting.
