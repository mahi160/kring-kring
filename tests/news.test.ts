import assert from "node:assert/strict";
import { test } from "node:test";
import { createNewsSource } from "../src/utils/news.ts";

const item = (title: string, link: string) => `<item><title>${title}</title><link>${link}</link><pubDate>x</pubDate></item>`;
const feed = `<?xml version="1.0"?><rss><channel><title>Prothom Alo</title><link>https://www.prothomalo.com</link>
${item("সংবাদ &amp; বিশ্লেষণ", "https://www.prothomalo.com/a")}
${item("<![CDATA[ক্রীড়া <b>খবর</b> &amp;]]>", "https://www.prothomalo.com/b")}
${item("Not ours", "https://evil.example/c")}
${item("Bad scheme", "javascript:alert(1)")}
${item("Quote &quot;q&quot; &#39;s&#39; &#2438; &#x985;", "http://sports.prothomalo.com/d")}
${item("Lookalike", "https://prothomalo.com.evil.example/e")}
${item("Four", "https://www.prothomalo.com/4")}
${item("Five", "https://www.prothomalo.com/5")}
${item("Six", "https://www.prothomalo.com/6")}
</channel></rss>`;

function stub(respond: () => Response) {
	let calls = 0;
	const fetchImpl = (async () => {
		calls++;
		return respond();
	}) as typeof fetch;
	return { fetchImpl, calls: () => calls };
}

test("parses the first 5 valid prothomalo items, decoding entities and CDATA", async () => {
	const s = stub(() => new Response(feed, { status: 200 }));
	assert.deepEqual(await createNewsSource({ fetchImpl: s.fetchImpl })(), [
		{ title: "সংবাদ & বিশ্লেষণ", url: "https://www.prothomalo.com/a" },
		{ title: "ক্রীড়া খবর &amp;", url: "https://www.prothomalo.com/b" },
		{ title: `Quote "q" 's' আ অ`, url: "http://sports.prothomalo.com/d" },
		{ title: "Four", url: "https://www.prothomalo.com/4" },
		{ title: "Five", url: "https://www.prothomalo.com/5" },
	]);
});

test("failing fetch, bad status or empty feed gives null", async () => {
	const warn = console.warn;
	console.warn = () => {};
	try {
		for (const respond of [
			() => new Response("", { status: 500 }),
			() => new Response("<rss></rss>", { status: 200 }),
			() => new Response(item("x", "https://evil.example/"), { status: 200 }),
		]) {
			assert.equal(await createNewsSource({ fetchImpl: stub(respond).fetchImpl })(), null);
		}
	} finally {
		console.warn = warn;
	}
});

test("cached for 30 minutes", async () => {
	let t = 0;
	const s = stub(() => new Response(feed, { status: 200 }));
	const get = createNewsSource({ fetchImpl: s.fetchImpl, now: () => t });
	await get();
	t = 29 * 60_000;
	await get();
	assert.equal(s.calls(), 1);
	t = 30 * 60_000;
	await get();
	assert.equal(s.calls(), 2);
});

test("sources without a host restriction accept any http(s) link and strip tags from titles", async () => {
	const xml = `<rss>${item("Hello &lt;b&gt;world&lt;/b&gt;", "https://elsewhere.example/a")}${item("Bad", "ftp://elsewhere.example/b")}</rss>`;
	const source = { id: "x", name: "X", feed: "https://x.example/feed", home: "https://x.example/", tab: "T" };
	const s = stub(() => new Response(xml, { status: 200 }));
	assert.deepEqual(await createNewsSource({ fetchImpl: s.fetchImpl }, source)(), [{ title: "Hello world", url: "https://elsewhere.example/a" }]);
});
