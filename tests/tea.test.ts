import assert from "node:assert/strict";
import { test } from "node:test";
import { createTeaStats, formatHour } from "../src/utils/tea.ts";

const URL_ = "https://tea.example/api/stats";
const TOKEN = "s3cret-token";
const env = { TEA_STATS_URL: URL_, TEA_STATS_TOKEN: TOKEN };
const body = {
	generatedAt: 1_700_000_000,
	today: { orders: 4, items: 9 },
	week: { items: 40, topItems: [{ name: "দুধ চা", quantity: 12 }, { name: "Green tea", quantity: 5 }], busiestHour: 16 },
};

function stub(respond: () => Response | Promise<Response>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ url: String(input), init });
		return respond();
	}) as typeof fetch;
	return { fetchImpl, calls };
}
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

async function quietly<T>(fn: () => Promise<T>): Promise<T> {
	const warn = console.warn;
	console.warn = () => {};
	try {
		return await fn();
	} finally {
		console.warn = warn;
	}
}

test("success stores stats, Bangla names intact, bearer sent", async () => {
	const s = stub(() => json(body));
	const tea = createTeaStats({ fetchImpl: s.fetchImpl, env });
	assert.equal(tea.latest(), null);
	await tea.refresh();
	assert.deepEqual(tea.latest(), {
		cupsToday: 9,
		topItems: [{ name: "দুধ চা", quantity: 12 }, { name: "Green tea", quantity: 5 }],
		busiestHour: 16,
	});
	assert.equal(s.calls[0].url, URL_);
	assert.deepEqual(s.calls[0].init?.headers, { authorization: `Bearer ${TOKEN}`, accept: "application/json" });
	tea.latest();
	assert.equal(s.calls.length, 1, "latest() does not fetch");
});

test("null busiestHour is accepted", async () => {
	const s = stub(() => json({ ...body, week: { ...body.week, busiestHour: null } }));
	const tea = createTeaStats({ fetchImpl: s.fetchImpl, env });
	await tea.refresh();
	assert.equal(tea.latest()?.busiestHour, null);
});

for (const [name, respond] of [
	["401", () => new Response("", { status: 401 })],
	["404", () => new Response("", { status: 404 })],
	["network error", () => Promise.reject(new TypeError("fetch failed"))],
	["malformed body", () => json({ today: { items: "9" } })],
	["bad topItems", () => json({ ...body, week: { ...body.week, topItems: [{ name: 1, quantity: 2 }] } })],
	["non-JSON", () => new Response("<html>", { status: 200 })],
] as const) {
	test(`${name} hides the card and keeps the token out of the value`, async () => {
		const s = stub(respond);
		const tea = createTeaStats({ fetchImpl: s.fetchImpl, env });
		await quietly(() => tea.refresh());
		assert.equal(tea.latest(), null);
	});
}

test("a failure replaces earlier good stats", async () => {
	let ok = true;
	const s = stub(() => (ok ? json(body) : new Response("", { status: 401 })));
	const tea = createTeaStats({ fetchImpl: s.fetchImpl, env });
	await tea.refresh();
	assert.ok(tea.latest());
	ok = false;
	await quietly(() => tea.refresh());
	assert.equal(tea.latest(), null);
});

test("unset env does not fetch", async () => {
	for (const e of [{}, { TEA_STATS_URL: URL_ }, { TEA_STATS_TOKEN: TOKEN }]) {
		const s = stub(() => json(body));
		const tea = createTeaStats({ fetchImpl: s.fetchImpl, env: e });
		await tea.refresh();
		assert.equal(tea.latest(), null);
		assert.equal(s.calls.length, 0);
	}
});

test("latest() expires after 15 minutes", async () => {
	let t = 1_000_000;
	const s = stub(() => json(body));
	const tea = createTeaStats({ fetchImpl: s.fetchImpl, env, now: () => t });
	await tea.refresh();
	t += 15 * 60_000;
	assert.ok(tea.latest());
	t += 1;
	assert.equal(tea.latest(), null);
});

test("token never appears in stored value or warnings", async () => {
	const s = stub(() => json(body));
	const tea = createTeaStats({ fetchImpl: s.fetchImpl, env });
	await tea.refresh();
	assert.ok(!JSON.stringify(tea.latest()).includes(TOKEN));
	const logged: unknown[] = [];
	const warn = console.warn;
	console.warn = (...a: unknown[]) => void logged.push(...a);
	try {
		const bad = createTeaStats({ fetchImpl: stub(() => new Response("", { status: 401 })).fetchImpl, env });
		await bad.refresh();
	} finally {
		console.warn = warn;
	}
	assert.ok(logged.length > 0);
	assert.ok(!JSON.stringify(logged).includes(TOKEN));
});

test("formatHour", () => {
	assert.equal(formatHour(16), "4 pm");
	assert.equal(formatHour(0), "12 am");
	assert.equal(formatHour(12), "12 pm");
	assert.equal(formatHour(9), "9 am");
});
