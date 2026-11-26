import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** An upvote (1) or a downvote (-1). */
export type Vote = 1 | -1;

/**
 * Up and down votes on ideas, one per person per idea. A vote is stored only as an HMAC of
 * idea and person under a secret kept out of the database, so staff.db alone
 * can't say who voted for what. Nothing here returns voters, only counts.
 */
export class IdeaVotes {
	private db: DatabaseSync;
	private secret: string;

	constructor(db: DatabaseSync, secret: string) {
		if (!secret) throw new Error("IdeaVotes needs a secret");
		this.db = db;
		this.secret = secret;
		// WITHOUT ROWID: rows sort by key, so storage order doesn't reveal voting order.
		db.exec(
			"CREATE TABLE IF NOT EXISTS idea_votes (idea_id TEXT NOT NULL, voter TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (idea_id, voter)) WITHOUT ROWID",
		);
		// Tables from before downvotes lack the column; their votes are all upvotes.
		if (!db.prepare("PRAGMA table_info(idea_votes)").all().some((c) => c.name === "value")) {
			db.exec("ALTER TABLE idea_votes ADD COLUMN value INTEGER NOT NULL DEFAULT 1");
		}
	}

	private voter(ideaId: string, personId: string): string {
		return createHmac("sha256", this.secret).update(`${ideaId}\n${personId}`).digest("base64url");
	}

	/** Casts the vote, replacing the other kind; the same vote again takes it back. Returns the vote now in place, 0 for none. */
	vote(ideaId: string, personId: string, value: Vote): Vote | 0 {
		const voter = this.voter(ideaId, personId);
		if (this.myVote(ideaId, personId) === value) {
			this.db.prepare("DELETE FROM idea_votes WHERE idea_id = ? AND voter = ?").run(ideaId, voter);
			return 0;
		}
		this.db
			.prepare(
				"INSERT INTO idea_votes (idea_id, voter, value) VALUES (?, ?, ?) ON CONFLICT (idea_id, voter) DO UPDATE SET value = excluded.value",
			)
			.run(ideaId, voter, value);
		return value;
	}

	/** This person's vote on the idea, 0 for none. */
	myVote(ideaId: string, personId: string): Vote | 0 {
		const row = this.db
			.prepare("SELECT value FROM idea_votes WHERE idea_id = ? AND voter = ?")
			.get(ideaId, this.voter(ideaId, personId));
		if (!row) return 0;
		return Number(row.value) < 0 ? -1 : 1;
	}

	/** Score (upvotes minus downvotes) per idea ID; ideas nobody voted on are absent. */
	scores(): Map<string, number> {
		const rows = this.db.prepare("SELECT idea_id, SUM(value) AS n FROM idea_votes GROUP BY idea_id").all();
		return new Map(rows.map((r) => [String(r.idea_id), Number(r.n)]));
	}
}
