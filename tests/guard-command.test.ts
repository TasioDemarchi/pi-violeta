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
	assert.match(recognizeDestructiveCommands("rm -rf build")[0].reason, /removal/);
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
		assert.ok(withUi.action === "deny" && /removed|denied|catastrophic/i.test(withUi.reason));
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
