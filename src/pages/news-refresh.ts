import type { APIRoute } from "astro";
import { isCrossSite } from "../staff/index.ts";
import { refreshNews } from "../utils/news.ts";

export const POST: APIRoute = async ({ redirect, request }) => {
	if (isCrossSite(request)) return new Response("Cross-site request blocked", { status: 403 });
	await refreshNews();
	return redirect("/#news", 303);
};
