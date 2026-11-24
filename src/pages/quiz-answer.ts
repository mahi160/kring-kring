import type { APIRoute } from "astro";
import { currentStaffId, dailyQuiz, isCrossSite } from "../staff/index.ts";
import { todaysQuiz } from "../utils/quiz.ts";

export const POST: APIRoute = async ({ cookies, redirect, request }) => {
	if (isCrossSite(request)) return new Response("Cross-site request blocked", { status: 403 });
	const personId = currentStaffId(cookies);
	if (!personId) return redirect("/sign-in?next=/%23quiz", 303);

	const form = await request.formData();
	const now = new Date();
	const { clock, question } = await todaysQuiz(now);
	// A stale form (yesterday's or a swapped question) must not count against today's.
	if (!question || form.get("question") !== question.id) return redirect("/#quiz", 303);

	// The card itself shows the outcome: locked in, already answered, or closed.
	dailyQuiz().answer(clock, question, personId, Number(form.get("choice")), now);
	return redirect("/#quiz", 303);
};
