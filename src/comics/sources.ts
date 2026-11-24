import { fetchJson, fetchText, prop } from "../utils/cached.ts";
import { decode, field } from "../utils/news.ts";

export type ComicSource = "xkcd" | "monkeyuser" | "turnoff";
export const COMIC_SOURCES: ComicSource[] = ["xkcd", "monkeyuser", "turnoff"];
export const SOURCE_NAMES: Record<ComicSource, string> = { xkcd: "xkcd", monkeyuser: "MonkeyUser", turnoff: "turnoff.us" };

export interface ComicCandidate {
	source: ComicSource;
	/** xkcd number, or the comic's page URL. */
	sourceId: string;
	title: string;
	/** Link back to the original. */
	url: string;
	imageUrl: string;
	caption: string | null;
}

export interface SourceOptions {
	fetchImpl?: typeof fetch;
	random?: () => number;
	/** Lets a source skip comics before downloading anything for them. */
	isExcluded?: (source: ComicSource, sourceId: string) => boolean;
}

const XKCD_LATEST = "https://xkcd.com/info.0.json";
const MONKEYUSER_FEED = "https://www.monkeyuser.com/index.xml";
const TURNOFF_FEED = "https://turnoff.us/feed.xml";
const ATTEMPTS = 5;

/** Absolute http(s) URL (turnoff.us upgraded to https), or null. */
function httpUrl(value: string | undefined, base?: string): string | null {
	if (!value) return null;
	try {
		const u = new URL(value, base);
		if (u.protocol !== "http:" && u.protocol !== "https:") return null;
		if (u.protocol === "http:" && (u.hostname === "turnoff.us" || u.hostname.endsWith(".turnoff.us"))) u.protocol = "https:";
		return u.href;
	} catch {
		return null;
	}
}

interface RssItem {
	title: string;
	link: string;
	description: string;
}

export function parseRssItems(xml: string): RssItem[] {
	return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g)].map(([, item]) => ({
		title: field(item, "title"),
		link: field(item, "link"),
		description: field(item, "description"),
	}));
}

interface Img {
	src: string;
	alt: string;
	title: string;
}

/** `<img>` tags with quoted or unquoted attributes. */
function parseImgs(html: string): Img[] {
	return [...html.matchAll(/<img\b([^>]*)>/gi)].map(([, attrs]) => {
		const map: Record<string, string> = {};
		for (const [, name, dq, sq, bare] of attrs.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
			map[name.toLowerCase()] = decode(dq ?? sq ?? bare ?? "");
		}
		return { src: map.src ?? "", alt: map.alt ?? "", title: map.title ?? "" };
	});
}

/** The comic image on a MonkeyUser page: the first <img> that isn't site chrome under /images/. */
export function parseMonkeyUserImage(html: string, pageUrl: string): { imageUrl: string; caption: string | null } | null {
	for (const img of parseImgs(html)) {
		const imageUrl = httpUrl(img.src, pageUrl);
		if (imageUrl && !new URL(imageUrl).pathname.startsWith("/images/")) return { imageUrl, caption: img.title.trim() || null };
	}
	return null;
}

export function parseTurnoffItem(item: RssItem): ComicCandidate | null {
	const url = httpUrl(item.link);
	const imageUrl = httpUrl(parseImgs(item.description)[0]?.src, url ?? undefined);
	return url && imageUrl && item.title ? { source: "turnoff", sourceId: url, title: item.title, url, imageUrl, caption: null } : null;
}

export function parseXkcd(json: unknown): ComicCandidate | null {
	const num = prop(json, "num");
	const title = prop(json, "safe_title") || prop(json, "title");
	const alt = prop(json, "alt");
	const imageUrl = typeof prop(json, "img") === "string" ? httpUrl(prop(json, "img") as string) : null;
	if (typeof num !== "number" || typeof title !== "string" || !imageUrl) return null;
	return {
		source: "xkcd",
		sourceId: String(num),
		title,
		url: `https://xkcd.com/${num}/`,
		imageUrl,
		caption: typeof alt === "string" && alt.trim() ? alt.trim() : null,
	};
}

/** The newest xkcd; throws if the API is unreachable or returns something unusable. */
export async function xkcdLatest(fetchImpl: typeof fetch = fetch): Promise<ComicCandidate> {
	const comic = parseXkcd(await fetchJson(XKCD_LATEST, fetchImpl));
	if (!comic) throw new Error("unusable xkcd response");
	return comic;
}

async function xkcdArchive({ fetchImpl = fetch, random = Math.random, isExcluded }: SourceOptions): Promise<ComicCandidate | null> {
	const latest = Number((await xkcdLatest(fetchImpl)).sourceId);
	for (let i = 0; i < ATTEMPTS; i++) {
		const num = 1 + Math.floor(random() * latest);
		if (num === 404 || isExcluded?.("xkcd", String(num))) continue; // #404 is an in-joke: no such comic
		try {
			const comic = parseXkcd(await fetchJson(`https://xkcd.com/${num}/info.0.json`, fetchImpl));
			if (comic) return comic;
		} catch {
			// missing or flaky: try another number
		}
	}
	return null;
}

async function rssArchive(source: "monkeyuser" | "turnoff", { fetchImpl = fetch, random = Math.random, isExcluded }: SourceOptions) {
	const feed = parseRssItems(await fetchText(source === "turnoff" ? TURNOFF_FEED : MONKEYUSER_FEED, fetchImpl));
	const items = feed.flatMap((item) => {
		const url = httpUrl(item.link);
		return url && item.title && !isExcluded?.(source, url) ? [{ ...item, link: url }] : [];
	});
	for (let i = 0; i < ATTEMPTS && items.length > 0; i++) {
		const [item] = items.splice(Math.floor(random() * items.length), 1);
		if (source === "turnoff") {
			const comic = parseTurnoffItem(item);
			if (comic) return comic;
			continue;
		}
		try {
			const img = parseMonkeyUserImage(await fetchText(item.link, fetchImpl), item.link);
			if (img) return { source, sourceId: item.link, title: item.title, url: item.link, ...img } satisfies ComicCandidate;
		} catch {
			// page down: try another comic
		}
	}
	return null;
}

/** A random comic from one source, skipping excluded ones. Null if none usable; throws if the source is down. */
export function archiveCandidate(source: ComicSource, opts: SourceOptions = {}): Promise<ComicCandidate | null> {
	return source === "xkcd" ? xkcdArchive(opts) : rssArchive(source, opts);
}
