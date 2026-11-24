import assert from "node:assert/strict";
import { test } from "node:test";
import { upcomingAnniversaries, upcomingBirthdays } from "../src/utils/celebrations.ts";

type Data = {
	birthday_month?: string;
	birthday_day?: number;
	hide_birthday?: boolean;
	joined_on?: string;
};
const person = (id: string, data: Data) => ({ id, data });
const ids = (list: { person: { id: string } }[]) => list.map((c) => c.person.id);

// 10:00 on 24 Nov 2026 in Dhaka
const now = new Date("2026-11-24T04:00:00Z");

test("today's birthday comes first with inDays 0; next 14 days listed in order", () => {
	const people = [
		person("in-14", { birthday_month: "December", birthday_day: 8 }),
		person("in-15", { birthday_month: "December", birthday_day: 9 }),
		person("tomorrow", { birthday_month: "November", birthday_day: 25 }),
		person("today", { birthday_month: "November", birthday_day: 24 }),
		person("yesterday", { birthday_month: "November", birthday_day: 23 }),
		person("no-birthday", {}),
	];
	const list = upcomingBirthdays(people, now);
	assert.deepEqual(ids(list), ["today", "tomorrow", "in-14"]);
	assert.deepEqual(
		list.map((c) => c.inDays),
		[0, 1, 14],
	);
});

test("uses the Dhaka day, not UTC", () => {
	// 23:30 UTC on 23 Nov is already 24 Nov in Dhaka
	const late = new Date("2026-11-23T23:30:00Z");
	const list = upcomingBirthdays([person("today", { birthday_month: "November", birthday_day: 24 })], late);
	assert.equal(list[0]?.inDays, 0);
});

test("wraps across the new year", () => {
	const dec = new Date("2026-12-28T04:00:00Z");
	const list = upcomingBirthdays([person("jan", { birthday_month: "January", birthday_day: 3 })], dec);
	assert.equal(list[0]?.inDays, 6);
});

test("opted-out people never appear in birthdays but keep their anniversary", () => {
	const shy = person("shy", {
		birthday_month: "November",
		birthday_day: 24,
		hide_birthday: true,
		joined_on: "2023-11-24T04:00:00Z",
	});
	assert.deepEqual(upcomingBirthdays([shy], now), []);
	const anniversaries = upcomingAnniversaries([shy], now);
	assert.deepEqual(ids(anniversaries), ["shy"]);
	assert.equal(anniversaries[0]?.years, 3);
});

test("29 February shows on 28 February in non-leap years, and on the 29th in leap years", () => {
	const leapling = [person("leap", { birthday_month: "February", birthday_day: 29 })];
	const feb28 = new Date("2027-02-28T04:00:00Z");
	assert.equal(upcomingBirthdays(leapling, feb28)[0]?.inDays, 0);
	const feb28Leap = new Date("2028-02-28T04:00:00Z");
	assert.equal(upcomingBirthdays(leapling, feb28Leap)[0]?.inDays, 1);
});

test("anniversaries need a full year and count years at the next occurrence", () => {
	const people = [
		person("joined-today", { joined_on: "2026-11-24T04:00:00Z" }),
		person("five-next-week", { joined_on: "2021-12-01T04:00:00Z" }),
		person("far", { joined_on: "2020-06-01T04:00:00Z" }),
	];
	const list = upcomingAnniversaries(people, now);
	assert.deepEqual(ids(list), ["five-next-week"]);
	assert.equal(list[0]?.years, 5);
	assert.equal(list[0]?.inDays, 7);
});
