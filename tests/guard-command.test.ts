import { test } from "node:test";
import assert from "node:assert/strict";
import { SHELL_COMMAND_TOOLS, guardDecision, recognizeDestructiveCommands } from "../src/guard/command-guard.ts";

/** [command, expected kind, expected hardDeny] */
const FLAGGED: Array<[string, string, boolean?]> = [
	// filesystem: recursive or forced removal
	["rm -rf build", "filesystem"],
	["rm -r node_modules", "filesystem"],
	["rm --recursive build", "filesystem"],
	["rm -f important.env", "filesystem"],
	["rm -fr scratch", "filesystem"],
	// wrappers are looked through
	["sudo rm -rf /opt/app", "filesystem"],
	["nohup rm -rf build", "filesystem"],
	["command rm -rf build", "filesystem"],
	["exec rm -rf build", "filesystem"],
	["env rm -rf build", "filesystem"],
	["timeout 10 rm -rf build", "filesystem"],
	["xargs rm -rf", "filesystem"],
	// other filesystem families
	["find . -name '*.log' -delete", "filesystem"],
	["shred -u secret.txt", "filesystem"],
	["dd if=backup.img of=/dev/sda", "filesystem"],
	["mkfs /dev/sdb1", "filesystem"],
	["mkfs.ext4 /dev/sdb1", "filesystem"],
	["chmod -R 777 /", "filesystem"],
	["chown -R root /var", "filesystem"],
	// git
	["git push --force origin main", "git"],
	["git push -f", "git"],
	["git push --force-with-lease origin main", "git"],
	["git reset --hard HEAD~1", "git"],
	["git clean -f", "git"],
	["git clean -fdx", "git"],
	["git checkout -- .", "git"],
	["git checkout .", "git"],
	["git restore .", "git"],
	["git branch -D feature", "git"],
	["git stash drop", "git"],
	["git stash clear", "git"],
	// database
	['psql -c "DROP TABLE users"', "database"],
	['mysql -e "TRUNCATE users"', "database"],
	["sqlite3 app.db 'DROP DATABASE app'", "database"],
	['sqlite3 app.db "DELETE FROM users"', "database"],
	// separators start new segments
	["echo hi && rm -rf build", "filesystem"],
	["ls; git push -f", "git"],
	["cat x | sudo rm -rf /opt/y", "filesystem"],
	["echo one\nrm -rf build", "filesystem"],
	// wrappers around git and nesting
	["sudo git push -f", "git"],
	["sh -c 'rm -rf build'", "filesystem"],
	["bash -c 'git push -f'", "git"],
	["eval 'rm -rf build'", "filesystem"],
	// catastrophic targets hard-deny (with or without wrappers)
	["rm -rf /", "filesystem", true],
	["rm -rf /*", "filesystem", true],
	["rm -rf ~", "filesystem", true],
	["rm -rf ~/.", "filesystem", true],
	["rm -rf $HOME", "filesystem", true],
	["sudo rm -rf /", "filesystem", true],
];

/** Commands that only look destructive and must never be flagged. */
const NOT_FLAGGED = [
	'echo "rm -rf /"',
	'grep "rm -rf" file.txt',
	'grep -r "git push --force" .',
	"cat << EOF\nrm -rf /\nEOF",
	"git commit -m 'DROP TABLE users'",
	"git push origin main",
	"rm file.txt",
	'sqlite3 app.db "DELETE FROM users WHERE id=1"',
	"git reset HEAD~1",
	"git rebase main",
	"git checkout main",
	"git checkout -b feature",
	"git branch -d merged",
	"git branch --delete merged",
	"git stash list",
	"git stash pop",
	"echo hello > file.txt",
	"find . -name '*.ts'",
	"ls; echo done",
	"dd if=data of=disk.img",
	"chmod -R 755 build",
	"git log --oneline -5",
	"npm test",
];

test("every recognizable destructive form is flagged with the right family", () => {
	for (const [command, kind, hardDeny = false] of FLAGGED) {
		const matches = recognizeDestructiveCommands(command);
		assert.ok(matches.length > 0, `expected a match for: ${command}`);
		assert.equal(matches[0].kind, kind, `kind for: ${command}`);
		assert.equal(matches[0].hardDeny, hardDeny, `hardDeny for: ${command}`);
		assert.ok(matches[0].reason.length > 0, `a reason is reported for: ${command}`);
	}
});

test("look-alikes are not flagged: prose, quoted strings, heredoc data and safe forms", () => {
	for (const command of NOT_FLAGGED) {
		assert.deepEqual(recognizeDestructiveCommands(command), [], `must not flag: ${command}`);
	}
});

test("each match names its family in the reason", () => {
	assert.match(recognizeDestructiveCommands("rm -rf build")[0].reason, /borrado recursivo/);
	assert.match(recognizeDestructiveCommands("git push -f")[0].reason, /push/);
	assert.match(recognizeDestructiveCommands('psql -c "DROP TABLE users"')[0].reason, /DROP/);
});

test("guardDecision allows harmless commands", () => {
	assert.deepEqual(guardDecision("ls -la", true), { action: "allow" });
	assert.deepEqual(guardDecision("echo hi", false), { action: "allow" });
});

