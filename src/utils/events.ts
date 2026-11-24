export interface EventLike {
	data: { starts_at: string; ends_at?: string | null };
}

const DAY_MS = 86_400_000;
const DHAKA_OFFSET_MS = 6 * 3_600_000; // ponytail: Dhaka has no DST; use Intl if that changes

/** Midnight at the end of the Dhaka calendar day containing `d`. */
export function endOfDhakaDay(d: Date): Date {
	const local = d.getTime() + DHAKA_OFFSET_MS;
	return new Date(Math.floor(local / DAY_MS) * DAY_MS + DAY_MS - DHAKA_OFFSET_MS);
}

/** When an event stops being upcoming: its end, or the end of its start day if it has none. */
export function eventEnd(e: EventLike): Date {
	return e.data.ends_at ? new Date(e.data.ends_at) : endOfDhakaDay(new Date(e.data.starts_at));
}

/** Events not yet over, soonest first. */
export function upcomingEvents<T extends EventLike>(entries: T[], now: Date, limit: number): T[] {
	return entries
		.filter((e) => eventEnd(e).getTime() > now.getTime())
		.sort((a, b) => new Date(a.data.starts_at).getTime() - new Date(b.data.starts_at).getTime())
		.slice(0, limit);
}
