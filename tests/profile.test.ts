import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByTeam, initials, isActive } from "../src/utils/people.ts";
import { MAX_PHOTO_BYTES, parseProfile } from "../src/utils/profile.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");

const formOf = (fields: Record<string, string | File>) => {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return form;
};
const valid = {
	team: "Design",
	birthday_month: "March",
	birthday_day: "12",
	hide_birthday: "on",
	phone: "+880 1711-123456",
	bio: "Makes things pretty.",
};
const errorsOf = async (fields: Record<string, string | File>) => {
	const r = await parseProfile(formOf({ ...valid, ...fields }));
	assert.equal(r.ok, false);
	return r.ok ? {} : r.errors;
};

test("valid input yields only the allowed keys, typed", async () => {
	const r = await parseProfile(formOf({ ...valid, name: "Hacker", joined_on: "2000-01-01", id: "x", active: "on" }));
	assert.equal(r.ok && r.values.phone, valid.phone);
	assert.deepEqual(r.ok && { ...r, values: undefined }, {
		ok: true,
		values: undefined,
		data: {
			team: "Design",
			birthday_month: "March",
			birthday_day: 12,
			hide_birthday: true,
			phone: "+880 1711-123456",
			bio: "Makes things pretty.",
		},
		photo: null,
		removePhoto: false,
	});
});

test("blank optional fields become null; unchecked box is false", async () => {
	const r = await parseProfile(formOf({}));
	assert.deepEqual(r.ok && r.data, {
		team: null,
		birthday_month: null,
		birthday_day: null,
		hide_birthday: false,
		phone: null,
		bio: null,
	});
});

test("birthday: month and day go together and must exist", async () => {
	assert.ok((await errorsOf({ birthday_day: "" })).birthday_day);
	assert.ok((await errorsOf({ birthday_month: "" })).birthday_month);
	assert.ok((await errorsOf({ birthday_month: "Marchy" })).birthday_month);
	for (const bad of ["0", "32", "abc", "1.5", "-3"]) assert.ok((await errorsOf({ birthday_day: bad })).birthday_day, bad);
});

test("birthday: Feb 29 is fine, Feb 30 and 31 April are not", async () => {
	const ok = await parseProfile(formOf({ birthday_month: "February", birthday_day: "29" }));
	assert.equal(ok.ok, true);
	assert.ok((await errorsOf({ birthday_month: "February", birthday_day: "30" })).birthday_day);
	assert.ok((await errorsOf({ birthday_month: "April", birthday_day: "31" })).birthday_day);
	assert.equal((await parseProfile(formOf({ birthday_month: "May", birthday_day: "31" }))).ok, true);
});

test("phone allows digits, spaces, + and - up to 20 characters", async () => {
	for (const bad of ["call me", "017x", "(017) 123", "1".repeat(21)]) assert.ok((await errorsOf({ phone: bad })).phone, bad);
	assert.equal((await parseProfile(formOf({ phone: "1".repeat(20) }))).ok, true);
});

test("bio and team lengths", async () => {
	assert.equal((await parseProfile(formOf({ bio: "x".repeat(280) }))).ok, true);
	assert.ok((await errorsOf({ bio: "x".repeat(281) })).bio);
	assert.ok((await errorsOf({ team: "x".repeat(61) })).team);
});

test("photo: type comes from the bytes, size is capped", async () => {
	for (const [bytes, type] of [[PNG, "image/png"], [JPEG, "image/jpeg"], [WEBP, "image/webp"]] as const) {
		const r = await parseProfile(formOf({ ...valid, photo: new File([bytes], "me.bin", { type: "text/plain" }) }));
		assert.equal(r.ok && r.photo?.contentType, type);
		assert.equal(r.ok && r.photo?.base64, Buffer.from(bytes).toString("base64"));
	}
	const text = new File(["hello"], "me.png", { type: "image/png" });
	assert.ok((await errorsOf({ photo: text })).photo);
	const big = new File([new Uint8Array(MAX_PHOTO_BYTES + 1)], "big.png", { type: "image/png" });
	assert.ok((await errorsOf({ photo: big })).photo);
});

test("no file chosen keeps the photo; remove only applies without a new upload", async () => {
	const empty = new File([], "", { type: "application/octet-stream" });
	const kept = await parseProfile(formOf({ ...valid, photo: empty }));
	assert.deepEqual(kept.ok && [kept.photo, kept.removePhoto], [null, false]);
	const removed = await parseProfile(formOf({ ...valid, remove_photo: "on" }));
	assert.equal(removed.ok && removed.removePhoto, true);
	const replaced = await parseProfile(formOf({ ...valid, remove_photo: "on", photo: new File([PNG], "a.png") }));
	assert.deepEqual(replaced.ok && [replaced.photo !== null, replaced.removePhoto], [true, false]);
});

test("errors hand back the submitted values", async () => {
	const r = await parseProfile(formOf({ ...valid, phone: "abc" }));
	assert.equal(!r.ok && r.values.phone, "abc");
	assert.equal(!r.ok && r.values.team, "Design");
});

test("people helpers: only active === false is inactive; teams grouped, no team last", () => {
	assert.equal(isActive({ data: {} }), true);
	assert.equal(isActive({ data: { active: null } }), true);
	assert.equal(isActive({ data: { active: true } }), true);
	assert.equal(isActive({ data: { active: false } }), false);
	const p = (id: string, team?: string) => ({ id, data: { team } });
	const groups = groupByTeam([p("a"), p("b", "Sales"), p("c", "Design"), p("d", "Sales"), p("e", " ")]);
	assert.deepEqual(
		groups.map(([team, list]) => [team, list.map((x) => x.id)]),
		[["Design", ["c"]], ["Sales", ["b", "d"]], [null, ["a", "e"]]],
	);
	assert.equal(initials("Rina Akter"), "RA");
	assert.equal(initials("Madonna"), "MA");
});
