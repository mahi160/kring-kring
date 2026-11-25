import { createHmac } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * Upvotes on ideas, one per person per idea. A vote is stored only as an HMAC of
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
			"CREATE TABLE IF NOT EXISTS idea_votes (idea_id TEXT NOT NULL, voter TEXT NOT NULL, PRIMARY KEY (idea_id, voter)) WITHOUT ROWID",
		);
	}

	private voter(ideaId: string, personId: string): string {
		return createHmac("sha256", this.secret).update(`${ideaId}\n${personId}`).digest("base64url");
	}

	/** Adds the vote, or removes it if present. Returns whether it is now on. */
	toggle(ideaId: string, personId: string): boolean {
		const voter = this.voter(ideaId, personId);
		if (this.db.prepare("DELETE FROM idea_votes WHERE idea_id = ? AND voter = ?").run(ideaId, voter).changes > 0) return false;
		this.db.prepare("INSERT INTO idea_votes (idea_id, voter) VALUES (?, ?)").run(ideaId, voter);
		return true;
	}

	hasVoted(ideaId: string, personId: string): boolean {
		return !!this.db.prepare("SELECT 1 FROM idea_votes WHERE idea_id = ? AND voter = ?").get(ideaId, this.voter(ideaId, personId));
	}

	/** Votes per idea ID; ideas with none are absent. */
	counts(): Map<string, number> {
		const rows = this.db.prepare("SELECT idea_id, COUNT(*) AS n FROM idea_votes GROUP BY idea_id").all();
		return new Map(rows.map((r) => [String(r.idea_id), Number(r.n)]));
	}
}
