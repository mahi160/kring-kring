import assert from "node:assert/strict";
import { test } from "node:test";
import { cached } from "../src/utils/cached.ts";

test("fetchedAt is null until loaded, then the load time", async () => {
	let t = 100;
	const get = cached(async () => "v", { ttlMs: 1000, now: () => t, label: "x" });
	assert.equal(get.fetchedAt(), null);
	await get();
	assert.equal(get.fetchedAt(), 100);
	t = 500;
	await get();
	assert.equal(get.fetchedAt(), 100);
});

test("refresh reloads before the TTL and updates fetchedAt", async () => {
	let t = 0;
	let n = 0;
	const get = cached(async () => ++n, { ttlMs: 10_000, now: () => t, label: "x" });
	assert.equal(await get(), 1);
	t = 50;
	assert.equal(await get.refresh(), 2);
	assert.equal(await get(), 2);
	assert.equal(get.fetchedAt(), 50);
});

test("concurrent refreshes share one load", async () => {
	let n = 0;
	const get = cached(async () => ++n, { ttlMs: 10_000, label: "x" });
	await Promise.all([get.refresh(), get.refresh(), get()]);
	assert.equal(n, 1);
});

test("a failed refresh resolves to null and clears fetchedAt", async () => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		let fail = false;
		const get = cached(
			async () => {
				if (fail) throw new Error("down");
				return "ok";
			},
			{ ttlMs: 10_000, label: "x" },
		);
		await get();
		fail = true;
		assert.equal(await get.refresh(), null);
		assert.equal(get.fetchedAt(), null);
	} finally {
		console.warn = warn;
	}
});