test("guardDecision asks when it can and blocks without a UI", () => {
	const ask = guardDecision("rm -rf build", true);
	assert.equal(ask.action, "confirm");
	assert.ok(ask.action === "confirm" && ask.reasons.length > 0);
	const quiet = guardDecision("rm -rf build", false);
	assert.equal(quiet.action, "block");
	assert.ok(quiet.action === "block" && quiet.reasons.length > 0);
});

test("guardDecision hard-denies catastrophic targets with no prompt", () => {
	for (const command of ["rm -rf /", "sudo rm -rf /*", "rm -rf ~"]) {
		const withUi = guardDecision(command, true);
		assert.equal(withUi.action, "deny", command);
		const withoutUi = guardDecision(command, false);
		assert.equal(withoutUi.action, "deny", command);
		assert.ok(withUi.action === "deny" && /denegado|catastrófico/i.test(withUi.reason));
	}
});

test("background job and monitor commands go through the same guard decision as bash", () => {
	// The extension intercepts every tool in SHELL_COMMAND_TOOLS with the exact
	// same branch: destructive forms confirm/block, catastrophic targets deny.
	assert.deepEqual([...SHELL_COMMAND_TOOLS].sort(), ["bash", "bash_background", "monitor"]);
	for (const tool of SHELL_COMMAND_TOOLS) {
		assert.equal(guardDecision("rm -rf build", false).action, "block", `${tool}: destructive without UI blocks`);
		assert.equal(guardDecision("rm -rf /", true).action, "deny", `${tool}: catastrophic target denies`);
		assert.deepEqual(guardDecision("echo hi", true), { action: "allow" }, `${tool}: harmless command allows`);
	}
});

// --- Killing processes (the incident of 2026-11-05) -------------------------
//
// The owner's whole graphical session died at 20:54:20: compositor, editor,
// both terminals and the agent itself. The agent had written
//
//   H=$(ps -eo pid,ppid --ppid "$D" --no-headers | awk '{print $1}')
//   kill -9 $H 2>/dev/null
//
// and `ps -e` ignores the `--ppid` filter, so `$H` held every pid on the
// machine. The guard allowed it without a word: it had no rule for kill at all.

test("a kill whose target the harness cannot count asks first", () => {
	// The exact command, as the session file recorded it.
	assert.equal(guardDecision("kill -9 $H 2>/dev/null", true).action, "confirm");
	assert.equal(guardDecision("kill -9 $(pgrep -f daemon)", true).action, "confirm");
	assert.equal(guardDecision("kill `cat pidfile`", true).action, "confirm");
	// And the two-line form it was really written as.
	const real = 'D=$(pgrep -f "daemon[.]ts" | head -1)\nH=$(ps -eo pid,ppid --ppid "$D" --no-headers)\nkill -9 $H 2>/dev/null';
	const decision = guardDecision(real, true);
	assert.equal(decision.action, "confirm");
	assert.ok(decision.reasons!.some((r) => /PID literal/i.test(r)), decision.reasons!.join("; "));
});

test("a literal pid still passes, so routine work is not a dialog every time", () => {
	assert.deepEqual(guardDecision("kill -9 61232", true), { action: "allow" });
	assert.deepEqual(guardDecision("kill 1234", true), { action: "allow" });
	assert.deepEqual(guardDecision("kill -s KILL 1234", true), { action: "allow" });
	assert.deepEqual(guardDecision("kill -TERM 4321", true), { action: "allow" });
});

test("a whole process group is denied outright, never merely asked", () => {
	// `kill -9 -1` is "every process I am allowed to signal". There is no
	// version of it that belongs in a coding session, so it does not get a
	// dialog that a tired owner can wave through.
	for (const command of ["kill -9 -1", "kill -1 -9", "kill -9 0", "kill -9 1", "kill -TERM -2345"]) {
		assert.equal(guardDecision(command, true).action, "deny", command);
	}
});

test("pkill and killall always ask: their blast radius is whatever the pattern matches", () => {
	// The same session killed its own shell twice with `pkill -f` before this.
	assert.equal(guardDecision("pkill -9 -f node", true).action, "confirm");
	assert.equal(guardDecision("killall -9 node", true).action, "confirm");
	assert.equal(guardDecision("pkill -f 'daemon.ts'", true).action, "confirm");
	// With no pattern at all there is nothing to kill.
	assert.deepEqual(guardDecision("pkill --help", true), { action: "allow" });
});

test("the kill rule survives the forms that bypass a naive check", () => {
	assert.equal(guardDecision("sudo kill -9 $H", true).action, "confirm");
	assert.equal(guardDecision("bash -c 'kill -9 -1'", true).action, "deny");
	assert.equal(guardDecision("ls && kill -9 $PIDS", true).action, "confirm");
	// Prose and data are still not commands.
	assert.deepEqual(guardDecision("echo 'kill -9 -1 is what killed it'", true), { action: "allow" });
	assert.deepEqual(guardDecision("grep -rn 'kill -9' logs/", true), { action: "allow" });
});
