import type { APIRoute } from "astro";
import { dhakaDay, REACTION_KINDS } from "../comics/store.ts";
import { comicStore, currentStaffId, isCrossSite } from "../staff/index.ts";

export const POST: APIRoute = async ({ cookies, redirect, request }) => {
	if (isCrossSite(request)) return new Response("Cross-site request blocked", { status: 403 });
	const personId = currentStaffId(cookies);
	if (!personId) return redirect("/sign-in?next=/%23comic", 303);

	const form = await request.formData();
	const store = comicStore();
	const comic = store.latest(dhakaDay(new Date()));
	const kind = REACTION_KINDS.find((k) => k === form.get("kind"));
	// A stale form (yesterday's comic) must not react to today's.
	if (comic && kind && form.get("comic") === String(comic.id)) store.toggleReaction(comic.id, personId, kind);
	return redirect("/#comic", 303);
};
