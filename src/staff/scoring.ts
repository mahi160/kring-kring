const POINTS_PER_CORRECT = 10;
const MAX_STREAK_BONUS = 10;

export interface ScoredDay {
	day: string;
	personId: string;
	points: number;
}

/**
 * Quiz days that count: past days always, today only once revealed (so results never leak),
 * and only those whose question still exists in the bank. Correctness uses the bank's current answer.
 */
export function scoringDays(
	days: { day: string; questionId: string }[],
	bank: { id: string; correct: number }[],
	today: string,
	todayRevealed: boolean,
): { day: string; correct: number }[] {
	const correctById = new Map(bank.map((q) => [q.id, q.correct]));
	return days.flatMap((d) => {
		const correct = correctById.get(d.questionId);
		if (correct === undefined || d.day > today || (d.day === today && !todayRevealed)) return [];
		return [{ day: d.day, correct }];
	});
}

/**
 * Points per person per quiz day. Streak = consecutive quiz days answered correctly;
 * a wrong answer or no answer resets it. Non-quiz days aren't in `days`, so they don't break it.
 */
export function scoreDays(
	days: { day: string; correct: number }[],
	answers: { day: string; personId: string; choice: number }[],
): ScoredDay[] {
	const byDay = new Map<string, Map<string, number>>();
	const people = new Set<string>();
	for (const a of answers) {
		people.add(a.personId);
		if (!byDay.has(a.day)) byDay.set(a.day, new Map());
		byDay.get(a.day)?.set(a.personId, a.choice);
	}
	const streaks = new Map<string, number>();
	const scored: ScoredDay[] = [];
	for (const { day, correct } of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
		for (const personId of people) {
			if (byDay.get(day)?.get(personId) !== correct) {
				streaks.set(personId, 0);
				continue;
			}
			const streak = (streaks.get(personId) ?? 0) + 1;
			streaks.set(personId, streak);
			scored.push({ day, personId, points: POINTS_PER_CORRECT + Math.min(2 * (streak - 1), MAX_STREAK_BONUS) });
		}
	}
	return scored;
}

/** Points per person for one Dhaka month ('YYYY-MM'). */
export function monthlyTotals(scored: ScoredDay[], month: string): Map<string, number> {
	const totals = new Map<string, number>();
	for (const s of scored) {
		if (s.day.startsWith(month)) totals.set(s.personId, (totals.get(s.personId) ?? 0) + s.points);
	}
	return totals;
}

/** Everyone tied for the highest total that month; empty if nobody scored. */
export function monthWinners(scored: ScoredDay[], month: string): string[] {
	const totals = monthlyTotals(scored, month);
	const best = Math.max(0, ...totals.values());
	return best === 0 ? [] : [...totals].filter(([, p]) => p === best).map(([id]) => id);
}

/**
 * Current and best run of consecutive correct quiz days per person who ever answered.
 * Same rules as scoreDays: a wrong answer or a missed quiz day ends the run.
 */
export function streaks(
	days: { day: string; correct: number }[],
	answers: { day: string; personId: string; choice: number }[],
): Map<string, { current: number; best: number }> {
	const choices = new Map<string, number>();
	const result = new Map<string, { current: number; best: number }>();
	for (const a of answers) {
		choices.set(`${a.day}|${a.personId}`, a.choice);
		result.set(a.personId, { current: 0, best: 0 });
	}
	for (const { day, correct } of [...days].sort((a, b) => a.day.localeCompare(b.day))) {
		for (const [personId, s] of result) {
			s.current = choices.get(`${day}|${personId}`) === correct ? s.current + 1 : 0;
			s.best = Math.max(s.best, s.current);
		}
	}
	return result;
}
