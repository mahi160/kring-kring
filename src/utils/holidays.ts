import { dhakaDay } from "../comics/store.ts";

export interface HolidayLike {
	data: { title: string; date: string; tentative?: boolean | null };
}

/** One holiday, possibly several days long. Days are Dhaka calendar days (YYYY-MM-DD). */
export interface Holiday {
	title: string;
	start: string;
	end: string;
	days: number;
	tentative: boolean;
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/** Midnight in Dhaka at the start of `day`, for formatting with the Dhaka formatters. */
export const dhakaMidnight = (day: string) => new Date(`${day}T00:00:00+06:00`);

/** Entries (one per day off) sorted and merged: back-to-back days with the same title become one holiday. */
export function groupHolidays(entries: HolidayLike[]): Holiday[] {
	const days = entries
		.map((e) => ({ title: e.data.title.trim(), day: dhakaDay(new Date(e.data.date)), tentative: Boolean(e.data.tentative) }))
		.sort((a, b) => a.day.localeCompare(b.day));
	const holidays: Holiday[] = [];
	for (const d of days) {
		const last = holidays.at(-1);
		if (last && last.title === d.title && daysBetween(last.end, d.day) === 1) {
			last.end = d.day;
			last.days++;
			last.tentative ||= d.tentative;
		} else {
			holidays.push({ title: d.title, start: d.day, end: d.day, days: 1, tentative: d.tentative });
		}
	}
	return holidays;
}

/** The holiday running on or coming after `today` (YYYY-MM-DD), with days until it starts (0 while on). */
export function nextHoliday(holidays: Holiday[], today: string): (Holiday & { inDays: number }) | null {
	const h = holidays.find((h) => h.end >= today);
	return h ? { ...h, inDays: Math.max(0, daysBetween(today, h.start)) } : null;
}
