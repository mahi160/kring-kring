// Colour themes. To add one: add a `[data-theme="<id>"] { ... }` block in
// src/styles/themes.css and an entry in THEMES below (give it a `date` "MM-DD" to
// switch on automatically that day in Dhaka), then deploy. The admin Theme page
// and the "random" setting pick it up from this array.

export interface Theme {
	id: string;
	label: string;
	emoji: string;
	/** Browser UI colour (`<meta name="theme-color">`) */
	color: string;
	/** Fixed day (`MM-DD`, Dhaka) this theme applies automatically; omit for manual/weekday themes */
	date?: string;
}

export const THEMES: readonly Theme[] = [
	{ id: "sunday", label: "Sunday violet", emoji: "💜", color: "#8b5cf6" },
	{ id: "monday", label: "Monday indigo", emoji: "🫐", color: "#5c6bc0" },
	{ id: "tuesday", label: "Tuesday blue", emoji: "💙", color: "#2f80ed" },
	{ id: "wednesday", label: "Wednesday green", emoji: "🌿", color: "#34a853" },
	{ id: "thursday", label: "Thursday yellow", emoji: "🌻", color: "#f5c518" },
	{ id: "friday", label: "Friday orange", emoji: "🧡", color: "#fb8c00" },
	{ id: "saturday", label: "Saturday red", emoji: "❤️", color: "#e53935" },
	{ id: "halloween", label: "Halloween", emoji: "🎃", color: "#17101f", date: "10-31" },
	{ id: "gta6", label: "GTA VI sunset", emoji: "🌴", color: "#ff2e93" },
	{ id: "victory-day", label: "Victory Day", emoji: "🇧🇩", color: "#006a4e", date: "12-16" },
	{ id: "independence-day", label: "Independence Day", emoji: "🇧🇩", color: "#c4122a", date: "03-26" },
	{ id: "pohela-boishakh", label: "Pohela Boishakh", emoji: "🥭", color: "#e5252a", date: "04-14" },
	{ id: "eid", label: "Eid", emoji: "🌙", color: "#1f8a5b" },
	{ id: "new-year", label: "New Year", emoji: "🎉", color: "#f2b705", date: "01-01" },
	{ id: "winter", label: "Winter", emoji: "❄️", color: "#2b7fb8" },
	{ id: "harry-potter", label: "Harry Potter", emoji: "⚡", color: "#740001", date: "07-31" },
];

// Sunday first, matching Date#getUTCDay.
const WEEKDAY_IDS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export const THEME_SETTING_KEY = "theme";
export const DEFAULT_THEME_SETTING = "auto";

// The office is in Dhaka; "today" means Dhaka's date regardless of the server's TZ.
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" });

export function themeById(id: string): Theme | undefined {
	return THEMES.find((t) => t.id === id);
}

// FNV-1a: stable across restarts and servers, unlike Math.random.
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (const ch of text) {
		h ^= ch.codePointAt(0) ?? 0;
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** The theme id to render for `now`, given the saved setting ("auto" | "random" | theme id). */
export function resolveTheme(now: Date, setting: string | null | undefined): string {
	const explicit = setting ? themeById(setting) : undefined;
	if (explicit) return explicit.id;
	const today = dayKey.format(now); // YYYY-MM-DD
	if (setting === "random") return THEMES[hash(today) % THEMES.length].id;
	const special = THEMES.find((t) => t.date === today.slice(5));
	if (special) return special.id;
	return WEEKDAY_IDS[new Date(`${today}T00:00:00Z`).getUTCDay()];
}
