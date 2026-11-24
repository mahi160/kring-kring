import { prop } from "./cached.ts";

export interface TeaStats {
	cupsToday: number;
	topItems: { name: string; quantity: number }[];
	busiestHour: number | null;
}

export const TEA_REFRESH_MS = 5 * 60_000;
const MAX_AGE_MS = 15 * 60_000;
const TIMEOUT_MS = 3_000;

const count = (v: unknown, what: string): number => {
	if (typeof v !== "number" || !Number.isInteger(v) || v < 0) throw new Error(`unexpected tea stats: ${what}`);
	return v;
};

function parseStats(body: unknown): TeaStats {
	const today = prop(body, "today");
	const week = prop(body, "week");
	const items = prop(week, "topItems");
	if (!Array.isArray(items)) throw new Error("unexpected tea stats: topItems");
	const hour = prop(week, "busiestHour");
	if (hour !== null && (typeof hour !== "number" || !Number.isInteger(hour) || hour < 0 || hour > 23)) {
		throw new Error("unexpected tea stats: busiestHour");
	}
	count(prop(today, "orders"), "today.orders");
	count(prop(week, "items"), "week.items");
	count(prop(body, "generatedAt"), "generatedAt");
	return {
		cupsToday: count(prop(today, "items"), "today.items"),
		topItems: items.map((item) => {
			const name = prop(item, "name");
			if (typeof name !== "string" || !name.trim()) throw new Error("unexpected tea stats: item name");
			return { name, quantity: count(prop(item, "quantity"), "item quantity") };
		}),
		busiestHour: hour,
	};
}

/** 16 -> "4 pm", 0 -> "12 am". */
export function formatHour(hour: number): string {
	return `${hour % 12 || 12} ${hour < 12 ? "am" : "pm"}`;
}

export function createTeaStats({
	fetchImpl = fetch,
	env = process.env,
	now = Date.now,
}: { fetchImpl?: typeof fetch; env?: Record<string, string | undefined>; now?: () => number } = {}) {
	let stored: { value: TeaStats | null; at: number } | undefined;

	async function load(url: string, token: string): Promise<TeaStats> {
		const res = await fetchImpl(url, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { authorization: `Bearer ${token}`, accept: "application/json" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		return parseStats(await res.json());
	}

	return {
		/** Fetches fresh stats; on any failure the card is hidden until the next success. Never throws. */
		async refresh(): Promise<void> {
			const url = env.TEA_STATS_URL;
			const token = env.TEA_STATS_TOKEN;
			if (!url || !token) {
				stored = undefined;
				return;
			}
			try {
				stored = { value: await load(url, token), at: now() };
			} catch (err) {
				console.warn("Tea stats unavailable:", err instanceof Error ? err.message : "unknown error");
				stored = { value: null, at: now() };
			}
		},
		/** Last stored stats if fetched within 15 minutes; no network. */
		latest(): TeaStats | null {
			return stored && now() - stored.at <= MAX_AGE_MS ? stored.value : null;
		},
	};
}

export const teaStats = createTeaStats();
