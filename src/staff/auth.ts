import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const MAX_TRIES = 3;
const LOCK_MS = 15 * 60_000;
const PIN = /^\d{4}$/;

export type VerifyResult =
	| { ok: true }
	| { ok: false; reason: "no-pin" }
	| { ok: false; reason: "locked"; lockedUntil: number }
	| { ok: false; reason: "wrong"; triesLeft: number };

export type SignInResult = { ok: true; token: string } | Exclude<VerifyResult, { ok: true }>;
export type ChangePinResult = VerifyResult | { ok: false; reason: "invalid-new-pin" };
export type ClaimPinResult = { ok: true; token: string } | { ok: false; reason: "invalid-new-pin" | "taken" };

export const isPinFormat = (pin: string) => PIN.test(pin);

function hashPin(pin: string, salt: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) =>
		scrypt(pin, salt, 32, (err, key) => (err ? reject(err) : resolve(key))),
	);
}

async function encodePin(pin: string): Promise<string> {
	const salt = randomBytes(16);
	return `${salt.toString("hex")}:${(await hashPin(pin, salt)).toString("hex")}`;
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
	const [salt, hash] = stored.split(":");
	if (!salt || !hash) return false;
	const expected = Buffer.from(hash, "hex");
	const actual = await hashPin(pin, Buffer.from(salt, "hex"));
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Staff PINs and sign-in sessions. Separate from EmDash admin accounts:
 * nothing here can authenticate to /_emdash.
 * Only scrypt hashes of PINs and SHA-256 hashes of session tokens are stored.
 */
export class StaffAuth {
	private db: DatabaseSync;
	private now: () => number;

	constructor(db: DatabaseSync, now: () => number = Date.now) {
		this.db = db;
		this.now = now;
		db.exec(`
			CREATE TABLE IF NOT EXISTS staff_pins (
				person_id TEXT PRIMARY KEY,
				pin_hash TEXT NOT NULL,
				set_at INTEGER NOT NULL,
				failed INTEGER NOT NULL DEFAULT 0,
				locked_until INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE IF NOT EXISTS staff_sessions (
				token_hash TEXT PRIMARY KEY,
				person_id TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS staff_sessions_person ON staff_sessions (person_id);
		`);
	}

	/** New random PIN for a person (first time or reset). Revokes their sessions. Returns the PIN once; only its hash is kept. */
	async issuePin(personId: string): Promise<string> {
		const pin = String(randomInt(0, 10_000)).padStart(4, "0");
		await this.storePin(personId, pin);
		this.db.prepare("DELETE FROM staff_sessions WHERE person_id = ?").run(personId);
		return pin;
	}

	/** Removes the PIN and signs the person out everywhere, so they choose a new one at next sign-in. */
	clearPin(personId: string): void {
		this.db.prepare("DELETE FROM staff_pins WHERE person_id = ?").run(personId);
		this.db.prepare("DELETE FROM staff_sessions WHERE person_id = ?").run(personId);
	}

	/** When the person's current PIN was set, or null if they have none. */
	pinSetAt(personId: string): Date | null {
		const row = this.db.prepare("SELECT set_at FROM staff_pins WHERE person_id = ?").get(personId);
		return typeof row?.set_at === "number" ? new Date(row.set_at) : null;
	}

	/** Lockout-aware PIN check: the third wrong try locks the person for 15 minutes. */
	async verify(personId: string, pin: string): Promise<VerifyResult> {
		const now = this.now();
		// Claim a try atomically *before* the slow hash check, so parallel
		// requests can't all slip past the counter. An expired lock restarts the count.
		const claimed = this.db
			.prepare(
				`UPDATE staff_pins SET
					failed = (CASE WHEN locked_until > 0 THEN 0 ELSE failed END) + 1,
					locked_until = CASE WHEN (CASE WHEN locked_until > 0 THEN 0 ELSE failed END) + 1 >= ?
						THEN ? ELSE 0 END
				WHERE person_id = ? AND locked_until <= ?
				RETURNING failed, pin_hash`,
			)
			.get(MAX_TRIES, now + LOCK_MS, personId, now);

		if (!claimed) {
			const row = this.db.prepare("SELECT locked_until FROM staff_pins WHERE person_id = ?").get(personId);
			if (!row) return { ok: false, reason: "no-pin" };
			return { ok: false, reason: "locked", lockedUntil: Number(row.locked_until) };
		}

		if (isPinFormat(pin) && (await pinMatches(pin, String(claimed.pin_hash)))) {
			this.db.prepare("UPDATE staff_pins SET failed = 0, locked_until = 0 WHERE person_id = ?").run(personId);
			return { ok: true };
		}
		const failed = Number(claimed.failed);
		if (failed >= MAX_TRIES) return { ok: false, reason: "locked", lockedUntil: now + LOCK_MS };
		return { ok: false, reason: "wrong", triesLeft: MAX_TRIES - failed };
	}

	async signIn(personId: string, pin: string): Promise<SignInResult> {
		const result = await this.verify(personId, pin);
		if (!result.ok) return result;
		return { ok: true, token: this.startSession(personId) };
	}

	/**
	 * First sign-in: someone with no PIN yet sets their own and is signed in.
	 * Only succeeds while no PIN exists, so it can't overwrite one; a wrong claim is fixed by an admin reset.
	 */
	async claimPin(personId: string, pin: string): Promise<ClaimPinResult> {
		if (!isPinFormat(pin)) return { ok: false, reason: "invalid-new-pin" };
		const inserted = this.db
			.prepare("INSERT INTO staff_pins (person_id, pin_hash, set_at) VALUES (?, ?, ?) ON CONFLICT (person_id) DO NOTHING")
			.run(personId, await encodePin(pin), this.now());
		if (inserted.changes === 0) return { ok: false, reason: "taken" };
		return { ok: true, token: this.startSession(personId) };
	}

	private startSession(personId: string): string {
		const token = randomBytes(32).toString("base64url");
		this.db
			.prepare("INSERT INTO staff_sessions (token_hash, person_id, created_at) VALUES (?, ?, ?)")
			.run(tokenHash(token), personId, this.now());
		return token;
	}

	personForToken(token: string): string | null {
		const row = this.db.prepare("SELECT person_id FROM staff_sessions WHERE token_hash = ?").get(tokenHash(token));
		return typeof row?.person_id === "string" ? row.person_id : null;
	}

	signOut(token: string): void {
		this.db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").run(tokenHash(token));
	}

	/** Change your own PIN. Wrong current PINs count toward the lockout. Other browsers are signed out. */
	async changePin(personId: string, currentPin: string, newPin: string, keepToken: string): Promise<ChangePinResult> {
		if (!isPinFormat(newPin)) return { ok: false, reason: "invalid-new-pin" };
		const result = await this.verify(personId, currentPin);
		if (!result.ok) return result;
		await this.storePin(personId, newPin);
		this.db
			.prepare("DELETE FROM staff_sessions WHERE person_id = ? AND token_hash != ?")
			.run(personId, tokenHash(keepToken));
		return { ok: true };
	}

	private async storePin(personId: string, pin: string): Promise<void> {
		const hash = await encodePin(pin);
		this.db
			.prepare(
				`INSERT INTO staff_pins (person_id, pin_hash, set_at) VALUES (?, ?, ?)
				ON CONFLICT (person_id) DO UPDATE SET
					pin_hash = excluded.pin_hash, set_at = excluded.set_at, failed = 0, locked_until = 0`,
			)
			.run(personId, hash, this.now());
	}
}
