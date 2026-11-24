import type { DatabaseSync } from "node:sqlite";

/** Counts gallery uploads per person per Dhaka day, so one person can't flood the wall. */
export class UploadLimit {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		db.exec(
			"CREATE TABLE IF NOT EXISTS gallery_uploads (person TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (person, day))",
		);
	}

	/** Counts one upload and returns true, or returns false (counting nothing) once `max` is reached today. */
	take(person: string, day: string, max: number): boolean {
		const result = this.db
			.prepare(
				"INSERT INTO gallery_uploads (person, day, count) VALUES (?, ?, 1) ON CONFLICT(person, day) DO UPDATE SET count = count + 1 WHERE count < ?",
			)
			.run(person, day, max);
		return result.changes > 0;
	}

	/** Gives back a slot when the upload failed after it was taken. */
	release(person: string, day: string): void {
		this.db.prepare("UPDATE gallery_uploads SET count = count - 1 WHERE person = ? AND day = ? AND count > 0").run(person, day);
	}
}
