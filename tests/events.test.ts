import assert from "node:assert/strict";
import { test } from "node:test";
import { endOfDhakaDay, upcomingEvents } from "../src/utils/events.ts";

const ev = (id: string, starts_at: string, ends_at?: string) => ({ id, data: { starts_at, ends_at } });

test("end of the Dhaka day is 18:00 UTC", () => {
	assert.equal(endOfDhakaDay(new Date("2026-11-24T10:00:00Z")).toISOString(), "2026-11-24T18:00:00.000Z");
	// 23:30 UTC is already the next day in Dhaka
	assert.equal(endOfDhakaDay(new Date("2026-11-24T23:30:00Z")).toISOString(), "2026-11-25T18:00:00.000Z");
});

test("keeps events not yet over, soonest first, up to the limit", () => {
	const now = new Date("2026-11-24T08:00:00Z"); // 14:00 in Dhaka
	const entries = [
		ev("later", "2026-11-28T04:00:00Z"),
		ev("ended", "2026-11-24T03:00:00Z", "2026-11-24T05:00:00Z"),
		ev("running", "2026-11-24T07:00:00Z", "2026-11-24T09:00:00Z"),
		ev("earlier-today-no-end", "2026-11-24T04:00:00Z"),
		ev("yesterday-no-end", "2026-11-23T10:00:00Z"),
		ev("soon", "2026-11-25T04:00:00Z"),
	];
	assert.deepEqual(
		upcomingEvents(entries, now, 10).map((e) => e.id),
		["earlier-today-no-end", "running", "soon", "later"],
	);
	assert.deepEqual(
		upcomingEvents(entries, now, 2).map((e) => e.id),
		["earlier-today-no-end", "running"],
	);
});
