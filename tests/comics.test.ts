import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ensureTodaysComic, type DailyDeps } from "../src/comics/daily.ts";
import { parseMonkeyUserImage, parseRssItems, parseTurnoffItem } from "../src/comics/sources.ts";
import { ComicStore, dhakaDay, previousMonth } from "../src/comics/store.ts";

// Dhaka is UTC+6, so noon UTC is always the same Dhaka day.
const noon = (day: string) => new Date(`${day}T12:00:00Z`);
const PNG = new Uint8Array([137, 80, 78, 71]);

const xkcdJson = (num: number) => ({ num, safe_title: `Comic ${num}`, img: `https://imgs.xkcd.com/comics/c${num}.png`, alt: `alt ${num}` });
const rss = (items: string) => `<rss><channel>${items}</channel></rss>`;
const MU_FEED = rss(
	`<item><title>Button</title><link>https://www.monkeyuser.com/2025/button/</link><description></description></item>`,
);
const MU_PAGE = `<html><img src=/images/logo.png alt=logo><img src=/2025/button/justabutton.png alt="Just  a button" title="It's not you...">`;
const TO_FEED = rss(
	`<item><title>Pods</title><link>http://turnoff.us/geek-art/pods/</link><description><![CDATA[<p><img src="http://turnoff.us/image/en/pods.png" alt="Pods" title="t"></p>]]></description></item>`,
);

interface World {
	xkcdLatest?: number;
	xkcdMissing?: boolean;
	monkeyuser?: boolean;
	turnoff?: boolean;
	imageBytes?: Uint8Array;
}

function stubFetch(world: World, log: string[] = []): typeof fetch {
	return (async (input: string | URL | Request) => {
		const url = String(input);
		log.push(url);
		const fail = () => new Response("no", { status: 500 });
		const json = (v: unknown) => Response.json(v);
		if (url === "https://xkcd.com/info.0.json") return world.xkcdLatest ? json(xkcdJson(world.xkcdLatest)) : fail();
		const archive = /^https:\/\/xkcd\.com\/(\d+)\/info\.0\.json$/.exec(url);
		if (archive) return world.xkcdLatest && !world.xkcdMissing ? json(xkcdJson(Number(archive[1]))) : fail();
		if (url === "https://www.monkeyuser.com/index.xml") return world.monkeyuser ? new Response(MU_FEED) : fail();
		if (url === "https://www.monkeyuser.com/2025/button/") return new Response(MU_PAGE);
		if (url === "https://turnoff.us/feed.xml") return world.turnoff ? new Response(TO_FEED) : fail();
		if (/\.(png)$/.test(url)) {
			return new Response(world.imageBytes ?? PNG, { headers: { "content-type": "image/png" } });
		}
		return fail();
	}) as typeof fetch;
}

function setup(world: World, log: string[] = []) {
	const store = new ComicStore(new DatabaseSync(":memory:"));
	const filesDir = mkdtempSync(join(tmpdir(), "comics-"));
	const deps: DailyDeps = { fetchImpl: stubFetch(world, log), store, random: () => 0.5, filesDir };
	return { store, filesDir, deps, world };
}

// Alternates between the first and last archive number.
const alternating = () => {
	let n = 0;
	return () => (n++ % 2 === 0 ? 0 : 0.99);
};

test("a new xkcd is preferred", async () => {
	const { deps } = setup({ xkcdLatest: 3000, monkeyuser: true, turnoff: true });
	const comic = await ensureTodaysComic(noon("2026-03-10"), deps);
	assert.equal(comic?.source, "xkcd");
	assert.equal(comic?.sourceId, "3000");
	assert.equal(comic?.url, "https://xkcd.com/3000/");
	assert.equal(comic?.caption, "alt 3000");
});

