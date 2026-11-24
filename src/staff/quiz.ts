import type { DatabaseSync } from "node:sqlite";

const DHAKA_OFFSET_MS = 6 * 3_600_000; // ponytail: Dhaka has no DST; use Intl if that changes
const HOUR_MS = 3_600_000;
const OPEN_HOUR = 10;
const REVEAL_HOUR = 18;
const WORKING_DAYS = new Set([0, 1, 2, 3, 4]); // Sunday–Thursday

export interface QuizQuestion {
	id: string;
	question: string;
	choices: string[];
	/** Index into `choices`. */
	correct: number;
	explanation: string | null;
	/** Bank order: unused questions are asked oldest first. */
	addedAt: number;
}

/** What the page may see. `correct` and `explanation` stay server-side until the reveal. */
export type QuizView = Omit<QuizQuestion, "correct" | "explanation" | "addedAt"> & {
	correct?: number;
	explanation?: string | null;
};

export type QuizPhase = "closed-day" | "before" | "open" | "revealed";

export interface QuizClock {
	/** Dhaka calendar day, YYYY-MM-DD. */
	day: string;
	phase: QuizPhase;
	opensAt: Date;
	revealAt: Date;
}

export type AnswerResult = "ok" | "already-answered" | "closed" | "invalid-choice";

export function quizClock(now: Date): QuizClock {
	const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
	const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - DHAKA_OFFSET_MS;
	const opensAt = new Date(midnight + OPEN_HOUR * HOUR_MS);
	const revealAt = new Date(midnight + REVEAL_HOUR * HOUR_MS);
	const phase: QuizPhase = !WORKING_DAYS.has(local.getUTCDay())
		? "closed-day"
		: now < opensAt
			? "before"
			: now < revealAt
				? "open"
				: "revealed";
	return { day: local.toISOString().slice(0, 10), phase, opensAt, revealAt };
}

/** When the next quiz opens, as words: "tomorrow" or "on Sunday". */
export function nextQuizDay(clock: QuizClock): string {
	const weekday = new Date(`${clock.day}T00:00:00Z`).getUTCDay();
	if (clock.phase === "before") return "today";
	return weekday === 4 || weekday === 5 ? "on Sunday" : "tomorrow";
}

export function publicView(q: QuizQuestion, phase: QuizPhase): QuizView {
	const { id, question, choices } = q;
	return phase === "revealed" ? { id, question, choices, correct: q.correct, explanation: q.explanation } : { id, question, choices };
}

/** CMS entry → question; null when it isn't usable (unapproved, too few choices, bad answer number). */
export function toQuizQuestion(e: {
	id: string;
	question: string;
	choices?: { label?: string | null }[] | null;
	correct_choice?: number | null;
	explanation?: string | null;
	approved?: boolean | null;
	addedAt: number;
}): QuizQuestion | null {
	const choices = (e.choices ?? []).map((c) => c.label?.trim() ?? "").filter(Boolean);
	const correct = (e.correct_choice ?? 0) - 1;
	if (e.approved !== true || choices.length < 2 || choices.length > 4 || !(correct >= 0 && correct < choices.length)) {
		return null;
	}
	return { id: e.id, question: e.question, choices, correct, explanation: e.explanation?.trim() || null, addedAt: e.addedAt };
}

/** Daily quiz state: which question each working day got, and staff answers. */
export class DailyQuiz {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		db.exec(`
			CREATE TABLE IF NOT EXISTS quiz_days (
				day TEXT PRIMARY KEY,
				question_id TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS quiz_answers (
				day TEXT NOT NULL,
				person_id TEXT NOT NULL,
				choice INTEGER NOT NULL,
				answered_at INTEGER NOT NULL,
				PRIMARY KEY (day, person_id)
			);
		`);
	}

	/**
	 * Today's question, assigning one on first need. Days are only assigned before the
	 * reveal, so a question nobody saw is never burned. Null on non-working days, with an
	 * empty bank, or if the assigned question has since been removed or unapproved.
	 */
	questionFor(clock: QuizClock, bank: QuizQuestion[]): QuizQuestion | null {
		if (clock.phase === "closed-day") return null;
		let row = this.db.prepare("SELECT question_id FROM quiz_days WHERE day = ?").get(clock.day);
		if (!row && clock.phase !== "revealed") {
			const pick = this.pick(bank, clock.day);
			if (!pick) return null;
			// OR IGNORE: a concurrent request may have assigned the day first; re-read the winner.
			this.db.prepare("INSERT OR IGNORE INTO quiz_days (day, question_id) VALUES (?, ?)").run(clock.day, pick.id);
			row = this.db.prepare("SELECT question_id FROM quiz_days WHERE day = ?").get(clock.day);
		}
		return bank.find((q) => q.id === row?.question_id) ?? null;
	}

	answer(clock: QuizClock, question: QuizQuestion, personId: string, choice: number, now: Date): AnswerResult {
		if (clock.phase !== "open") return "closed";
		if (!Number.isInteger(choice) || choice < 0 || choice >= question.choices.length) return "invalid-choice";
		const { changes } = this.db
			.prepare("INSERT OR IGNORE INTO quiz_answers (day, person_id, choice, answered_at) VALUES (?, ?, ?, ?)")
			.run(clock.day, personId, choice, now.getTime());
		return changes === 0 ? "already-answered" : "ok";
	}

	answerOf(day: string, personId: string): number | null {
		const row = this.db.prepare("SELECT choice FROM quiz_answers WHERE day = ? AND person_id = ?").get(day, personId);
		return typeof row?.choice === "number" ? row.choice : null;
	}

	stats(day: string, question: QuizQuestion): { answered: number; correct: number } {
		const row = this.db
			.prepare("SELECT COUNT(*) AS answered, COALESCE(SUM(choice = ?), 0) AS correct FROM quiz_answers WHERE day = ?")
			.get(question.correct, day);
		return { answered: Number(row?.answered ?? 0), correct: Number(row?.correct ?? 0) };
	}

	/** Every quiz day and answer up to and including `throughDay`, for scoring. */
	history(throughDay: string): {
		days: { day: string; questionId: string }[];
		answers: { day: string; personId: string; choice: number }[];
	} {
		const days = this.db.prepare("SELECT day, question_id FROM quiz_days WHERE day <= ? ORDER BY day").all(throughDay);
		const answers = this.db.prepare("SELECT day, person_id, choice FROM quiz_answers WHERE day <= ?").all(throughDay);
		return {
			days: days.map((r) => ({ day: String(r.day), questionId: String(r.question_id) })),
			answers: answers.map((r) => ({ day: String(r.day), personId: String(r.person_id), choice: Number(r.choice) })),
		};
	}

	/** Oldest never-asked question; once the bank is exhausted, the one asked longest ago. */
	private pick(bank: QuizQuestion[], today: string): QuizQuestion | null {
		const rows = this.db
			.prepare("SELECT question_id, MAX(day) AS last FROM quiz_days WHERE day < ? GROUP BY question_id")
			.all(today);
		const lastUsed = new Map(rows.map((r) => [String(r.question_id), String(r.last)]));
		const sorted = [...bank].sort(
			(a, b) =>
				(lastUsed.get(a.id) ?? "").localeCompare(lastUsed.get(b.id) ?? "") ||
				a.addedAt - b.addedAt ||
				a.id.localeCompare(b.id),
		);
		return sorted[0] ?? null;
	}
}
