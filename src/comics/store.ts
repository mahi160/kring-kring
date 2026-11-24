import type { DatabaseSync } from "node:sqlite";

const DHAKA_OFFSET_MS = 6 * 3_600_000; // ponytail: Dhaka has no DST; use Intl if that changes
const DAY_MS = 86_400_000;

export type ReactionKind = "like" | "laugh";
export const REACTION_KINDS: ReactionKind[] = ["like", "laugh"];

export interface Comic {
	id: number;
	source: string;
	sourceId: string;
	title: string;
	url: string;
	caption: string | null;
	/** Downloaded image's name under data/comics. */
	file: string;
}

export interface NewComic extends Omit<Comic, "id"> {}

/** Dhaka calendar day, YYYY-MM-DD. */
export function dhakaDay(now: Date): string {
	return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The day `n` days before `day` (both YYYY-MM-DD). */
export function daysBefore(day: string, n: number): string {
	return new Date(Date.parse(`${day}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
}

/** The calendar month before the one containing `day`, as YYYY-MM. */
export function previousMonth(day: string): string {
	return daysBefore(`${day.slice(0, 8)}01`, 1).slice(0, 7);
}

function toComic(row: Record<string, unknown> | undefined): Comic | null {
	if (!row) return null;
	return {
		id: Number(row.id),
		source: String(row.source),
		sourceId: String(row.source_id),
		title: String(row.title),
		url: String(row.url),
		caption: row.caption === null ? null : String(row.caption),
		file: String(row.file),
	};
}

/** Daily comics, which day showed which, and staff reactions. */
export class ComicStore {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		db.exec(`
			CREATE TABLE IF NOT EXISTS comics (
				id INTEGER PRIMARY KEY,
				source TEXT NOT NULL,
				source_id TEXT NOT NULL,
				title TEXT NOT NULL,
				url TEXT NOT NULL,
				caption TEXT,
				file TEXT NOT NULL,
				UNIQUE (source, source_id)
			);
			CREATE TABLE IF NOT EXISTS comic_days (
				day TEXT PRIMARY KEY,
				comic_id INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS comic_reactions (
				comic_id INTEGER NOT NULL,
				person_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				PRIMARY KEY (comic_id, person_id, kind)
			);
		`);
	}

	find(source: string, sourceId: string): Comic | null {
		return toComic(this.db.prepare("SELECT * FROM comics WHERE source = ? AND source_id = ?").get(source, sourceId));
	}

	/** Stores a downloaded comic (or returns the existing row for the same source and ID). */
	add(c: NewComic): Comic {
		this.db
			.prepare("INSERT OR IGNORE INTO comics (source, source_id, title, url, caption, file) VALUES (?, ?, ?, ?, ?, ?)")
			.run(c.source, c.sourceId, c.title, c.url, c.caption, c.file);
		return this.find(c.source, c.sourceId) as Comic;
	}

	/** The comic picked for exactly this day. */
	forDay(day: string): Comic | null {
		return toComic(
			this.db.prepare("SELECT c.* FROM comic_days d JOIN comics c ON c.id = d.comic_id WHERE d.day = ?").get(day),
		);
	}

	/** The comic to show on `day`: its own pick, else the most recent earlier one. */
	latest(day: string): Comic | null {
		return toComic(
			this.db
				.prepare("SELECT c.* FROM comic_days d JOIN comics c ON c.id = d.comic_id WHERE d.day <= ? ORDER BY d.day DESC LIMIT 1")
				.get(day),
		);
	}

	/** `source\nsourceId` keys of comics picked on or after `sinceDay`. */
	recentlyShown(sinceDay: string): Set<string> {
		const rows = this.db
			.prepare("SELECT c.source, c.source_id FROM comic_days d JOIN comics c ON c.id = d.comic_id WHERE d.day >= ?")
			.all(sinceDay);
		return new Set(rows.map((r) => comicKey(String(r.source), String(r.source_id))));
	}

	/** False if another caller already picked this day. */
	recordPick(day: string, comicId: number): boolean {
		return this.db.prepare("INSERT OR IGNORE INTO comic_days (day, comic_id) VALUES (?, ?)").run(day, comicId).changes > 0;
	}

	/** Adds the reaction, or removes it if present. Returns whether it is now on. */
	toggleReaction(comicId: number, personId: string, kind: ReactionKind): boolean {
		const { changes } = this.db
			.prepare("DELETE FROM comic_reactions WHERE comic_id = ? AND person_id = ? AND kind = ?")
			.run(comicId, personId, kind);
		if (changes > 0) return false;
		this.db.prepare("INSERT INTO comic_reactions (comic_id, person_id, kind) VALUES (?, ?, ?)").run(comicId, personId, kind);
		return true;
	}

	reactionCounts(comicId: number): Record<ReactionKind, number> {
		const counts = { like: 0, laugh: 0 };
		for (const r of this.db.prepare("SELECT kind, COUNT(*) AS n FROM comic_reactions WHERE comic_id = ? GROUP BY kind").all(comicId)) {
			if (r.kind === "like" || r.kind === "laugh") counts[r.kind] = Number(r.n);
		}
		return counts;
	}

	myReactions(comicId: number, personId: string): Record<ReactionKind, boolean> {
		const mine = { like: false, laugh: false };
		for (const r of this.db.prepare("SELECT kind FROM comic_reactions WHERE comic_id = ? AND person_id = ?").all(comicId, personId)) {
			if (r.kind === "like" || r.kind === "laugh") mine[r.kind] = true;
		}
		return mine;
	}

	/** Most-reacted comic shown in the Dhaka month `YYYY-MM`; earlier day wins ties; null with no reactions. */
	comicOfMonth(month: string): Comic | null {
		return toComic(
			this.db
				.prepare(
					`SELECT c.* FROM comic_days d
					JOIN comics c ON c.id = d.comic_id
					JOIN comic_reactions r ON r.comic_id = c.id
					WHERE substr(d.day, 1, 7) = ?
					GROUP BY d.day, c.id
					ORDER BY COUNT(*) DESC, d.day ASC
					LIMIT 1`,
				)
				.get(month),
		);
	}
}

export function comicKey(source: string, sourceId: string): string {
	return `${source}\n${sourceId}`;
}