test("without a new xkcd, a random archive comic is picked", async () => {
	const { deps, store } = setup({ xkcdLatest: 3000, monkeyuser: true, turnoff: true });
	await ensureTodaysComic(noon("2026-03-10"), deps);
	const next = await ensureTodaysComic(noon("2026-03-11"), deps);
	assert.ok(next);
	assert.notEqual(next.sourceId, "3000");
	assert.equal(store.forDay("2026-03-11")?.id, next.id);
});

test("comics are not repeated within 90 days, then may return", async () => {
	// Only xkcd 1..2 exist; MonkeyUser and turnoff are down.
	const { deps } = setup({ xkcdLatest: 2 });
	deps.random = alternating();
	const first = await ensureTodaysComic(noon("2026-01-01"), deps); // new latest (#2)
	assert.equal(first?.sourceId, "2");
	const second = await ensureTodaysComic(noon("2026-01-02"), deps);
	assert.equal(second?.sourceId, "1");
	// Everything is now recent: nothing left to pick inside the window.
	assert.equal(await ensureTodaysComic(noon("2026-01-03"), deps), null);
	// 91 days after Jan 1, #2 is outside the window again; #1 (Jan 2) still inside.
	const later = await ensureTodaysComic(noon("2026-04-02"), deps);
	assert.equal(later?.sourceId, "2");
});

test("the same comic shows all day and changes the next day", async () => {
	const { deps } = setup({ xkcdLatest: 3000, monkeyuser: true, turnoff: true });
	const morning = await ensureTodaysComic(new Date("2026-03-10T00:30:00Z"), deps); // 06:30 Dhaka
	const night = await ensureTodaysComic(new Date("2026-03-10T17:59:00Z"), deps); // 23:59 Dhaka
	assert.equal(morning?.id, night?.id);
	const nextDay = await ensureTodaysComic(new Date("2026-03-10T18:00:00Z"), deps); // 00:00 Dhaka, 11th
	assert.notEqual(nextDay?.id, morning?.id);
});

test("concurrent calls pick once", async () => {
	const { deps, store } = setup({ xkcdLatest: 3000 });
	const [a, b] = await Promise.all([ensureTodaysComic(noon("2026-03-10"), deps), ensureTodaysComic(noon("2026-03-10"), deps)]);
	assert.equal(a?.id, b?.id);
	assert.equal(store.forDay("2026-03-10")?.id, a?.id);
});

test("the image is downloaded once and the file reused", async () => {
	const log: string[] = [];
	const { deps, store, filesDir } = setup({ xkcdLatest: 2 }, log);
	deps.random = alternating();
	await ensureTodaysComic(noon("2026-01-01"), deps); // #2
	await ensureTodaysComic(noon("2026-01-02"), deps); // #1
	const downloads = () => log.filter((u) => u.endsWith(".png")).length;
	assert.equal(downloads(), 2);
	assert.equal(readdirSync(filesDir).length, 2);
	// After the window, #2 comes back from the store without another download.
	const again = await ensureTodaysComic(noon("2026-04-02"), deps);
	assert.equal(again?.sourceId, "2");
	assert.equal(downloads(), 2);
	assert.ok(existsSync(join(filesDir, store.find("xkcd", "2")?.file ?? "missing")));
});

test("non-image or oversized downloads are rejected", async () => {
	const big = setup({ xkcdLatest: 5, imageBytes: new Uint8Array(5 * 1024 * 1024 + 1) });
	assert.equal(await ensureTodaysComic(noon("2026-03-10"), big.deps), null);
	assert.equal(readdirSync(big.filesDir).length, 0);
});

test("when every source fails, no new pick is made and the latest earlier one stays", async () => {
	const ok = setup({ xkcdLatest: 3000 });
	const yesterday = await ensureTodaysComic(noon("2026-03-10"), ok.deps);
	const down = { ...ok.deps, fetchImpl: stubFetch({}) };
	assert.equal(await ensureTodaysComic(noon("2026-03-11"), down), null);
	assert.equal(ok.store.forDay("2026-03-11"), null);
	assert.equal(ok.store.latest("2026-03-11")?.id, yesterday?.id);
});

