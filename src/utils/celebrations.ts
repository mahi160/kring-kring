export const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

export interface PersonLike {
	data: {
		birthday_month?: string | null;
		birthday_day?: number | null;
		hide_birthday?: boolean | null;
		joined_on?: string | null;
	};
}

export interface Celebration<T> {
	person: T;
	/** 0 = today, 1 = tomorrow, ... */
	inDays: number;
	/** Date (UTC midnight of the Dhaka calendar day) it falls on */
	on: Date;
}

const DAY_MS = 86_400_000;
const dhakaYmd = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Dhaka",
	year: "numeric",
	month: "numeric",
	day: "numeric",
});

/** The Dhaka calendar day of `d`, as year, 0-based month and day. */
function dhakaDay(d: Date) {
	const parts = Object.fromEntries(dhakaYmd.formatToParts(d).map((p) => [p.type, Number(p.value)]));
	return { y: parts.year, m: parts.month - 1, d: parts.day };
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Next date (today included) a yearly month/day recurs. Days past the month end, like 29 Feb in a non-leap year, fall on its last day. */
function nextOccurrence(today: { y: number; m: number; d: number }, m: number, d: number): Date {
	const start = Date.UTC(today.y, today.m, today.d);
	for (const y of [today.y, today.y + 1]) {
		const t = Date.UTC(y, m, Math.min(d, daysInMonth(y, m)));
		if (t >= start) return new Date(t);
	}
	throw new Error("unreachable: a date recurs within a year");
}

function within<T>(person: T, today: { y: number; m: number; d: number }, on: Date, days: number) {
	const inDays = Math.round((on.getTime() - Date.UTC(today.y, today.m, today.d)) / DAY_MS);
	return inDays <= days ? { person, inDays, on } : null;
}

const byDate = <T>(a: Celebration<T>, b: Celebration<T>) => a.inDays - b.inDays;

/** Birthdays today and in the next `days` days, soonest first. People who hid theirs are skipped. */
export function upcomingBirthdays<T extends PersonLike>(people: T[], now: Date, days = 14): Celebration<T>[] {
	const today = dhakaDay(now);
	const out: Celebration<T>[] = [];
	for (const p of people) {
		const m = MONTHS.findIndex((name) => name === p.data.birthday_month);
		const d = p.data.birthday_day;
		if (p.data.hide_birthday || m < 0 || !d) continue;
		const hit = within(p, today, nextOccurrence(today, m, d), days);
		if (hit) out.push(hit);
	}
	return out.sort(byDate);
}

/** Work anniversaries (1 year or more) today and in the next `days` days, soonest first. */
export function upcomingAnniversaries<T extends PersonLike>(
	people: T[],
	now: Date,
	days = 14,
): (Celebration<T> & { years: number })[] {
	const today = dhakaDay(now);
	const out: (Celebration<T> & { years: number })[] = [];
	for (const p of people) {
		if (!p.data.joined_on) continue;
		const joined = dhakaDay(new Date(p.data.joined_on));
		const on = nextOccurrence(today, joined.m, joined.d);
		const years = on.getUTCFullYear() - joined.y;
		const hit = years >= 1 && within(p, today, on, days);
		if (hit) out.push({ ...hit, years });
	}
	return out.sort(byDate);
}
