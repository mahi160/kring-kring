import { getEmDashCollection } from "emdash";
import { dailyQuiz } from "../staff/index.ts";
import { quizClock, toQuizQuestion, type QuizClock, type QuizQuestion } from "../staff/quiz.ts";

/** Published, approved, well-formed questions. */
export async function quizBank(): Promise<QuizQuestion[]> {
	const { entries, error } = await getEmDashCollection("quiz_questions", { limit: 1000 });
	if (error) console.error("Failed to load quiz questions:", error);
	return entries.flatMap((e) => {
		const q = toQuizQuestion({ ...e.data, addedAt: (e.data.publishedAt ?? e.data.createdAt).getTime() });
		return q ? [q] : [];
	});
}

export async function todaysQuiz(now: Date): Promise<{ clock: QuizClock; question: QuizQuestion | null }> {
	const clock = quizClock(now);
	// Before 10:00 nothing is assigned or shown, so the question can't leak early.
	if (clock.phase === "closed-day" || clock.phase === "before") return { clock, question: null };
	return { clock, question: dailyQuiz().questionFor(clock, await quizBank()) };
}
