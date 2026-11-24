import { cached, fetchJson, prop } from "./cached.ts";
import { endOfDhakaDay } from "./events.ts";

export interface Joke {
	text: string;
}

export interface WikiDigest {
	article: { title: string; summary: string; url: string; thumbnail: string | null } | null;
	onThisDay: { year: number; text: string } | null;
}

// Fresh content each Dhaka day, the same all day.
const untilMidnight = (t: number) => endOfDhakaDay(new Date(t)).getTime() - t;

// "explicit", "political" and "religion" are left out for an office audience.
const JOKE_CATEGORIES = ["animal", "career", "dev", "food", "movie", "music", "science", "sport", "travel"];
// The database is crowd-sourced; even safe categories hold a few crude ones.
const UNSUITABLE =
	/\b(porn\w*|sex\w*|rap(e|ed|es|ing)|dicks?|penis|vagina|ass(es)?|fuck\w*|shit\w*|bitch\w*|kill\w*|dead|die[sd]?|guns?|nazis?|hitler|drugs?)\b/i;

function parseJoke(body: unknown): Joke {
	const text = prop(body, "value");
	if (typeof text !== "string" || !text.trim()) throw new Error("unexpected chucknorris.io response");
	return { text: text.trim() };
}

export function createJokeSource({
	fetchImpl = fetch,
	now = Date.now,
	random = Math.random,
}: { fetchImpl?: typeof fetch; now?: () => number; random?: () => number } = {}) {
	return cached(
		async () => {
			for (let attempt = 0; attempt < 5; attempt++) {
				const category = JOKE_CATEGORIES[Math.floor(random() * JOKE_CATEGORIES.length)];
				const joke = parseJoke(await fetchJson(`https://api.chucknorris.io/jokes/random?category=${category}`, fetchImpl));
				if (!UNSUITABLE.test(joke.text)) return joke;
			}
			throw new Error("no office-friendly joke after 5 tries");
		},
		{ ttlMs: untilMidnight, now, label: "Daily joke" },
	);
}

/** Up to two sentences, at most `max` characters. */
export function shortSummary(text: string, max = 280): string {
	const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
	let out = "";
	for (const s of sentences.slice(0, 2)) {
		if ((out + s).trim().length > max) break;
		out += s;
	}
	out = out.trim();
	if (out) return out;
	return `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}\u2026`;
}

function parseWiki(body: unknown): WikiDigest {
	const tfa = prop(body, "tfa");
	const title = prop(prop(tfa, "titles"), "normalized");
	const extract = prop(tfa, "extract");
	const url = prop(prop(prop(tfa, "content_urls"), "desktop"), "page");
	const thumb = prop(prop(tfa, "thumbnail"), "source");
	const article =
		typeof title === "string" && typeof extract === "string" && typeof url === "string"
			? { title, summary: shortSummary(extract), url, thumbnail: typeof thumb === "string" ? thumb : null }
			: null;

	const events = prop(body, "onthisday");
	const first = Array.isArray(events) ? events[0] : undefined;
	const year = prop(first, "year");
	const text = prop(first, "text");
	const onThisDay = typeof year === "number" && typeof text === "string" ? { year, text } : null;

	if (!article && !onThisDay) throw new Error("unexpected Wikipedia feed response");
	return { article, onThisDay };
}

const feedDate = new Intl.DateTimeFormat("en-CA", {
	timeZone: "Asia/Dhaka",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

export function createWikiSource({ fetchImpl = fetch, now = Date.now }: { fetchImpl?: typeof fetch; now?: () => number } = {}) {
	return cached(
		async () => {
			const path = feedDate.format(new Date(now())).replaceAll("-", "/");
			return parseWiki(await fetchJson(`https://en.wikipedia.org/api/rest_v1/feed/featured/${path}`, fetchImpl));
		},
		{ ttlMs: untilMidnight, now, label: "Wikipedia feed" },
	);
}

export const getDailyJoke = createJokeSource();
export const getWikiDigest = createWikiSource();
