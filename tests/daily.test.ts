import assert from "node:assert/strict";
import { test } from "node:test";
import { createAirQualitySource, describeAqi } from "../src/utils/weather.ts";
import { createJokeSource, createWikiSource, shortSummary } from "../src/utils/daily.ts";

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function stub(respond: (url: string) => Response) {
	const urls: string[] = [];
	const fetchImpl = (async (input: string | URL | Request) => {
		const url = String(input);
		urls.push(url);
		return respond(url);
	}) as typeof fetch;
	return { fetchImpl, urls };
}

// 10:00 on 24 Nov 2026 in Dhaka
const T0 = Date.parse("2026-11-24T04:00:00Z");

test("AQI maps to a level and a tip only when bad", () => {
	assert.deepEqual(describeAqi(42), { aqi: 42, level: "Good", tip: null });
	assert.equal(describeAqi(160).level, "Unhealthy");
	assert.ok(describeAqi(160).tip);
});

test("air quality parses us_aqi and fails soft", async () => {
	const ok = stub(() => json({ current: { us_aqi: 119.4 } }));
	assert.equal((await createAirQualitySource({ fetchImpl: ok.fetchImpl })())?.aqi, 119);
	const down = stub(() => new Response("", { status: 500 }));
	assert.equal(await createAirQualitySource({ fetchImpl: down.fetchImpl })(), null);
});

test("joke stays the same all day and changes after Dhaka midnight", async () => {
	let n = 0;
	let t = T0;
	const s = stub(() => json({ value: `Chuck Norris joke ${++n}` }));
	const get = createJokeSource({ fetchImpl: s.fetchImpl, now: () => t });
	assert.equal((await get())?.text, "Chuck Norris joke 1");
	t = Date.parse("2026-11-24T17:59:00Z"); // 23:59 Dhaka
	assert.equal((await get())?.text, "Chuck Norris joke 1");
	t = Date.parse("2026-11-24T18:00:00Z"); // midnight Dhaka
	assert.equal((await get())?.text, "Chuck Norris joke 2");
	assert.ok(!s.urls.some((u) => /explicit|political|religion/.test(u)));
});

test("unsuitable jokes are skipped", async () => {
	const replies = ["Chuck Norris killed it.", "Chuck Norris can divide by zero."];
	const s = stub(() => json({ value: replies.shift() }));
	assert.equal((await createJokeSource({ fetchImpl: s.fetchImpl })())?.text, "Chuck Norris can divide by zero.");
	// "class" and "assume" are fine
	const s2 = stub(() => json({ value: "Chuck Norris doesn't assume; his class knows." }));
	assert.ok(await createJokeSource({ fetchImpl: s2.fetchImpl })());
});

test("wikipedia digest uses the Dhaka date and trims the summary", async () => {
	const s = stub(() =>
		json({
			tfa: {
				titles: { normalized: "Great white shark" },
				extract: "The great white shark is a large shark. It is closely related to the mako. It is robust. More text.",
				content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Great_white_shark" } },
			},
			onthisday: [{ year: 2023, text: "Something happened." }],
		}),
	);
	const late = Date.parse("2026-11-24T19:00:00Z"); // already 25 Nov in Dhaka
	const digest = await createWikiSource({ fetchImpl: s.fetchImpl, now: () => late })();
	assert.match(s.urls[0], /\/feed\/featured\/2026\/11\/25$/);
	assert.equal(digest?.article?.summary, "The great white shark is a large shark. It is closely related to the mako.");
	assert.equal(digest?.article?.thumbnail, null);
	assert.deepEqual(digest?.onThisDay, { year: 2023, text: "Something happened." });
});

test("wikipedia failure resolves to null", async () => {
	const s = stub(() => json({}));
	assert.equal(await createWikiSource({ fetchImpl: s.fetchImpl })(), null);
});

test("shortSummary cuts long text at a word", () => {
	const out = shortSummary("word ".repeat(100), 50);
	assert.ok(out.length <= 50 && out.endsWith("\u2026"));
});
