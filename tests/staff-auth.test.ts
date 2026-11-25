import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { StaffAuth } from "../src/staff/auth.ts";

const MIN = 60_000;
function setup() {
	let t = Date.parse("2026-11-24T04:00:00Z");
	const db = new DatabaseSync(":memory:");
	const auth = new StaffAuth(db, () => t);
	return { db, auth, advance: (ms: number) => (t += ms) };
}
const wrong = (pin: string) => (pin === "0000" ? "1111" : "0000");

test("issued PIN is 4 digits and only its hash is stored", async () => {
	const { db, auth } = setup();
	const pin = await auth.issuePin("rina");
	assert.match(pin, /^\d{4}$/);
	const rows = JSON.stringify(db.prepare("SELECT * FROM staff_pins").all());
	assert.ok(!rows.includes(`"${pin}"`) && !rows.includes(`:${pin}`));
	assert.ok(auth.pinSetAt("rina"));
	assert.equal(auth.pinSetAt("nobody"), null);
});

test("correct PIN signs in; the session persists until sign-out", async () => {
	const { db, auth } = setup();
	const pin = await auth.issuePin("rina");
	const result = await auth.signIn("rina", pin);
	assert.ok(result.ok);
	assert.equal(auth.personForToken(result.token), "rina");
	// token stored hashed
	assert.ok(!JSON.stringify(db.prepare("SELECT * FROM staff_sessions").all()).includes(result.token));
	auth.signOut(result.token);
	assert.equal(auth.personForToken(result.token), null);
});

test("no PIN yet cannot sign in", async () => {
	const { auth } = setup();
	assert.deepEqual(await auth.signIn("rina", "1234"), { ok: false, reason: "no-pin" });
});

test("first sign-in: someone with no PIN claims one and is signed in", async () => {
	const { auth } = setup();
	assert.deepEqual(await auth.claimPin("rina", "12a4"), { ok: false, reason: "invalid-new-pin" });
	assert.equal(auth.pinSetAt("rina"), null);
	const claimed = await auth.claimPin("rina", "2468");
	assert.ok(claimed.ok);
	assert.equal(auth.personForToken(claimed.token), "rina");
	assert.ok((await auth.signIn("rina", "2468")).ok);
});

test("claiming can't overwrite an existing PIN, even in parallel", async () => {
	const { auth } = setup();
	const results = await Promise.all([auth.claimPin("rina", "1111"), auth.claimPin("rina", "2222")]);
	assert.equal(results.filter((r) => r.ok).length, 1);
	assert.deepEqual(await auth.claimPin("rina", "3333"), { ok: false, reason: "taken" });
	const issued = await auth.issuePin("tanvir");
	assert.deepEqual(await auth.claimPin("tanvir", issued === "4444" ? "5555" : "4444"), { ok: false, reason: "taken" });
	assert.ok((await auth.signIn("tanvir", issued)).ok);
});

test("clearing a PIN ends sessions and lets the person claim a new one", async () => {
	const { auth } = setup();
	const pin = await auth.issuePin("rina");
	const session = await auth.signIn("rina", pin);
	assert.ok(session.ok);
	auth.clearPin("rina");
	assert.equal(auth.personForToken(session.token), null);
	assert.equal(auth.pinSetAt("rina"), null);
	assert.deepEqual(await auth.signIn("rina", pin), { ok: false, reason: "no-pin" });
	assert.ok((await auth.claimPin("rina", "1357")).ok);
});

test("third wrong PIN locks for 15 minutes, even against the correct PIN", async () => {
	const { auth, advance } = setup();
	const pin = await auth.issuePin("rina");
	assert.deepEqual(await auth.signIn("rina", wrong(pin)), { ok: false, reason: "wrong", triesLeft: 2 });
	assert.deepEqual(await auth.signIn("rina", wrong(pin)), { ok: false, reason: "wrong", triesLeft: 1 });
	const third = await auth.signIn("rina", wrong(pin));
	assert.equal(third.ok === false && third.reason, "locked");
	advance(14 * MIN);
	const during = await auth.signIn("rina", pin);
	assert.equal(during.ok === false && during.reason, "locked");
	advance(1 * MIN + 1);
	assert.ok((await auth.signIn("rina", pin)).ok);
});

