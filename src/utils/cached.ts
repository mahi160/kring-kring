export interface CacheOptions {
	/** How long a good value stays fresh, in ms; may depend on the current time (e.g. "until midnight"). */
	ttlMs: number | ((now: number) => number);
	/** After a failure, wait this long before trying again, so a dead API isn't hit on every page view. */
	retryMs?: number;
	now?: () => number;
	/** Name used in the warning logged on failure. */
	label: string;
}

/**
 * Wraps a loader in an in-memory cache. Concurrent callers share one load.
 * Never throws: on failure the getter resolves to null and a warning is logged.
 * `.fetchedAt()` is when the current value was loaded (null if none or the last load failed);
 * `.refresh()` forces a reload, sharing any load already in flight.
 */
export function cached<T>(load: () => Promise<T>, { ttlMs, retryMs = 60_000, now = Date.now, label }: CacheOptions) {
	let cache: { value: T | null; until: number; at: number | null } | undefined;
	let inflight: Promise<T | null> | undefined;

	async function load1(): Promise<T | null> {
		try {
			const value = await load();
			const t = now();
			cache = { value, until: t + (typeof ttlMs === "function" ? ttlMs(t) : ttlMs), at: t };
			return value;
		} catch (err) {
			console.warn(`${label} unavailable:`, err instanceof Error ? err.message : err);
			cache = { value: null, until: now() + retryMs, at: null };
			return null;
		}
	}

	function refresh(): Promise<T | null> {
		inflight ??= load1().finally(() => {
			inflight = undefined;
		});
		return inflight;
	}

	function get(): Promise<T | null> {
		if (cache && now() < cache.until) return Promise.resolve(cache.value);
		return refresh();
	}

	return Object.assign(get, { refresh, fetchedAt: (): number | null => cache?.at ?? null });
}

const TIMEOUT_MS = 3_000;
// Wikimedia asks API clients to identify themselves.
const USER_AGENT = "OfficeHub/1.0 (internal office dashboard)";

/** GET a URL and parse JSON; throws on network errors, timeouts and non-2xx statuses. */
export async function fetchJson(url: string, fetchImpl: typeof fetch = fetch): Promise<unknown> {
	const res = await fetchImpl(url, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { "user-agent": USER_AGENT, accept: "application/json" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
	return res.json();
}

/** GET a URL as text; throws on network errors, timeouts and non-2xx statuses. */
export async function fetchText(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
	const res = await fetchImpl(url, {
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/xml, text/xml" },
	});
	if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
	return res.text();
}

/** Read `obj.key` from untrusted JSON without assuming its shape. */
export const prop = (obj: unknown, key: string): unknown =>
	typeof obj === "object" && obj !== null ? Reflect.get(obj, key) : undefined;
