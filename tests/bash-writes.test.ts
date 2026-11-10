// S2 (authority-bash): what a shell command writes, and nothing else.
//
// The cost of a false negative is that one write slips through; the cost of a
// false positive is that the owner cannot work. So this is a whitelist of
// shapes that write, never a blacklist of shapes that do not (D2): an unknown
// command writes nothing as far as this module is concerned.
//
// It answers paths, not permission: `> /tmp/out` is a write, and whether that
// matters is the rule's question, not this one's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bashWrites } from "../src/authority/bash-writes.ts";

const CWD = "/home/u/proj";
const HOME = "/home/u";
const writes = (command: string) => bashWrites(command, CWD, HOME);
const one = (command: string) => writes(command)[0];

test("plain redirection is a write", () => {
	assert.deepEqual(writes("echo hola > src/x.ts"), [`${CWD}/src/x.ts`]);
});

test("append is a write", () => {
	assert.deepEqual(writes("echo hola >> src/x.ts"), [`${CWD}/src/x.ts`]);
});

test("a redirection glued to its target is a write", () => {
	assert.deepEqual(writes("echo hola >src/x.ts"), [`${CWD}/src/x.ts`]);
});

test("a heredoc into a file is a write, and its body is data", () => {
	const command = "cat > src/x.ts <<'EOF'\nesto > no es una redirección\nEOF";
	assert.deepEqual(writes(command), [`${CWD}/src/x.ts`]);
});

test("`sed -i` is a write, with or without a suffix", () => {
	assert.equal(one("sed -i 's/a/b/' src/x.ts"), `${CWD}/src/x.ts`);
	assert.equal(one("sed -i.bak -e 's/a/b/' src/x.ts"), `${CWD}/src/x.ts`);
});

test("`perl -i` is a write", () => {
	assert.equal(one("perl -i -pe 's/a/b/' src/x.ts"), `${CWD}/src/x.ts`);
});

test("a wrapper does not hide the command", () => {
	assert.equal(one("sudo sed -i 's/a/b/' src/x.ts"), `${CWD}/src/x.ts`);
});

test("copy, move and link write their destination", () => {
	assert.equal(one("cp /tmp/a src/x.ts"), `${CWD}/src/x.ts`);
	assert.equal(one("mv viejo.ts src/x.ts"), `${CWD}/src/x.ts`);
	assert.equal(one("ln -s /tmp/a src/x.ts"), `${CWD}/src/x.ts`);
});

test("touch, truncate and tee write their operands", () => {
	assert.equal(one("touch src/x.ts"), `${CWD}/src/x.ts`);
	assert.equal(one("truncate -s 0 src/x.ts"), `${CWD}/src/x.ts`);
	assert.equal(one("cat a | tee src/x.ts"), `${CWD}/src/x.ts`);
});

test("`dd` writes its `of=`", () => {
	assert.equal(one("dd if=/dev/zero of=src/x.ts bs=1"), `${CWD}/src/x.ts`);
});

test("`patch` writes files it alone knows, so it counts as writing the project", () => {
	assert.deepEqual(writes("patch -p1 < /tmp/fix.diff"), [CWD]);
});

test("a path outside the project is still a write: whose it is, is the rule's question", () => {
	assert.deepEqual(writes("cat src/a.ts > /tmp/out"), ["/tmp/out"]);
});

test("`2>&1` is not a write", () => {
	assert.deepEqual(writes("npm test 2>&1 | tail -9"), []);
});

// Encontrado por la prueba por prompt: un `scout` fue frenado por
// `agent.read-only` al correr `cat -A archivo 2>/dev/null`. Frenó por el
// motivo equivocado. Escribir a /dev/null no escribe nada, y tratarlo como
// escritura haría insoportable al único agente que sólo mira.
test("los sumideros del sistema no son escrituras", () => {
	for (const command of [
		"cat src/x.ts 2>/dev/null",
		"ls faltante 2> /dev/null",
		"comando >/dev/null 2>&1",
		"ruidoso > /dev/stdout",
		"ruidoso 2> /dev/stderr",
	]) {
		assert.deepEqual(writes(command), [], command);
	}
});

test("un archivo que apenas se parece a un sumidero sí es una escritura", () => {
	assert.deepEqual(writes("echo x > /dev/null.bak"), ["/dev/null.bak"]);
	assert.deepEqual(writes("echo x > devnull"), [`${CWD}/devnull`]);
});

test("the commands the orchestrator must keep running write nothing", () => {
	for (const command of [
		"git status --short",
		"git diff HEAD~1",
		"npm test",
		"node --test tests/x.test.ts",
		"grep -rn 'algo' src/",
		"cat src/x.ts",
		"ls -la src",
		"sed 's/a/b/' src/x.ts",
		"rm -rf build",
	]) {
		assert.deepEqual(writes(command), [], command);
	}
});

test("a `>` inside quotes is text, not a redirection", () => {
	assert.deepEqual(writes("grep -rn 'a > b' src/"), []);
	assert.deepEqual(writes('echo "a > b"'), []);
});

test("several segments each contribute their own writes", () => {
	assert.deepEqual(writes("echo a > src/a.ts && echo b > src/b.ts"), [`${CWD}/src/a.ts`, `${CWD}/src/b.ts`]);
});

test("an empty or junk command decides instead of throwing", () => {
	assert.deepEqual(writes(""), []);
	assert.doesNotThrow(() => writes(">>>|&&"));
});
