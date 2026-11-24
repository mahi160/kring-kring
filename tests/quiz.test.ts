import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { DailyQuiz, nextQuizDay, publicView, quizClock, toQuizQuestion, type QuizQuestion } from "../src/staff/quiz.ts";

// Dhaka is UTC+6: 10:00 Dhaka = 04:00Z, 18:00 Dhaka = 12:00Z. 2026-11-22 is a Sunday.
const at = (iso: string) => new Date(iso);
const SUN_0930 = at("2026-11-22T03:30:00Z");
const SUN_1000 = at("2026-11-22T04:00:00Z");
const SUN_1759 = at("2026-11-22T11:59:59Z");
const SUN_1800 = at("2026-11-22T12:00:00Z");
const MON_1100 = at("2026-11-23T05:00:00Z");

const q = (id: string, addedAt: number, correct = 1): QuizQuestion => ({
	id,
	question: `Question ${id}?`,
	choices: ["A", "B", "C"],
	correct,
	explanation: `Because ${id}.`,
	addedAt,
});
const bank = [q("q2", 2), q("q1", 1), q("q3", 3)];
const setup = () => new DailyQuiz(new DatabaseSync(":memory:"));

test("clock: Sunday–Thursday open 10:00–18:00 Dhaka; Friday and Saturday closed", () => {
	assert.equal(quizClock(SUN_0930).phase, "before");
	assert.equal(quizClock(SUN_1000).phase, "open");
	assert.equal(quizClock(SUN_1759).phase, "open");
	assert.equal(quizClock(SUN_1800).phase, "revealed");
	assert.equal(quizClock(SUN_1000).day, "2026-11-22");
	// 23:30Z Saturday is 05:30 Sunday in Dhaka.
	assert.equal(quizClock(at("2026-11-21T23:30:00Z")).day, "2026-11-22");
	assert.equal(quizClock(at("2026-11-26T05:00:00Z")).phase, "open"); // Thursday
	assert.equal(quizClock(at("2026-11-27T05:00:00Z")).phase, "closed-day"); // Friday
	assert.equal(quizClock(at("2026-11-28T05:00:00Z")).phase, "closed-day"); // Saturday
});

test("next quiz day skips the weekend", () => {
	assert.equal(nextQuizDay(quizClock(SUN_0930)), "today");
	assert.equal(nextQuizDay(quizClock(SUN_1800)), "tomorrow");
	assert.equal(nextQuizDay(quizClock(at("2026-11-26T12:30:00Z"))), "on Sunday"); // Thursday evening
	assert.equal(nextQuizDay(quizClock(at("2026-11-27T05:00:00Z"))), "on Sunday"); // Friday
	assert.equal(nextQuizDay(quizClock(at("2026-11-28T05:00:00Z"))), "tomorrow"); // Saturday
});

test("one question per working day, stable all day; none on weekends", () => {
	const quiz = setup();
	const first = quiz.questionFor(quizClock(SUN_0930), bank);
	assert.equal(first?.id, "q1"); // oldest unused first
	assert.equal(quiz.questionFor(quizClock(SUN_1759), [...bank].reverse())?.id, "q1");
	assert.equal(quiz.questionFor(quizClock(SUN_1800), bank)?.id, "q1");
	assert.equal(quiz.questionFor(quizClock(at("2026-11-27T05:00:00Z")), bank), null);
});

test("questions are not reused while unused ones remain; then the least recently used returns", () => {
	const quiz = setup();
	const days = ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"].map((d) => quizClock(at(`${d}T05:00:00Z`)));
	assert.deepEqual(
		days.map((c) => quiz.questionFor(c, bank)?.id),
		["q1", "q2", "q3", "q1"],
	);
});

test("a day isn't assigned after the reveal, so an unseen question isn't used up", () => {
	const quiz = setup();
	assert.equal(quiz.questionFor(quizClock(SUN_1800), bank), null);
	assert.equal(quiz.questionFor(quizClock(MON_1100), bank)?.id, "q1");
});

test("empty bank means no quiz, not an error; a question added later is picked up", () => {
	const quiz = setup();
	assert.equal(quiz.questionFor(quizClock(SUN_1000), []), null);
	assert.equal(quiz.questionFor(quizClock(SUN_1000), [q("late", 9)])?.id, "late");
});

test("one answer per person per day, only between 10:00 and 18:00", () => {
	const quiz = setup();
	const question = quiz.questionFor(quizClock(SUN_1000), bank);
	assert.ok(question);
	assert.equal(quiz.answer(quizClock(SUN_0930), question, "rina", 1, SUN_0930), "closed");
	assert.equal(quiz.answer(quizClock(SUN_1000), question, "rina", 1, SUN_1000), "ok");
	assert.equal(quiz.answer(quizClock(SUN_1759), question, "rina", 0, SUN_1759), "already-answered");
	assert.equal(quiz.answerOf("2026-11-22", "rina"), 1);
	assert.equal(quiz.answer(quizClock(SUN_1800), question, "tanvir", 1, SUN_1800), "closed");
	assert.equal(quiz.answer(quizClock(SUN_1000), question, "tanvir", 3, SUN_1000), "invalid-choice");
	assert.equal(quiz.answer(quizClock(SUN_1000), question, "tanvir", 1.5, SUN_1000), "invalid-choice");
	assert.equal(quiz.answerOf("2026-11-22", "tanvir"), null);
});

test("reveal: how many got it right", () => {
	const quiz = setup();
	const clock = quizClock(SUN_1000);
	const question = quiz.questionFor(clock, bank);
	assert.ok(question);
	quiz.answer(clock, question, "rina", question.correct, SUN_1000);
	quiz.answer(clock, question, "tanvir", 0, SUN_1000);
	quiz.answer(clock, question, "mitu", question.correct, SUN_1000);
	assert.deepEqual(quiz.stats(clock.day, question), { answered: 3, correct: 2 });
});

test("the correct answer and explanation stay hidden until 18:00", () => {
	const question = q("q1", 1);
	for (const phase of ["before", "open"] as const) {
		const view = publicView(question, phase);
		assert.ok(!("correct" in view) && !("explanation" in view));
		assert.ok(!JSON.stringify(view).includes("Because"));
	}
	assert.deepEqual(publicView(question, "revealed").correct, 1);
	assert.equal(publicView(question, "revealed").explanation, "Because q1.");
});

test("only approved, well-formed questions enter the bank", () => {
	const base = { id: "x", question: "?", choices: [{ label: "A" }, { label: "B" }], correct_choice: 2, approved: true, addedAt: 0 };
	assert.equal(toQuizQuestion(base)?.correct, 1);
	assert.equal(toQuizQuestion({ ...base, approved: false }), null);
	assert.equal(toQuizQuestion({ ...base, correct_choice: 3 }), null);
	assert.equal(toQuizQuestion({ ...base, choices: [{ label: "A" }, { label: " " }] }), null);
	assert.equal(toQuizQuestion({ ...base, explanation: "  " })?.explanation, null);
});
