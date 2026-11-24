// The office is in Dhaka; format there regardless of the server's TZ.
const timeZone = "Asia/Dhaka";

const weekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" });
const month = new Intl.DateTimeFormat("en-GB", { timeZone, month: "long" });
const day = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric" });
const shortDate = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" });
const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" });
const shortMonth = new Intl.DateTimeFormat("en-GB", { timeZone, month: "short" });
const shortWeekday = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short" });
const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", minute: "2-digit", hour12: true });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatWeekday = (d: Date) => weekday.format(d);
export const formatMonth = (d: Date) => month.format(d);
export const formatDay = (d: Date) => day.format(d);
export const formatShortDate = (d: Date) => shortDate.format(d);
export const formatShortMonth = (d: Date) => shortMonth.format(d);
export const formatTime = (d: Date) => time.format(d);

/** "Today", "Tomorrow" or e.g. "Thu", relative to `now` in Dhaka. */
export function relativeDay(d: Date, now: Date): string {
	const key = dayKey.format(d);
	if (key === dayKey.format(now)) return "Today";
	if (key === dayKey.format(new Date(now.getTime() + 86_400_000))) return "Tomorrow";
	return shortWeekday.format(d);
}

export function greeting(d: Date): string {
	const h = Number(hour.format(d));
	if (h < 5) return "Burning the midnight oil?";
	if (h < 12) return "Good morning!";
	if (h < 17) return "Good afternoon!";
	return "Good evening!";
}

// Bangladesh work week: Sunday to Thursday.
const quips: Record<string, string> = {
	Sunday: "Fresh week, fresh start.",
	Monday: "The week is warming up.",
	Tuesday: "Halfway there, more or less.",
	Wednesday: "One more day after this one.",
	Thursday: "Last stretch before the weekend.",
	Friday: "It's the weekend. Go outside!",
	Saturday: "It's the weekend. Go outside!",
};

export const weekdayQuip = (d: Date) => quips[formatWeekday(d)] ?? "";
