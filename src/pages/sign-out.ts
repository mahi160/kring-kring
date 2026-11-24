import type { APIRoute } from "astro";
import { isCrossSite, signOutStaff } from "../staff/index.ts";

// POST only, so a link or image can't sign someone out.
export const POST: APIRoute = ({ cookies, redirect, request }) => {
	if (isCrossSite(request)) return new Response("Cross-site request blocked", { status: 403 });
	signOutStaff(cookies);
	return redirect("/", 303);
};
