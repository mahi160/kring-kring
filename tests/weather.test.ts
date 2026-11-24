import assert from "node:assert/strict";
import { test } from "node:test";
import { aqiMood, createWeatherSource, weatherIcon } from "../src/utils/weather.ts";

test("aqiMood follows the AQI band edges", () => {
	const edges: [number, string][] = [
		[50, "good"],
		[51, "moderate"],
		[100, "moderate"],
		[101, "usg"],
		[150, "usg"],
		[151, "unhealthy"],
		[200, "unhealthy"],
		[201, "very-unhealthy"],
		[300, "very-unhealthy"],
		[301, "hazardous"],
	];
	for (const [aqi, mood] of edges) assert.equal(aqiMood(aqi), mood, String(aqi));
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const sample = { current: { time: "2026-11-24T17:15", temperature_2m: 24.1, weather_code: 2 } };

function stubFetch(respond: () => Response | Promise<Response>) {
	let calls = 0;
	const fetchImpl = (async () => {
		calls++;
		return respond();
	}) as typeof fetch;
	return { fetchImpl, calls: () => calls };
}

test("parses temperature and condition from Open-Meteo", async () => {
	const { fetchImpl } = stubFetch(() => ok(sample));
	const weather = await createWeatherSource({ fetchImpl })();
	assert.deepEqual(weather, { temperatureC: 24.1, condition: "Partly cloudy", icon: "partly-day" });
});

test("caches: one request for many page views within 15 minutes", async () => {
	let t = 0;
	const { fetchImpl, calls } = stubFetch(() => ok(sample));
	const get = createWeatherSource({ fetchImpl, now: () => t });
	await Promise.all([get(), get(), get()]);
	t += 14 * 60_000;
	await get();
	assert.equal(calls(), 1);
	t += 2 * 60_000;
	await get();
	assert.equal(calls(), 2);
});

test("network failure resolves to null and backs off for a minute", async () => {
	let t = 0;
	const { fetchImpl, calls } = stubFetch(() => {
		throw new TypeError("fetch failed");
	});
	const get = createWeatherSource({ fetchImpl, now: () => t });
	assert.equal(await get(), null);
	assert.equal(await get(), null);
	assert.equal(calls(), 1);
	t += 61_000;
	await get();
	assert.equal(calls(), 2);
});

test("HTTP errors and malformed bodies resolve to null", async () => {
	for (const res of [
		new Response("busy", { status: 503 }),
		ok({ current: { temperature_2m: "hot" } }),
		new Response("not json", { status: 200 }),
	]) {
		const { fetchImpl } = stubFetch(() => res);
		assert.equal(await createWeatherSource({ fetchImpl })(), null);
	}
});

test("is_day: 0 turns clear and partly cloudy skies into night icons", async () => {
	const { fetchImpl } = stubFetch(() => ok({ current: { temperature_2m: 25, weather_code: 0, is_day: 0 } }));
	assert.equal((await createWeatherSource({ fetchImpl })())?.icon, "clear-night");
});

test("WMO codes map to icons", () => {
	const cases: [number, boolean, string][] = [
		[0, true, "clear-day"],
		[0, false, "clear-night"],
		[1, true, "partly-day"],
		[2, false, "partly-night"],
		[3, false, "overcast"],
		[45, true, "fog"],
		[53, true, "drizzle"],
		[63, true, "rain"],
		[80, true, "rain"],
		[65, true, "heavy-rain"],
		[82, false, "heavy-rain"],
		[75, true, "snow"],
		[95, true, "thunder"],
		[99, false, "thunder"],
	];
	for (const [code, isDay, icon] of cases) assert.equal(weatherIcon(code, isDay), icon, `code ${code}`);
});
