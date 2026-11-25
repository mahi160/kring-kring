import { dailyQuiz } from "../staff/index.ts";
import { quizClock, type QuizQuestion } from "../staff/quiz.ts";
import { monthlyTotals, scoreDays, scoringDays, streaks } from "../staff/scoring.ts";
import { MONTHS } from "./celebrations.ts";
import { displayName } from "./people.ts";
import { quizBank } from "./quiz.ts";

export interface LeaderboardRow {
	rank: number;
	personId: string;
	name: string;
	points: number;
}

export interface Leaderboard {
	monthLabel: string;
	/** Everyone with points this month. */
	rows: LeaderboardRow[];
	lastMonthLabel: string;
	/** Last month's final standings; rank 1 rows are the champion(s). */
	lastMonthRows: LeaderboardRow[];
	/** The signed-in person's standing, null when signed out. */
	me: { points: number; rank: number | null; currentStreak: number; bestStreak: number } | null;
}

function previousMonth(month: string): string {
	const [y, m] = month.split("-").map(Number);
	return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Highest points first, then by name; ties share a rank (1, 1, 3). People no longer in People are dropped. */
function rankRows(totals: Map<string, number>, names: Map<string, string>): LeaderboardRow[] {
	const sorted = [...totals]
		.flatMap(([personId, points]) => {
			const name = names.get(personId);
			return name === undefined ? [] : [{ personId, name, points }];
		})
		.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
	const rows: LeaderboardRow[] = [];
	for (const [i, r] of sorted.entries()) {
		rows.push({ ...r, rank: i > 0 && sorted[i - 1].points === r.points ? rows[i - 1].rank : i + 1 });
	}
	return rows;
}

export function buildLeaderboard(
	now: Date,
	bank: QuizQuestion[],
	people: { id: string; name: string }[],
	history: { days: { day: string; questionId: string }[]; answers: { day: string; personId: string; choice: number }[] },
	meId: string | null,
): Leaderboard {
	const clock = quizClock(now);
	const counted = scoringDays(history.days, bank, clock.day, clock.phase === "revealed");
	const scored = scoreDays(counted, history.answers);
	const month = clock.day.slice(0, 7);
	const lastMonth = previousMonth(month);
	const names = new Map(people.map((p) => [p.id, p.name]));

	const totals = monthlyTotals(scored, month);
	const rows = rankRows(totals, names);
	const lastMonthRows = rankRows(monthlyTotals(scored, lastMonth), names);
	const mine = meId ? streaks(counted, history.answers).get(meId) : undefined;
	return {
		monthLabel: MONTHS[Number(month.slice(5)) - 1],
		rows,
		lastMonthLabel: MONTHS[Number(lastMonth.slice(5)) - 1],
		lastMonthRows,
		me: meId
			? {
					points: totals.get(meId) ?? 0,
					rank: rows.find((r) => r.personId === meId)?.rank ?? null,
					currentStreak: mine?.current ?? 0,
					bestStreak: mine?.best ?? 0,
				}
			: null,
	};
}

export async function leaderboard(
	now: Date,
	people: { data: { id: string; name: string; preferred_name?: string | null } }[],
	meId: string | null,
): Promise<Leaderboard> {
	const bank = await quizBank();
	return buildLeaderboard(
		now,
		bank,
		people.map((p) => ({ id: p.data.id, name: displayName(p.data) })),
		dailyQuiz().history(quizClock(now).day),
		meId,
	);
}
