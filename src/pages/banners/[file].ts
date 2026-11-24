import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { APIRoute } from "astro";
import { BANNERS_DIR } from "../../jobs/banner.ts";

export const GET: APIRoute = async ({ params }) => {
	const name = params.file ?? "";
	if (!/^\d{4}-\d{2}-\d{2}\.png$/.test(name)) return new Response("Not found", { status: 404 });
	try {
		// A day's banner is written once, so it can be cached for good.
		return new Response(await readFile(join(BANNERS_DIR, name)), {
			headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
		});
	} catch {
		return new Response("Not found", { status: 404 });
	}
};
