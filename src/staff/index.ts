import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { AstroCookies } from "astro";
import { ComicStore } from "../comics/store.ts";
import { StaffAuth } from "./auth.ts";
import { DailyQuiz } from "./quiz.ts";
import { HubSettings } from "./settings.ts";
import { UploadLimit } from "./uploads.ts";

// Site-owned data (staff, quiz, comics, jobs) beside EmDash's hub.db; the name predates
// the other tables. Paths resolve against the service's WorkingDirectory.
const DB_PATH = "./data/staff.db";
export const COOKIE = "hub_staff";
// Browsers cap cookie lifetime at 400 days; "signed in until you sign out" in practice.
const MAX_AGE_S = 400 * 86_400;

let db: DatabaseSync | undefined;
let auth: StaffAuth | undefined;
let quiz: DailyQuiz | undefined;
let comics: ComicStore | undefined;
let settings: HubSettings | undefined;
let uploads: UploadLimit | undefined;

export function staffDb(): DatabaseSync {
	if (!db) {
		mkdirSync("./data", { recursive: true });
		db = new DatabaseSync(DB_PATH);
		db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
	}
	return db;
}

export function staffAuth(): StaffAuth {
	auth ??= new StaffAuth(staffDb());
	return auth;
}

export function dailyQuiz(): DailyQuiz {
	quiz ??= new DailyQuiz(staffDb());
	return quiz;
}

export function comicStore(): ComicStore {
	comics ??= new ComicStore(staffDb());
	return comics;
}

export function hubSettings(): HubSettings {
	settings ??= new HubSettings(staffDb());
	return settings;
}

export function uploadLimit(): UploadLimit {
	uploads ??= new UploadLimit(staffDb());
	return uploads;
}

/** The signed-in staff member's person ID, or null. */
export function currentStaffId(cookies: AstroCookies): string | null {
	const token = cookies.get(COOKIE)?.value;
	return token ? staffAuth().personForToken(token) : null;
}

export function setStaffCookie(cookies: AstroCookies, token: string): void {
	// Staff browse over plain HTTP, so no `secure`; httpOnly keeps it from page scripts.
	cookies.set(COOKIE, token, { path: "/", httpOnly: true, sameSite: "lax", maxAge: MAX_AGE_S });
}

export function signOutStaff(cookies: AstroCookies): void {
	const token = cookies.get(COOKIE)?.value;
	if (token) staffAuth().signOut(token);
	cookies.delete(COOKIE, { path: "/" });
}

/**
 * Blocks cross-site form posts (CSRF). EmDash turns off Astro's `checkOrigin`
 * and guards only its own routes, so the staff form pages check for themselves.
 */
export function isCrossSite(request: Request): boolean {
	const site = request.headers.get("sec-fetch-site");
	if (site) return site !== "same-origin" && site !== "none";
	const origin = request.headers.get("origin");
	if (!origin) return false; // non-browser client: carries no ambient cookie
	try {
		return new URL(origin).host !== request.headers.get("host");
	} catch {
		return true;
	}
}

/** Only same-site paths, so a crafted ?next= can't bounce staff to another site. */
export function safeNext(next: string | null | undefined): string {
	return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
