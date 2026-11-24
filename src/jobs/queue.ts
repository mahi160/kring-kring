import type { DatabaseSync } from "node:sqlite";

const DHAKA_OFFSET_MS = 6 * 3_600_000; // ponytail: Dhaka has no DST; use Intl if that changes
const IMAGE_WINDOW_START = 20; // 20:00–08:00 Dhaka, while nobody is in the office
const IMAGE_WINDOW_END = 8;

export type JobType = "text" | "image";
export type JobStatus = "queued" | "running" | "done" | "failed";

export interface Job {
	id: number;
	kind: string;
	type: JobType;
	payload: unknown;
	status: JobStatus;
	output: string | null;
	error: string | null;
	createdAt: number;
	startedAt: number | null;
	finishedAt: number | null;
}

export const TIMEOUT_MS: Record<JobType, number> = {
	text: 60_000,
	image: 20 * 60_000,
};

export function inImageWindow(now: Date): boolean {
	const hour = new Date(now.getTime() + DHAKA_OFFSET_MS).getUTCHours();
	return hour >= IMAGE_WINDOW_START || hour < IMAGE_WINDOW_END;
}

function toJob(row: Record<string, unknown>): Job {
	return {
		id: Number(row.id),
		kind: String(row.kind),
		type: row.type === "image" ? "image" : "text",
		payload: JSON.parse(String(row.payload)),
		status: String(row.status) as JobStatus,
		output: row.output == null ? null : String(row.output),
		error: row.error == null ? null : String(row.error),
		createdAt: Number(row.created_at),
		startedAt: row.started_at == null ? null : Number(row.started_at),
		finishedAt: row.finished_at == null ? null : Number(row.finished_at),
	};
}

/** Persistent FIFO of AI jobs. One runs at a time; a restart puts a running job back in the queue. */
export class JobQueue {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		db.exec(`
			CREATE TABLE IF NOT EXISTS jobs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				kind TEXT NOT NULL,
				type TEXT NOT NULL,
				payload TEXT NOT NULL,
				dedupe_key TEXT UNIQUE,
				status TEXT NOT NULL DEFAULT 'queued',
				output TEXT,
				error TEXT,
				created_at INTEGER NOT NULL,
				started_at INTEGER,
				finished_at INTEGER
			);
			CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status, id);
		`);
	}

	/**
	 * Adds a job. With a `key`, a job with the same key is only ever added once
	 * (e.g. "digest:2026-11-24"), whatever became of the first one.
	 */
	enqueue(kind: string, type: JobType, payload: unknown, now: Date, key?: string): number | null {
		const { changes, lastInsertRowid } = this.db
			.prepare("INSERT OR IGNORE INTO jobs (kind, type, payload, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?)")
			.run(kind, type, JSON.stringify(payload ?? null), key ?? null, now.getTime());
		return changes === 0 ? null : Number(lastInsertRowid);
	}

	hasKey(key: string): boolean {
		return !!this.db.prepare("SELECT 1 FROM jobs WHERE dedupe_key = ?").get(key);
	}

	/** After a restart nothing is really running; those jobs start again from the top. */
	recover(): number {
		return Number(this.db.prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'").run().changes);
	}

	/** Oldest runnable job, marked running; null if one is already running or none may run now. */
	claim(now: Date): Job | null {
		const types = inImageWindow(now) ? ["text", "image"] : ["text"];
		const row = this.db
			.prepare(
				`UPDATE jobs SET status = 'running', started_at = ?
				 WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND type IN (${types.map(() => "?").join(", ")}) ORDER BY id LIMIT 1)
				   AND NOT EXISTS (SELECT 1 FROM jobs WHERE status = 'running')
				 RETURNING *`,
			)
			.get(now.getTime(), ...types);
		return row ? toJob(row) : null;
	}

	finish(id: number, output: string, now: Date): void {
		this.db
			.prepare("UPDATE jobs SET status = 'done', output = ?, error = NULL, finished_at = ? WHERE id = ?")
			.run(output, now.getTime(), id);
	}

	fail(id: number, error: string, now: Date): void {
		this.db.prepare("UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(error, now.getTime(), id);
	}

	get(id: number): Job | null {
		const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
		return row ? toJob(row) : null;
	}

	list(limit = 25): Job[] {
		return this.db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit).map(toJob);
	}

	counts(): Record<JobStatus, number> {
		const counts: Record<JobStatus, number> = { queued: 0, running: 0, done: 0, failed: 0 };
		for (const row of this.db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all()) {
			counts[String(row.status) as JobStatus] = Number(row.n);
		}
		return counts;
	}

	/** Old finished jobs only clutter the admin list. */
	prune(before: Date): void {
		this.db.prepare("DELETE FROM jobs WHERE status IN ('done', 'failed') AND finished_at < ?").run(before.getTime());
	}
}

/** What every handler gets, plus the runner's shared dependencies `D`. */
export type JobContext<D> = D & { signal: AbortSignal; now: Date };

export type JobHandler<D> = (payload: unknown, ctx: JobContext<D>) => Promise<string>;

/**
 * Claims and runs one job. The handler gets an abort signal; if it ignores it, the
 * job is still marked failed at the deadline and its late result is dropped.
 */
export async function runNext<D extends object>(
	queue: JobQueue,
	handlers: Record<string, JobHandler<D>>,
	deps: D,
	clock: () => Date = () => new Date(),
	timeouts: Record<JobType, number> = TIMEOUT_MS,
): Promise<Job | null> {
	const job = queue.claim(clock());
	if (!job) return null;
	const handler = handlers[job.kind];
	if (!handler) {
		queue.fail(job.id, `Unknown job kind "${job.kind}"`, clock());
		return queue.get(job.id);
	}

	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(new Error(`Timed out after ${Math.round(timeouts[job.type] / 1000)} s`));
		}, timeouts[job.type]);
	});
	try {
		const output = await Promise.race([handler(job.payload, { ...deps, signal: controller.signal, now: clock() }), deadline]);
		queue.finish(job.id, output, clock());
	} catch (err) {
		queue.fail(job.id, err instanceof Error ? err.message : String(err), clock());
	} finally {
		clearTimeout(timer);
	}
	return queue.get(job.id);
}