test("MonkeyUser: unquoted <img> attributes, chrome images skipped, relative src resolved", () => {
	const img = parseMonkeyUserImage(MU_PAGE, "https://www.monkeyuser.com/2025/button/");
	assert.deepEqual(img, { imageUrl: "https://www.monkeyuser.com/2025/button/justabutton.png", caption: "It's not you..." });
	assert.equal(parseMonkeyUserImage("<img src=/images/x.png>", "https://www.monkeyuser.com/a/"), null);
	assert.equal(parseMonkeyUserImage("<img src=javascript:alert(1)>", "https://www.monkeyuser.com/a/"), null);
});

test("MonkeyUser comic is picked through the feed and page", async () => {
	const { deps } = setup({ monkeyuser: true });
	const comic = await ensureTodaysComic(noon("2026-03-10"), deps);
	assert.equal(comic?.source, "monkeyuser");
	assert.equal(comic?.sourceId, "https://www.monkeyuser.com/2025/button/");
	assert.equal(comic?.caption, "It's not you...");
});

test("turnoff.us: CDATA description parsed and http upgraded to https", () => {
	const [item] = parseRssItems(TO_FEED);
	const c = parseTurnoffItem(item);
	assert.equal(c?.url, "https://turnoff.us/geek-art/pods/");
	assert.equal(c?.imageUrl, "https://turnoff.us/image/en/pods.png");
	assert.equal(c?.sourceId, "https://turnoff.us/geek-art/pods/");
});

const addComic = (store: ComicStore, n: number) =>
	store.add({ source: "xkcd", sourceId: String(n), title: `C${n}`, url: `u${n}`, caption: null, file: `f${n}.png` });

test("reactions toggle on and off, once per person per kind", () => {
	const store = new ComicStore(new DatabaseSync(":memory:"));
	const c = addComic(store, 1);
	assert.equal(store.toggleReaction(c.id, "ann", "like"), true);
	assert.equal(store.toggleReaction(c.id, "ann", "laugh"), true);
	assert.equal(store.toggleReaction(c.id, "bob", "like"), true);
	assert.deepEqual(store.reactionCounts(c.id), { like: 2, laugh: 1 });
	assert.deepEqual(store.myReactions(c.id, "ann"), { like: true, laugh: true });
	assert.equal(store.toggleReaction(c.id, "ann", "like"), false);
	assert.deepEqual(store.reactionCounts(c.id), { like: 1, laugh: 1 });
	assert.deepEqual(store.myReactions(c.id, "ann"), { like: false, laugh: true });
});

test("comic of the month: previous Dhaka month, most reactions, ties to the earlier day", () => {
	const store = new ComicStore(new DatabaseSync(":memory:"));
	const [a, b, c, d] = [1, 2, 3, 4].map((n) => addComic(store, n));
	store.recordPick("2026-02-10", a.id);
	store.recordPick("2026-02-20", b.id);
	store.recordPick("2026-02-25", c.id);
	store.recordPick("2026-03-02", d.id);
	assert.equal(store.comicOfMonth("2026-02"), null); // no reactions yet
	store.toggleReaction(b.id, "p1", "like");
	store.toggleReaction(c.id, "p1", "like");
	assert.equal(store.comicOfMonth("2026-02")?.id, b.id); // tie: earlier day
	store.toggleReaction(c.id, "p2", "laugh");
	assert.equal(store.comicOfMonth("2026-02")?.id, c.id); // both kinds count
	for (const p of ["p1", "p2", "p3"]) store.toggleReaction(d.id, p, "like");
	assert.equal(store.comicOfMonth("2026-02")?.id, c.id); // March doesn't leak in
	assert.equal(store.comicOfMonth("2026-03")?.id, d.id);
});

test("Dhaka day and previous month", () => {
	assert.equal(dhakaDay(new Date("2026-02-28T18:00:00Z")), "2026-03-01");
	assert.equal(previousMonth("2026-03-01"), "2026-02");
	assert.equal(previousMonth("2026-01-05"), "2025-12");
});
