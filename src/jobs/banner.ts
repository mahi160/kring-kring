import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AiClient } from "./ai.ts";

export const BANNERS_DIR = "./data/banners";
export const BANNER_SIZE = "768x256";
const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

export interface BannerTheme {
	/** Dhaka day the banner is for, YYYY-MM-DD. */
	day: string;
	weekday: string;
	/** Event titles that day; holidays are events too. */
	events: string[];
	birthdays: number;
}

/** Names stay out of the prompt: the model can't draw them and they'd come out garbled. */
export function bannerPrompt(t: BannerTheme): string {
	const motifs = [
		`a cheerful ${t.weekday} morning`,
		...t.events.slice(0, 2).map((e) => `a hint of "${e}"`),
		...(t.birthdays > 0 ? ["balloons and a small birthday cake"] : []),
	];
	return (
		`Playful flat illustration banner for an office noticeboard in Dhaka: ${motifs.join(", ")}. ` +
		"Warm paper texture, coral and marigold accents, sticky notes and tea cups, simple shapes, wide panorama. " +
		"No text, no letters, no words, no people's faces."
	);
}

export const bannerFile = (day: string) => `${day}.png`;

/**
 * Which day the next banner is for: today until 08:00 (the night window is still
 * open), tomorrow after that. Returns the day and its offset from today.
 */
export function bannerTarget(now: Date): { day: string; offset: 0 | 1 } {
	const local = new Date(now.getTime() + 6 * 3_600_000); // ponytail: Dhaka has no DST
	const offset = local.getUTCHours() < 8 ? 0 : 1;
	return { day: new Date(local.getTime() + offset * DAY_MS).toISOString().slice(0, 10), offset };
}

/** The image URL for a day, or null for the plain fallback banner. */
export const bannerSrc = (store: Pick<BannerStore, "forDay">, day: string) => {
	const file = store.forDay(day);
	return file ? `/banners/${file}` : null;
};

/** Which banner days exist, so the page can show one without touching the disk. */
export class BannerStore {
	private db: DatabaseSync;
	private dir: string;

	constructor(db: DatabaseSync, dir = BANNERS_DIR) {
		this.db = db;
		this.dir = dir;
		db.exec("CREATE TABLE IF NOT EXISTS banners (day TEXT PRIMARY KEY, file TEXT NOT NULL, created_at INTEGER NOT NULL)");
	}

	forDay(day: string): string | null {
		const row = this.db.prepare("SELECT file FROM banners WHERE day = ?").get(day);
		return row ? String(row.file) : null;
	}

	async save(day: string, png: Uint8Array, now: Date): Promise<void> {
		await mkdir(this.dir, { recursive: true });
		const file = bannerFile(day);
		await writeFile(path.join(this.dir, file), png);
		this.db.prepare("INSERT OR REPLACE INTO banners (day, file, created_at) VALUES (?, ?, ?)").run(day, file, now.getTime());
	}

	/** Removes banners older than 30 days, rows and files (including strays left by a crash). */
	async cleanup(now: Date): Promise<number> {
		const cutoff = new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString().slice(0, 10);
		this.db.prepare("DELETE FROM banners WHERE day < ?").run(cutoff);
		let removed = 0;
		const files = await readdir(this.dir).catch(() => []);
		for (const f of files) {
			const day = f.match(/^(\d{4}-\d{2}-\d{2})\.png$/)?.[1];
			if (day && day < cutoff) {
				await rm(path.join(this.dir, f), { force: true });
				removed++;
			}
		}
		return removed;
	}
}

export async function drawBanner(ai: AiClient, store: BannerStore, theme: BannerTheme, signal: AbortSignal, now: Date) {
	const png = await ai.image(bannerPrompt(theme), { signal, size: BANNER_SIZE });
	// PNG signature check: don't save an error page as a banner.
	if (png.length < 8 || png[0] !== 0x89 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) {
		throw new Error("image server returned something that isn't a PNG");
	}
	await store.save(theme.day, png, now);
	return `Banner for ${theme.day} saved (${Math.round(png.length / 1024)} KB).`;
}
