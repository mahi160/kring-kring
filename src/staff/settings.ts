import type { DatabaseSync } from "node:sqlite";

/** Small key-value store for hub settings that admins change from the admin UI. */
export class HubSettings {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		db.exec("CREATE TABLE IF NOT EXISTS hub_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
	}

	get(key: string): string | null {
		const row = this.db.prepare("SELECT value FROM hub_settings WHERE key = ?").get(key);
		return typeof row?.value === "string" ? row.value : null;
	}

	set(key: string, value: string): void {
		this.db
			.prepare("INSERT INTO hub_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
			.run(key, value);
	}
}
