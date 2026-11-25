import { randomBytes } from "node:crypto";
import { defineMiddleware } from "astro:middleware";
import { dhakaDay } from "./comics/store.ts";
import { currentStaffId, visits } from "./staff/index.ts";

const VISITOR_COOKIE = "hub_visitor";
const VISITOR_ID = /^[A-Za-z0-9_-]{16,64}$/;
const YEAR_S = 365 * 86_400;

/** Counts successful page views for the admin Metrics page. Never blocks or fails the page. */
export const onRequest = defineMiddleware(async (context, next) => {
	const response = await next();
	const path = context.url.pathname;
	if (
		context.request.method !== "GET" ||
		response.status !== 200 ||
		!response.headers.get("content-type")?.startsWith("text/html") ||
		path.startsWith("/_")
	) {
		return response;
	}
	try {
		let visitor = context.cookies.get(VISITOR_COOKIE)?.value;
		if (!visitor || !VISITOR_ID.test(visitor)) {
			visitor = randomBytes(16).toString("base64url");
			context.cookies.set(VISITOR_COOKIE, visitor, { path: "/", httpOnly: true, sameSite: "lax", maxAge: YEAR_S });
		}
		// The route pattern (e.g. /people/[slug]) keeps the page list short.
		visits().record(dhakaDay(new Date()), visitor, currentStaffId(context.cookies), context.routePattern);
	} catch (err) {
		console.error("Failed to record visit:", err);
	}
	return response;
});
