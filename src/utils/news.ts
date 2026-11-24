import { cached, fetchText } from "./cached.ts";

export interface Headline {
	title: string;
	url: string;
}

export interface NewsSource {
	id: string;
	name: string;
	feed: string;
	/** Homepage, for the credit line. */
	home: string;
	/** BCP 47 tag of the headlines; omit when the page language applies. */
	lang?: string;
	tab: string;
	/** Restrict headline links to these hosts (and subdomains); omit to accept any http(s) link. */
	hosts?: string[];
}

/** To add a feed, append an RSS 2.0 (`<item>`) source here; a new `tab` name creates a new tab. */
export const NEWS_SOURCES: NewsSource[] = [
	{ id: "prothom-alo", name: "Prothom Alo", feed: "https://www.prothomalo.com/feed/", home: "https://www.prothomalo.com/", lang: "bn", tab: "Bangladesh", hosts: ["prothomalo.com"] },
	{ id: "daily-star", name: "The Daily Star", feed: "https://www.thedailystar.net/top-news/rss.xml", home: "https://www.thedailystar.net/", lang: "en", tab: "Bangladesh" },
	{ id: "omg-ubuntu", name: "OMG! Ubuntu", feed: "https://www.omgubuntu.co.uk/feed", home: "https://www.omgubuntu.co.uk/", tab: "Linux" },
	{ id: "techcrunch-ai", name: "TechCrunch AI", feed: "https://techcrunch.com/category/artificial-intelligence/feed/", home: "https://techcrunch.com/category/artificial-intelligence/", tab: "AI" },
	{ id: "hacker-news", name: "Hacker News", feed: "https://hnrss.org/frontpage", home: "https://news.ycombinator.com/", tab: "Dev" },
	{ id: "dev-to", name: "DEV Community", feed: "https://dev.to/feed", home: "https://dev.to/", tab: "Dev" },
];

const MAX_HEADLINES = 5;
const TTL_MS = 30 * 60_000;
/** A source fetched more recently than this is not re-fetched by a manual refresh. */
export const REFRESH_THROTTLE_MS = 60_000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decode(text: string): string {
	return text.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(amp|lt|gt|quot|apos));/gi, (whole, hex, dec, name) => {
		if (name) return ENTITIES[name.toLowerCase()] ?? whole;
		const code = hex ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
	});
}

/** Text of `<tag>` inside an item: CDATA is taken verbatim, anything else is entity-decoded. */
export function field(item: string, tag: string): string {
	const raw = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
	const cdata = raw.trim().match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
	return (cdata ? cdata[1] : decode(raw)).trim();
}

function isAllowedUrl(value: string, hosts?: string[]): boolean {
	try {
		const { protocol, hostname } = new URL(value);
		if (protocol !== "https:" && protocol !== "http:") return false;
		return !hosts || hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`));
	} catch {
		return false;
	}
}

export function parseFeed(xml: string, hosts?: string[]): Headline[] {
	const headlines: Headline[] = [];
	for (const [, item] of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)) {
		const title = field(item, "title").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
		const url = field(item, "link");
		if (title && isAllowedUrl(url, hosts)) headlines.push({ title, url });
		if (headlines.length === MAX_HEADLINES) break;
	}
	if (headlines.length === 0) throw new Error("no headlines in feed");
	return headlines;
}

/** Cached getter for one source (Prothom Alo unless given another); resolves to null when it is unavailable. */
export function createNewsSource(
	{ fetchImpl = fetch, now = Date.now }: { fetchImpl?: typeof fetch; now?: () => number } = {},
	source: NewsSource = NEWS_SOURCES[0],
) {
	return cached(async () => parseFeed(await fetchText(source.feed, fetchImpl), source.hosts), {
		ttlMs: TTL_MS,
		now,
		label: `${source.name} feed`,
	});
}

// Each source has its own cache, so one failing feed never hides the others.
const getters = NEWS_SOURCES.map((source) => ({ source, get: createNewsSource({}, source) }));

export interface NewsTab {
	name: string;
	sources: { source: NewsSource; headlines: Headline[] }[];
}

export interface News {
	tabs: NewsTab[];
	/** Oldest fetch time among the sources shown, in ms. */
	fetchedAt: number;
}

/** Headlines grouped by tab; sources that failed are left out, and so are tabs with no sources left. Null if all failed. */
export async function getNews(): Promise<News | null> {
	const results = await Promise.all(
		getters.map(async ({ source, get }) => ({ source, headlines: await get(), at: get.fetchedAt() })),
	);
	const tabs: NewsTab[] = [];
	let fetchedAt = Number.POSITIVE_INFINITY;
	for (const { source, headlines, at } of results) {
		if (!headlines || at === null) continue;
		fetchedAt = Math.min(fetchedAt, at);
		let tab = tabs.find((t) => t.name === source.tab);
		if (!tab) tabs.push((tab = { name: source.tab, sources: [] }));
		tab.sources.push({ source, headlines });
	}
	return tabs.length > 0 ? { tabs, fetchedAt } : null;
}

/** Re-fetch every source not fetched within the throttle window, in parallel. */
export async function refreshNews(now = Date.now()): Promise<void> {
	await Promise.all(
		getters.map(({ get }) => {
			const at = get.fetchedAt();
			return at !== null && now - at < REFRESH_THROTTLE_MS ? undefined : get.refresh();
		}),
	);
}
