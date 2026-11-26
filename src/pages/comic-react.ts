import type { APIRoute } from "astro";
import { getEmDashCollection } from "emdash";
import { reactionViews } from "../comics/reactions.ts";
import { dhakaDay, REACTION_KINDS } from "../comics/store.ts";
import { comicStore, currentStaffId, isCrossSite } from "../staff/index.ts";
import { displayName } from "../utils/people";

// The comic card posts here with fetch (JSON reply, updated in place); without JS it is a plain form post.
export const POST: APIRoute = async ({ cookies, redirect, request }) => {
	if (isCrossSite(request)) return new Response("Cross-site request blocked", { status: 403 });
	const wantsJson = request.headers.get("accept")?.includes("application/json") ?? false;
	const personId = currentStaffId(cookies);
	if (!personId) return wantsJson ? Response.json({ signIn: "/sign-in?next=/%23comic" }, { status: 401 }) : redirect("/sign-in?next=/%23comic", 303);

	const form = await request.formData();
	const store = comicStore();
	const comic = store.latest(dhakaDay(new Date()));
	const kind = REACTION_KINDS.find((k) => k === form.get("kind"));
	// A stale form (yesterday's comic) must not react to today's.
	const current = comic !== null && form.get("comic") === String(comic.id);
	if (current && kind) store.toggleReaction(comic.id, personId, kind);
	if (!wantsJson) return redirect("/#comic", 303);
	if (!current) return Response.json({ stale: true }, { status: 409 });

	const { entries, error } = await getEmDashCollection("people", { limit: 1000 });
	if (error) console.error("Failed to load people:", error);
	const names = new Map(entries.map((p) => [p.data.id, displayName(p.data)]));
	return Response.json({ reactions: reactionViews(store.reactors(comic.id), (id) => names.get(id), personId) });
};
