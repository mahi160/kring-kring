import { pickTodaysComic } from "../comics/daily.ts";
import { comicStore, staffDb } from "../staff/index.ts";
import { quizClock } from "../staff/quiz.ts";
import { refreshNews } from "../utils/news.ts";
import { TEA_REFRESH_MS, teaStats } from "../utils/tea.ts";
import { aiConfig, createAiClient, type AiClient } from "./ai.ts";
import { BannerStore, drawBanner, type BannerTheme } from "./banner.ts";
import { DIGEST_HOUR, DigestStore, writeDigest, type DigestSource } from "./digest.ts";
import { JobQueue, runNext, type JobHandler } from "./queue.ts";
import { writeQuizDrafts, type DraftWriter } from "./quiz-drafts.ts";

let queue: JobQueue | undefined;
let digests: DigestStore | undefined;
let banners: BannerStore | undefined;

export const jobQueue = () => (queue ??= new JobQueue(staffDb()));
export const digestStore = () => (digests ??= new DigestStore(staffDb()));
export const bannerStore = () => (banners ??= new BannerStore(staffDb()));

export interface RunnerDeps {
	ai: AiClient | null;
	/** Only the plugin's cron context can write content; null elsewhere. */
	drafts: DraftWriter | null;
}

const needAi = (ai: AiClient | null): AiClient => {
	if (!ai) throw new Error("AI server not configured (AI_TEXT_URL / AI_IMAGE_URL)");
	return ai;
};
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null ? { ...v } : {});
const text = (v: unknown) => (typeof v === "string" ? v : "");

const handlers: Record<string, JobHandler<RunnerDeps>> = {
	async test(payload, { ai, signal }) {
		return needAi(ai).chat([{ role: "user", content: text(obj(payload).prompt) }], { signal });
	},

	async "quiz-drafts"(_payload, { ai, drafts, signal }) {
		if (!drafts) throw new Error("quiz drafts need the plugin's content access");
		return writeQuizDrafts(needAi(ai), drafts, signal);
	},

	async digest(payload, { ai, signal, now }) {
		const p = obj(payload);
		const sources: DigestSource[] = (Array.isArray(p.sources) ? p.sources : []).map((s) => {
			const o = obj(s);
			return { kind: o.kind === "event" ? "event" : "announcement", title: text(o.title), detail: text(o.detail) };
		});
		const lines = await writeDigest(needAi(ai), sources, signal);
		digestStore().save(text(p.day), lines, now);
		return lines.map((l) => l.text).join("\n");
	},

	async banner(payload, { ai, signal, now }) {
		const p = obj(payload);
		const theme: BannerTheme = {
			day: text(p.day),
			weekday: text(p.weekday),
			events: Array.isArray(p.events) ? p.events.map(text).filter(Boolean) : [],
			birthdays: Number(p.birthdays) || 0,
		};
		if (!/^\d{4}-\d{2}-\d{2}$/.test(theme.day)) throw new Error("banner: bad day");
		return drawBanner(needAi(ai), bannerStore(), theme, signal, now);
	},
};

const ai = () => {
	const config = aiConfig();
	return config.textUrl || config.imageUrl ? createAiClient(config) : null;
};

let draining: Promise<void> | undefined;

/** Runs queued jobs one after another until none can run now. Safe to call often. */
export function drainQueue(drafts: DraftWriter | null = null): Promise<void> {
	draining ??= (async () => {
		try {
			const deps: RunnerDeps = { ai: ai(), drafts };
			while (await runNext(jobQueue(), handlers, deps)) {
				// keep going
			}
		} finally {
			draining = undefined;
		}
	})();
	return draining;
}

// ---- Enqueueing. Cheap DB checks; the page calls these, the model runs later. ----

export function ensureDigest(now: Date, sources: DigestSource[]): void {
	const clock = quizClock(now);
	const hour = new Date(now.getTime() + 6 * 3_600_000).getUTCHours();
	if (!aiConfig().textUrl || clock.phase === "closed-day" || hour < DIGEST_HOUR || sources.length === 0) return;
	if (digestStore().forDay(clock.day)) return;
	jobQueue().enqueue("digest", "text", { day: clock.day, sources: sources.slice(0, 8) }, now, `digest:${clock.day}`);
}

export function ensureBanner(theme: BannerTheme, now: Date): void {
	if (!aiConfig().imageUrl || bannerStore().forDay(theme.day)) return;
	jobQueue().enqueue("banner", "image", theme, now, `banner:${theme.day}`);
}

// ---- Background tick, driven every minute by the hub-jobs plugin's cron. ----

const DRAFTS_HOUR = 21;
const COMIC_RETRY_MS = 15 * 60_000;
let recovered = false;
let teaAt = 0;
let newsAt = 0;
// Under the feeds' 30-min cache, so page views never wait on a slow feed.
const NEWS_REFRESH_MS = 25 * 60_000;
let comicTriedAt = 0;
let housekeptDay = "";

export async function backgroundTick(now: Date, drafts: DraftWriter | null): Promise<void> {
	if (!recovered) {
		jobQueue().recover();
		recovered = true;
	}
	const t = now.getTime();
	const day = quizClock(now).day;

	if (t - teaAt >= TEA_REFRESH_MS) {
		teaAt = t;
		void teaStats.refresh();
	}

	if (t - newsAt >= NEWS_REFRESH_MS) {
		newsAt = t;
		void refreshNews(t);
	}

	if (!comicStoreHasToday(day) && t - comicTriedAt >= COMIC_RETRY_MS) {
		comicTriedAt = t;
		void pickTodaysComic(now).catch((err) => console.warn("Comic pick failed:", err instanceof Error ? err.message : err));
	}

	const hour = new Date(t + 6 * 3_600_000).getUTCHours();
	if (hour >= DRAFTS_HOUR && aiConfig().textUrl && drafts) {
		jobQueue().enqueue("quiz-drafts", "text", {}, now, `quiz-drafts:${day}`);
	}

	if (housekeptDay !== day) {
		housekeptDay = day;
		await bannerStore().cleanup(now);
		jobQueue().prune(new Date(t - 30 * 86_400_000));
	}

	void drainQueue(drafts);
}

const comicStoreHasToday = (day: string) => comicStore().forDay(day) !== null;
