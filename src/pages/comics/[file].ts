import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { APIRoute } from "astro";
import { COMICS_DIR } from "../../comics/daily.ts";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export const GET: APIRoute = async ({ params }) => {
	const match = /^[a-f0-9]{20}\.(png|jpg|gif|webp)$/.exec(params.file ?? "");
	if (!match) return new Response("Not found", { status: 404 });
	try {
		const body = await readFile(join(COMICS_DIR, match[0]));
		return new Response(body, {
			headers: { "content-type": TYPES[match[1]], "cache-control": "public, max-age=31536000, immutable" },
		});
	} catch {
		return new Response("Not found", { status: 404 });
	}
};
