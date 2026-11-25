import type { DatabaseSync } from "node:sqlite";

export interface DayStats {
	day: string;
	visitors: number;
	signedIn: number;
	views: number;
	quizAnswers: number;
}

export interface PersonActivity {
	personId: string;
	lastDay: string;
	days: number;
	views: number;
}

/**
 * Page-view counts for the admin Metrics page: one row per visitor per Dhaka day
 * (named when signed in) and one per page per day. Days are YYYY-MM-DD.
 */
export class Visits {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		db.exec(`
			CREATE TABLE IF NOT EXISTS visits (
				day TEXT NOT NULL,
				visitor TEXT NOT NULL,
				person_id TEXT,
				views INTEGER NOT NULL,
				PRIMARY KEY (day, visitor)
			);
			CREATE INDEX IF NOT EXISTS visits_person ON visits (person_id, day);
			CREATE TABLE IF NOT EXISTS page_views (
				day TEXT NOT NULL,
				page TEXT NOT NULL,
				views INTEGER NOT NULL,
				PRIMARY KEY (day, page)
			);
		`);
	}

	/** Counts one page view. A visitor who signs in mid-day keeps their name for that day. */
	record(day: string, visitor: string, personId: string | null, page: string): void {
		this.db
			.prepare(
				`INSERT INTO visits (day, visitor, person_id, views) VALUES (?, ?, ?, 1)
				ON CONFLICT (day, visitor) DO UPDATE SET views = views + 1, person_id = COALESCE(excluded.person_id, person_id)`,
			)
			.run(day, visitor, personId);
		this.db
			.prepare("INSERT INTO page_views (day, page, views) VALUES (?, ?, 1) ON CONFLICT (day, page) DO UPDATE SET views = views + 1")
			.run(day, page);
	}

	/** Per-day totals from `from` to `to` inclusive, newest first; days with no visits are left out. */
	daily(from: string, to: string): DayStats[] {
		const rows = this.db
			.prepare(
				`SELECT v.day, COUNT(*) AS visitors, COUNT(DISTINCT v.person_id) AS signed_in, SUM(v.views) AS views,
					(SELECT COUNT(*) FROM quiz_answers q WHERE q.day = v.day) AS quiz
				FROM visits v WHERE v.day BETWEEN ? AND ? GROUP BY v.day ORDER BY v.day DESC`,
			)
			.all(from, to);
		return rows.map((r) => ({
			day: String(r.day),
			visitors: Number(r.visitors),
			signedIn: Number(r.signed_in),
			views: Number(r.views),
			quizAnswers: Number(r.quiz),
		}));
	}

	/** Distinct visitors (browsers) between `from` and `to`. */
	uniqueVisitors(from: string, to: string): number {
		return Number(this.db.prepare("SELECT COUNT(DISTINCT visitor) AS n FROM visits WHERE day BETWEEN ? AND ?").get(from, to)?.n ?? 0);
	}

	/** Views per page between `from` and `to`, most viewed first. */
	pages(from: string, to: string): { page: string; views: number }[] {
		return this.db
			.prepare("SELECT page, SUM(views) AS views FROM page_views WHERE day BETWEEN ? AND ? GROUP BY page ORDER BY views DESC, page")
			.all(from, to)
			.map((r) => ({ page: String(r.page), views: Number(r.views) }));
	}

	/** Each signed-in person's last visit (ever) and active days and views between `from` and `to`. */
	people(from: string, to: string): PersonActivity[] {
		return this.db
			.prepare(
				`SELECT person_id, MAX(day) AS last_day,
					COUNT(DISTINCT CASE WHEN day BETWEEN ? AND ? THEN day END) AS days,
					SUM(CASE WHEN day BETWEEN ? AND ? THEN views ELSE 0 END) AS views
				FROM visits WHERE person_id IS NOT NULL GROUP BY person_id ORDER BY last_day DESC`,
			)
			.all(from, to, from, to)
			.map((r) => ({ personId: String(r.person_id), lastDay: String(r.last_day), days: Number(r.days), views: Number(r.views) }));
	}
}
