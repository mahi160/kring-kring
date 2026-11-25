import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DailyQuiz } from "../src/staff/quiz.ts";
import { Visits } from "../src/staff/visits.ts";

function setup() {
	const db = new DatabaseSync(":memory:");
	new DailyQuiz(db);
	return { db, v: new Visits(db) };
}

test("counts visitors, signed-in staff and views per day, newest first", () => {
	const { db, v } = setup();
	v.record("2026-11-24", "browser-a", null, "/");
	v.record("2026-11-25", "browser-a", null, "/");
	v.record("2026-11-25", "browser-a", "ada", "/quiz"); // signed in mid-day
	v.record("2026-11-25", "browser-a", null, "/"); // name kept for the day
	v.record("2026-11-25", "browser-b", null, "/holidays");
	db.prepare("INSERT INTO quiz_answers (day, person_id, choice, answered_at) VALUES ('2026-11-25', 'ada', 1, 0)").run();

	assert.deepEqual(v.daily("2026-11-01", "2026-11-30"), [
		{ day: "2026-11-25", visitors: 2, signedIn: 1, views: 4, quizAnswers: 1 },
		{ day: "2026-11-24", visitors: 1, signedIn: 0, views: 1, quizAnswers: 0 },
	]);
	assert.equal(v.uniqueVisitors("2026-11-01", "2026-11-30"), 2);
	assert.deepEqual(v.pages("2026-11-25", "2026-11-25"), [
		{ page: "/", views: 2 },
		{ page: "/holidays", views: 1 },
		{ page: "/quiz", views: 1 },
	]);
});

test("people: last visit ever, days and views only inside the range", () => {
	const { v } = setup();
	v.record("2026-10-01", "a", "ada", "/");
	v.record("2026-11-20", "a", "ada", "/");
	v.record("2026-11-21", "a2", "ada", "/");
	v.record("2026-11-21", "a2", "ada", "/quiz");
	v.record("2026-09-01", "b", "bob", "/");

	assert.deepEqual(v.people("2026-11-01", "2026-11-30"), [
		{ personId: "ada", lastDay: "2026-11-21", days: 2, views: 3 },
		{ personId: "bob", lastDay: "2026-09-01", days: 0, views: 0 },
	]);
});
