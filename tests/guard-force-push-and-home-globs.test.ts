import { test } from "node:test";
import assert from "node:assert/strict";
import { guardDecision, recognizeDestructiveCommands } from "../src/guard/command-guard.ts";

test("S4: force push by +refspec is flagged", () => {
	for (const command of ["git push origin +main", "git push origin +main:main", "git push -u origin +feature", "git push origin +HEAD"]) {
		const matches = recognizeDestructiveCommands(command);
		assert.ok(matches.length > 0, `expected a match for: ${command}`);
		assert.equal(matches[0].kind, "git");
		assert.match(matches[0].reason, /force push/);
		assert.equal(guardDecision(command, true).action, "confirm", command);
		assert.equal(guardDecision(command, false).action, "block", command);
	}
});

test("S4: non-force pushes and +refspec fetches stay harmless", () => {
	for (const command of ["git push origin main", "git fetch origin +main:main"]) {
		assert.deepEqual(recognizeDestructiveCommands(command), [], command);
		assert.equal(guardDecision(command, true).action, "allow", command);
	}
});

test("S4: home-root removal globs are hard-denied without a prompt", () => {
	for (const command of ["rm -rf $HOME/*", "rm -rf ${HOME}/*", "rm -rf ~/*", "rm -rf ~/.*", "bash -c 'rm -rf $HOME/*'"]) {
		assert.equal(guardDecision(command, true).action, "deny", command);
		assert.equal(guardDecision(command, false).action, "deny", command);
	}
});
