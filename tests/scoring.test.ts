import assert from "node:assert/strict";
import { test } from "node:test";
import { monthWinners, monthlyTotals, scoreDays, scoringDays, streaks } from "../src/staff/scoring.ts";

const days = (...ds: string[]) => ds.map((day) => ({ day, correct: 1 }));
const ans = (personId: string, ...picks: [string, number][]) => picks.map(([day, choice]) => ({ day, personId, choice }));
const pts = (scored: { points: number }[]) => scored.map((s) => s.points);

const WEEK = ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26"];

test("streak grows 10, 12, 14, 16, 18", () => {
	const scored = scoreDays(days(...WEEK), ans("a", ...WEEK.map((d): [string, number] => [d, 1])));
	assert.deepEqual(pts(scored), [10, 12, 14, 16, 18]);
});

test("bonus is capped at +10", () => {
	const ds = Array.from({ length: 9 }, (_, i) => `2026-11-${String(1 + i).padStart(2, "0")}`);
	const scored = scoreDays(days(...ds), ans("a", ...ds.map((d): [string, number] => [d, 1])));
	assert.deepEqual(pts(scored), [10, 12, 14, 16, 18, 20, 20, 20, 20]);
});

test("a wrong answer resets the streak and scores nothing", () => {
	const scored = scoreDays(days(...WEEK), ans("a", [WEEK[0], 1], [WEEK[1], 1], [WEEK[2], 0], [WEEK[3], 1]));
	assert.deepEqual(pts(scored), [10, 12, 10]);
});

test("a missed quiz day resets the streak", () => {
	const scored = scoreDays(days(...WEEK), ans("a", [WEEK[0], 1], [WEEK[1], 1], [WEEK[3], 1]));
	assert.deepEqual(pts(scored), [10, 12, 10]);
});

test("a weekend with no quiz day doesn't break the streak", () => {
	const scored = scoreDays(days("2026-11-26", "2026-11-29"), ans("a", ["2026-11-26", 1], ["2026-11-29", 1]));
	assert.deepEqual(pts(scored), [10, 12]);
});

test("people are scored independently", () => {
	const scored = scoreDays(days("2026-11-22", "2026-11-23"), [
		...ans("a", ["2026-11-22", 1], ["2026-11-23", 1]),
		...ans("b", ["2026-11-23", 1]),
	]);
	assert.deepEqual(monthlyTotals(scored, "2026-11").get("a"), 22);
	assert.deepEqual(monthlyTotals(scored, "2026-11").get("b"), 10);
});

test("streaks and points cross month boundaries; the leaderboard resets", () => {
	const ds = days("2026-10-29", "2026-10-30", "2026-11-01", "2026-11-02");
	const scored = scoreDays(ds, ans("a", ...ds.map((d): [string, number] => [d.day, 1])));
	assert.equal(monthlyTotals(scored, "2026-10").get("a"), 22);
	assert.equal(monthlyTotals(scored, "2026-11").get("a"), 14 + 16); // streak continues
	assert.equal(monthlyTotals(scored, "2026-12").size, 0);
});

test("last month's winner: highest total, ties share, nobody -> none", () => {
	const ds = days("2026-10-29", "2026-10-30", "2026-11-01");
	const scored = scoreDays(ds, [
		...ans("a", ["2026-10-29", 1], ["2026-10-30", 1]),
		...ans("b", ["2026-10-29", 1], ["2026-10-30", 1]),
		...ans("c", ["2026-10-29", 1]),
		...ans("c", ["2026-11-01", 1]),
	]);
	assert.deepEqual(monthWinners(scored, "2026-10").sort(), ["a", "b"]);
	assert.deepEqual(monthWinners(scored, "2026-11"), ["c"]);
	assert.deepEqual(monthWinners(scored, "2026-09"), []);
	assert.deepEqual(monthWinners(scoreDays(ds, ans("d", ["2026-10-29", 0])), "2026-10"), []);
});

test("today is excluded until revealed; deleted questions are skipped without breaking streaks", () => {
	const quizDays = [
		{ day: "2026-11-22", questionId: "q1" },
		{ day: "2026-11-23", questionId: "gone" },
		{ day: "2026-11-24", questionId: "q2" },
		{ day: "2026-11-25", questionId: "q3" },
	];
	const bank = [
		{ id: "q1", correct: 1 },
		{ id: "q2", correct: 0 }, // operator fixed the answer after the day
		{ id: "q3", correct: 1 },
	];
	const answers = [
		...ans("a", ["2026-11-22", 1], ["2026-11-24", 0], ["2026-11-25", 1]),
	];
	const before = scoreDays(scoringDays(quizDays, bank, "2026-11-25", false), answers);
	assert.deepEqual(pts(before), [10, 12]); // q1, q2 (current answer); gone skipped; today hidden
	const after = scoreDays(scoringDays(quizDays, bank, "2026-11-25", true), answers);
	assert.deepEqual(pts(after), [10, 12, 14]);
});

test("streaks: current run, best run ever, resets on wrong or missed days", () => {
	const ds = days(...WEEK);
	const result = streaks(
		ds,
		[
			...ans("a", [WEEK[0], 1], [WEEK[1], 1], [WEEK[2], 1], [WEEK[3], 0], [WEEK[4], 1]),
			...ans("b", [WEEK[0], 1], [WEEK[1], 1]),
			...ans("c", [WEEK[3], 1], [WEEK[4], 1]),
		],
	);
	assert.deepEqual(result.get("a"), { current: 1, best: 3 });
	assert.deepEqual(result.get("b"), { current: 0, best: 2 });
	assert.deepEqual(result.get("c"), { current: 2, best: 2 });
	assert.equal(result.get("nobody"), undefined);
});