test("lock expiry restarts the count; a success resets it", async () => {
	const { auth, advance } = setup();
	const pin = await auth.issuePin("rina");
	for (let i = 0; i < 3; i++) await auth.signIn("rina", wrong(pin));
	advance(16 * MIN);
	assert.deepEqual(await auth.signIn("rina", wrong(pin)), { ok: false, reason: "wrong", triesLeft: 2 });
	assert.ok((await auth.signIn("rina", pin)).ok);
	assert.deepEqual(await auth.signIn("rina", wrong(pin)), { ok: false, reason: "wrong", triesLeft: 2 });
});

test("parallel guesses can't get past the lockout", async () => {
	const { auth } = setup();
	const pin = await auth.issuePin("rina");
	const guesses = Array.from({ length: 20 }, (_, i) => String(i).padStart(4, "0")).filter((g) => g !== pin);
	const results = await Promise.all(guesses.map((g) => auth.signIn("rina", g)));
	assert.equal(results.filter((r) => !r.ok && r.reason === "wrong").length, 2);
	const locked = await auth.signIn("rina", pin);
	assert.equal(locked.ok === false && locked.reason, "locked");
});

test("lockout is per person", async () => {
	const { auth } = setup();
	const rina = await auth.issuePin("rina");
	const tanvir = await auth.issuePin("tanvir");
	for (let i = 0; i < 3; i++) await auth.signIn("rina", wrong(rina));
	assert.ok((await auth.signIn("tanvir", tanvir)).ok);
});

test("reset invalidates the old PIN, existing sessions and any lock", async () => {
	const { auth } = setup();
	const old = await auth.issuePin("rina");
	const session = await auth.signIn("rina", old);
	assert.ok(session.ok);
	for (let i = 0; i < 3; i++) await auth.signIn("rina", wrong(old));
	const fresh = await auth.issuePin("rina");
	assert.equal(auth.personForToken(session.token), null);
	if (fresh !== old) {
		const stale = await auth.signIn("rina", old);
		assert.equal(stale.ok === false && stale.reason, "wrong");
	}
	assert.ok((await auth.signIn("rina", fresh)).ok);
});

test("change own PIN: needs the current PIN, keeps this session, ends the others", async () => {
	const { auth } = setup();
	const pin = await auth.issuePin("rina");
	const here = await auth.signIn("rina", pin);
	const elsewhere = await auth.signIn("rina", pin);
	assert.ok(here.ok && elsewhere.ok);
	const newPin = pin === "4321" ? "9876" : "4321";

	assert.deepEqual(await auth.changePin("rina", pin, "12a4", here.token), { ok: false, reason: "invalid-new-pin" });
	const bad = await auth.changePin("rina", wrong(pin), newPin, here.token);
	assert.equal(bad.ok === false && bad.reason, "wrong");

	assert.deepEqual(await auth.changePin("rina", pin, newPin, here.token), { ok: true });
	assert.equal(auth.personForToken(here.token), "rina");
	assert.equal(auth.personForToken(elsewhere.token), null);
	assert.equal((await auth.signIn("rina", pin)).ok, false);
	assert.ok((await auth.signIn("rina", newPin)).ok);
});

test("wrong current PINs during a change count toward the lockout", async () => {
	const { auth } = setup();
	const pin = await auth.issuePin("rina");
	const s = await auth.signIn("rina", pin);
	assert.ok(s.ok);
	for (let i = 0; i < 3; i++) await auth.changePin("rina", wrong(pin), "5555", s.token);
	const locked = await auth.signIn("rina", pin);
	assert.equal(locked.ok === false && locked.reason, "locked");
});
