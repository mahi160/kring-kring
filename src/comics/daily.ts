import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { comicStore } from "../staff/index.ts";
import { COMIC_SOURCES, archiveCandidate, xkcdLatest, type ComicCandidate } from "./sources.ts";
import { comicKey, daysBefore, dhakaDay, type Comic, type ComicStore } from "./store.ts";

export const COMICS_DIR = "./data/comics";
const NO_REPEAT_DAYS = 90;
const DOWNLOAD_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export interface DailyDeps {
	fetchImpl: typeof fetch;
	store: ComicStore;
	random: () => number;
	filesDir: string;
}

/** Downloads an image into `dir`; returns the file name, or null if it's slow, too big or not an image. */
async function download(imageUrl: string, name: string, { fetchImpl, filesDir }: DailyDeps): Promise<string | null> {
	try {
		const res = await fetchImpl(imageUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
		const ext = EXTENSIONS[(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase()];
		if (!res.ok || !ext || !res.body || Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
		const chunks: Uint8Array[] = [];
		let size = 0;
		for await (const chunk of res.body) {
			size += chunk.length;
			if (size > MAX_IMAGE_BYTES) return null;
			chunks.push(chunk);
		}
		await mkdir(filesDir, { recursive: true });
		const file = `${name}.${ext}`;
		await writeFile(join(filesDir, file), Buffer.concat(chunks));
		return file;
	} catch {
		return null;
	}
}

/** Makes the candidate today's comic, downloading its image only if we've never had it. */
async function adopt(c: ComicCandidate, day: string, deps: DailyDeps): Promise<Comic | null> {
	let comic = deps.store.find(c.source, c.sourceId);
	if (!comic) {
		const name = createHash("sha1").update(comicKey(c.source, c.sourceId)).digest("hex").slice(0, 20);
		const file = await download(c.imageUrl, name, deps);
		if (!file) return null;
		comic = deps.store.add({ source: c.source, sourceId: c.sourceId, title: c.title, url: c.url, caption: c.caption, file });
	}
	return deps.store.recordPick(day, comic.id) ? comic : deps.store.forDay(day);
}

async function pick(day: string, deps: DailyDeps): Promise<Comic | null> {
	const { fetchImpl, store, random } = deps;
	try {
		const latest = await xkcdLatest(fetchImpl);
		if (!store.find(latest.source, latest.sourceId)) {
			const comic = await adopt(latest, day, deps);
			if (comic) return comic;
		}
	} catch {
		// xkcd down: fall back to the archive
	}
	const recent = store.recentlyShown(daysBefore(day, NO_REPEAT_DAYS));
	const isExcluded = (source: string, sourceId: string) => recent.has(comicKey(source, sourceId));
	const order = [...COMIC_SOURCES].sort(() => random() - 0.5);
	for (const source of order) {
		try {
			const candidate = await archiveCandidate(source, { fetchImpl, random, isExcluded });
			const comic = candidate && (await adopt(candidate, day, deps));
			if (comic) return comic;
		} catch {
			// source down: try the next one
		}
	}
	return null;
}

const inflight = new WeakMap<ComicStore, Promise<Comic | null>>();

/**
 * Picks today's (Dhaka) comic if there isn't one yet. Null when nothing could be picked;
 * the page then keeps showing the latest earlier comic.
 */
export function ensureTodaysComic(now: Date, deps: DailyDeps): Promise<Comic | null> {
	const day = dhakaDay(now);
	const existing = deps.store.forDay(day);
	if (existing) return Promise.resolve(existing);
	let run = inflight.get(deps.store);
	if (!run) {
		run = pick(day, deps).finally(() => inflight.delete(deps.store));
		inflight.set(deps.store, run);
	}
	return run;
}

export function pickTodaysComic(now: Date = new Date()): Promise<Comic | null> {
	return ensureTodaysComic(now, { fetchImpl: fetch, store: comicStore(), random: Math.random, filesDir: COMICS_DIR });
}
