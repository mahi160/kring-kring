import assert from "node:assert/strict";
import { test } from "node:test";
import { groupHolidays, nextHoliday } from "../src/utils/holidays.ts";

const h = (title: string, day: string, tentative = false) => ({ data: { title, date: `${day}T00:00:00+06:00`, tentative } });

test("back-to-back days with the same title merge, in date order", () => {
	const groups = groupHolidays([
		h("Eid-ul-Fitr", "2026-03-20", true),
		h("Independence Day", "2026-03-26"),
		h("Eid-ul-Fitr", "2026-03-19", true),
		h("Eid-ul-Fitr", "2026-03-21"),
	]);
	assert.deepEqual(groups, [
		{ title: "Eid-ul-Fitr", start: "2026-03-19", end: "2026-03-21", days: 3, tentative: true },
		{ title: "Independence Day", start: "2026-03-26", end: "2026-03-26", days: 1, tentative: false },
	]);
});

test("same title with a gap, or adjacent days with different titles, stay apart", () => {
	const groups = groupHolidays([h("Puja", "2026-10-20"), h("Puja", "2026-10-22"), h("Other", "2026-10-23")]);
	assert.deepEqual(
		groups.map((g) => [g.title, g.start, g.days]),
		[["Puja", "2026-10-20", 1], ["Puja", "2026-10-22", 1], ["Other", "2026-10-23", 1]],
	);
});

test("a stored UTC instant still lands on its Dhaka day", () => {
	// Midnight 16 Dec in Dhaka is 18:00 on 15 Dec in UTC.
	assert.equal(groupHolidays([{ data: { title: "Victory Day", date: "2026-12-15T18:00:00.000Z" } }])[0].start, "2026-12-16");
});

test("next holiday: upcoming counts days, a running one is 0, none left is null", () => {
	const groups = groupHolidays([h("Eid", "2026-03-19"), h("Eid", "2026-03-20"), h("Victory Day", "2026-12-16")]);
	assert.equal(nextHoliday(groups, "2026-03-10")?.inDays, 9);
	assert.deepEqual([nextHoliday(groups, "2026-03-20")?.title, nextHoliday(groups, "2026-03-20")?.inDays], ["Eid", 0]);
	assert.deepEqual([nextHoliday(groups, "2026-11-25")?.title, nextHoliday(groups, "2026-11-25")?.inDays], ["Victory Day", 21]);
	assert.equal(nextHoliday(groups, "2026-12-17"), null);
});
