import assert from "node:assert/strict";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { aiConfig, createAiClient, type AiClient } from "../src/jobs/ai.ts";
import { BannerStore, bannerPrompt, bannerSrc, bannerTarget, drawBanner } from "../src/jobs/banner.ts";
import { DigestStore, parseDigest, portableTextToPlain, writeDigest, type DigestSource } from "../src/jobs/digest.ts";
import { JobQueue, inImageWindow, runNext, type JobHandler } from "../src/jobs/queue.ts";
import { dedupeDrafts, isNearDuplicate, parseDrafts, writeQuizDrafts, type QuizDraft } from "../src/jobs/quiz-drafts.ts";
import { toQuizQuestion } from "../src/staff/quiz.ts";

// Dhaka is UTC+6. 2026-11-22 is a Sunday.
const NOON = new Date("2026-11-22T06:00:00Z");
const EVENING = new Date("2026-11-22T14:00:00Z"); // 20:00
const EARLY = new Date("2026-11-22T01:30:00Z"); // 07:30
const db = () => new DatabaseSync(":memory:");
const neverAborted = new AbortController().signal;

/** A stub model that answers from a list; records what it was asked. */
function stubAi(replies: string[], image?: Uint8Array): AiClient & { asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		async chat(messages) {
			asked.push(messages.map((m) => m.content).join("\n"));
			const next = replies.shift();
			if (next === undefined) throw new Error("model down");
			return next;
		},
		async image() {
			if (!image) throw new Error("model down");
			return image;
		},
	};
}

// ---- 11: queue ----

test("queue: FIFO, one job at a time, done/failed recorded", async () => {
	const q = new JobQueue(db());
	q.enqueue("echo", "text", { n: 1 }, NOON);
	q.enqueue("echo", "text", { n: 2 }, NOON);
	const ran: unknown[] = [];
	const handlers: Record<string, JobHandler<object>> = {
		async echo(p) {
			ran.push(p);
			return "ok";
		},
	};
	assert.equal((await runNext(q, handlers, {}, () => NOON))?.status, "done");
	assert.equal((await runNext(q, handlers, {}, () => NOON))?.status, "done");
	assert.equal(await runNext(q, handlers, {}, () => NOON), null);
	assert.deepEqual(ran, [{ n: 1 }, { n: 2 }]);

	q.enqueue("nope", "text", {}, NOON);
	assert.match((await runNext(q, handlers, {}, () => NOON))?.error ?? "", /Unknown job kind/);
});

test("queue: a second job can't start while one is running", () => {
	const q = new JobQueue(db());
	q.enqueue("a", "text", {}, NOON);
	q.enqueue("b", "text", {}, NOON);
	assert.equal(q.claim(NOON)?.kind, "a");
	assert.equal(q.claim(NOON), null);
});

test("queue: a queued or running job survives a restart", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "hub-jobs-"));
	const file = path.join(dir, "staff.db");
	const first = new JobQueue(new DatabaseSync(file));
	first.enqueue("a", "text", { x: 1 }, NOON);
	first.enqueue("b", "text", { x: 2 }, NOON);
	first.claim(NOON); // "a" was running when the hub died

	const second = new JobQueue(new DatabaseSync(file));
	assert.equal(second.recover(), 1);
	assert.deepEqual(
		[second.claim(NOON)?.payload, second.counts().queued],
		[{ x: 1 }, 1],
	);
});

test("queue: a text job over 60 s is aborted and marked failed", async () => {
	const q = new JobQueue(db());
	q.enqueue("slow", "text", {}, NOON);
	let aborted = false;
	const handlers: Record<string, JobHandler<object>> = {
		slow: (_p, { signal }) =>
			new Promise((resolve) => {
				signal.addEventListener("abort", () => (aborted = true));
				setTimeout(() => resolve("too late"), 200);
			}),
	};
	const job = await runNext(q, handlers, {}, () => NOON, { text: 20, image: 1000 });
	assert.equal(job?.status, "failed");
	assert.match(job?.error ?? "", /Timed out/);
	assert.ok(aborted);
	await new Promise((r) => setTimeout(r, 250));
	assert.equal(q.get(job.id)?.status, "failed", "a late result doesn't overwrite the failure");
});

test("queue: an image job submitted at noon waits until 20:00; text jobs pass it", () => {
	const q = new JobQueue(db());
	q.enqueue("banner", "image", {}, NOON);
	q.enqueue("test", "text", {}, NOON);
	assert.equal(q.claim(NOON)?.kind, "test", "text runs first");
	q.finish(1 + 1, "ok", NOON);
	assert.equal(q.claim(NOON), null, "image waits at noon");
	assert.equal(q.claim(new Date("2026-11-22T13:59:00Z")), null, "19:59 still waits");
	assert.equal(q.claim(EVENING)?.kind, "banner");
	assert.ok(inImageWindow(EARLY));
	assert.ok(!inImageWindow(new Date("2026-11-22T02:00:00Z")), "08:00 is closed");
});

test("queue: a dedupe key only ever queues once", () => {
	const q = new JobQueue(db());
	assert.ok(q.enqueue("digest", "text", {}, NOON, "digest:2026-11-22"));
	assert.equal(q.enqueue("digest", "text", {}, NOON, "digest:2026-11-22"), null);
	assert.equal(q.counts().queued, 1);
});

test("ai client: chat and image requests, config from env", async () => {
	assert.deepEqual(aiConfig({ AI_TEXT_URL: " http://ai.local:8080/ " }), { textUrl: "http://ai.local:8080", imageUrl: null });
	const calls: { url: string; body: Record<string, unknown> }[] = [];
	const fetchImpl: typeof fetch = async (url, init) => {
		calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
		return String(url).endsWith("/chat/completions")
			? Response.json({ choices: [{ message: { content: "<think>hmm</think> Hello" } }] })
			: Response.json({ data: [{ b64_json: Buffer.from("png!").toString("base64") }] });
	};
	const ai = createAiClient({ textUrl: "http://t", imageUrl: "http://i" }, fetchImpl);
	assert.equal(await ai.chat([{ role: "user", content: "hi" }], { signal: neverAborted }), "Hello");
	assert.equal(Buffer.from(await ai.image("cat", { signal: neverAborted, size: "768x256" })).toString(), "png!");
	assert.equal(calls[0].url, "http://t/v1/chat/completions");
	assert.equal(calls[1].url, "http://i/v1/images/generations");
	assert.equal(calls[1].body.size, "768x256");

	const down = createAiClient({ textUrl: "http://t", imageUrl: null }, async () => new Response("", { status: 503 }));
	await assert.rejects(down.chat([], { signal: neverAborted }), /HTTP 503/);
	await assert.rejects(down.image("x", { signal: neverAborted, size: "1x1" }), /AI_IMAGE_URL/);
});

// ---- 12: quiz drafts ----

const valid = { question: "Which river flows through Dhaka?", choices: ["Buriganga", "Thames"], correct: 1, explanation: "Old Dhaka sits on it." };

test("drafts: valid output parses into the bank shape", () => {
	const { drafts, malformed } = parseDrafts(JSON.stringify({ questions: [valid] }));
	assert.equal(malformed, 0);
	assert.deepEqual(drafts, [valid]);
});

test("drafts: malformed output is discarded", () => {
	assert.deepEqual(parseDrafts("Sure! Here are some questions:"), { drafts: [], malformed: 1 });
	const { drafts, malformed } = parseDrafts(
		"```json\n" +
			JSON.stringify({
				questions: [
					valid,
					{ question: "No choices?", choices: [], correct: 1 },
					{ question: "Bad answer", choices: ["a", "b"], correct: 3 },
					{ question: "Same twice", choices: ["a", "A"], correct: 1 },
					{ question: "", choices: ["a", "b"], correct: 1 },
					{ question: "Too many", choices: ["a", "b", "c", "d", "e"], correct: 1 },
				],
			}) +
			"\n```",
	);
	assert.equal(drafts.length, 1);
	assert.equal(malformed, 5);
});

test("drafts: near-identical questions are skipped", () => {
	const k = (question: string, answer: string | null = null) => ({ question, answer });
	assert.ok(!isNearDuplicate(k("Which river flows through Dhaka?", "Buriganga"), k("Which river flows through Paris?", "Seine")));
	assert.ok(isNearDuplicate(k("Which river flows past Dhaka?", "Buriganga"), k("Which river flows through Dhaka?", "buriganga")));
	assert.ok(isNearDuplicate(k("Which river flows through Dhaka?"), k("Which river flows through the city of Dhaka?")));
	assert.ok(isNearDuplicate(k("What is the capital of Japan?"), k("The capital of Japan is what?")));
	const d = (question: string): QuizDraft => ({ question, choices: ["a", "b"], correct: 1, explanation: null });
	const { fresh, duplicates } = dedupeDrafts(
		[d("Which river flows through Dhaka?"), d("What does HTTP 418 mean?"), d("what does http 418 mean")],
		[k("Which river flows through Dhaka")],
	);
	assert.deepEqual(fresh.map((f) => f.question), ["What does HTTP 418 mean?"]);
	assert.equal(duplicates, 2);
});

test("drafts: saved unapproved, so the daily quiz never picks them", async () => {
	const saved: QuizDraft[] = [];
	const ai = stubAi([JSON.stringify({ questions: [valid, { ...valid, question: "Which planet is red?", choices: ["Mars", "Venus"] }] })]);
	const summary = await writeQuizDrafts(
		ai,
		{
			existingQuestions: async () => [{ question: "Which river flows past Dhaka?", answer: "Buriganga" }],
			saveDraft: async (d) => void saved.push(d),
		},
		neverAborted,
	);
	assert.match(summary, /Saved 1 draft.*1 duplicate.*0 malformed/);
	assert.equal(saved[0].question, "Which planet is red?");
	assert.match(ai.asked[0], /Which river flows past Dhaka\?/, "existing questions are listed to avoid");

	// What the plugin stores: approved false. The bank ignores it until the operator approves.
	const entry = (approved: boolean) => ({
		id: "d1",
		question: saved[0].question,
		choices: saved[0].choices.map((label) => ({ label })),
		correct_choice: saved[0].correct,
		approved,
		addedAt: 1,
	});
	assert.equal(toQuizQuestion(entry(false)), null);
	assert.equal(toQuizQuestion(entry(true))?.correct, 0);
});

// ---- 13: digest ----

const sources: DigestSource[] = [
	{ kind: "announcement", title: "Fire drill on Tuesday", detail: "Meet at the gate at 11." },
	{ kind: "event", title: "Pitha party", detail: "Tomorrow, 4:00 pm; roof" },
];

test("digest: lines must name real items", () => {
	const ok = JSON.stringify({
		lines: [
			{ item: "fire drill on tuesday", text: "Fire drill Tuesday at 11, meet at the gate." },
			{ item: "Pitha party", text: "Pitha on the roof tomorrow at 4!" },
		],
	});
	assert.deepEqual(
		parseDigest(ok, sources).map((l) => l.title),
		["Fire drill on Tuesday", "Pitha party"],
	);
	const invented = JSON.stringify({ lines: [{ item: "Free lunch Friday", text: "Free lunch!" }] });
	assert.throws(() => parseDigest(invented, sources), /unknown item/);
	assert.throws(() => parseDigest("{}", sources), /wrong number/);
	const four = JSON.stringify({ lines: Array(4).fill({ item: "Pitha party", text: "x" }) });
	assert.throws(() => parseDigest(four, sources), /wrong number/);
});

test("digest: stored once per day; a failure stores nothing", async () => {
	const store = new DigestStore(db());
	assert.equal(store.forDay("2026-11-22"), null);
	await assert.rejects(writeDigest(stubAi([]), sources, neverAborted), /model down/);
	await assert.rejects(writeDigest(stubAi(["not json"]), sources, neverAborted));
	assert.equal(store.forDay("2026-11-22"), null, "homepage unchanged");

	const lines = await writeDigest(
		stubAi([JSON.stringify({ lines: [{ item: "Pitha party", text: "Pitha tomorrow!" }] })]),
		sources,
		neverAborted,
	);
	store.save("2026-11-22", lines, NOON);
	assert.deepEqual(store.forDay("2026-11-22"), [{ title: "Pitha party", text: "Pitha tomorrow!" }]);
	assert.equal(store.forDay("2026-11-23"), null);
});

// ---- 14: banner ----

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

test("banner: fallback when no image exists; image once drawn", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "hub-banners-"));
	const store = new BannerStore(db(), dir);
	assert.equal(bannerSrc(store, "2026-11-23"), null);
	const theme = { day: "2026-11-23", weekday: "Monday", events: ["Pitha party"], birthdays: 1 };
	await drawBanner(stubAi([], PNG), store, theme, neverAborted, EVENING);
	assert.equal(bannerSrc(store, "2026-11-23"), "/banners/2026-11-23.png");
	assert.deepEqual(await readdir(dir), ["2026-11-23.png"]);
	await assert.rejects(drawBanner(stubAi([], new Uint8Array([60, 104])), store, { ...theme, day: "2026-11-24" }, neverAborted, EVENING), /isn't a PNG/);
	assert.equal(bannerSrc(store, "2026-11-24"), null);
});

test("banner: prompt from the day's theme, without names or text", () => {
	const p = bannerPrompt({ day: "2026-11-23", weekday: "Monday", events: ["Pitha party"], birthdays: 2 });
	assert.match(p, /Monday/);
	assert.match(p, /Pitha party/);
	assert.match(p, /birthday cake/);
	assert.match(p, /No text/);
});

test("banner: drawn for tomorrow after 08:00, for today before", () => {
	assert.deepEqual(bannerTarget(NOON), { day: "2026-11-23", offset: 1 });
	assert.deepEqual(bannerTarget(EVENING), { day: "2026-11-23", offset: 1 });
	assert.deepEqual(bannerTarget(EARLY), { day: "2026-11-22", offset: 0 });
});

test("banner: kept 30 days, then removed", async () => {
	const dir = await mkdtemp(path.join(tmpdir(), "hub-banners-"));
	const store = new BannerStore(db(), dir);
	await store.save("2026-10-22", PNG, NOON);
	await store.save("2026-10-23", PNG, NOON);
	await writeFile(path.join(dir, "2026-10-01.png"), PNG); // stray file without a row
	await store.cleanup(NOON); // cutoff 2026-10-23
	assert.deepEqual((await readdir(dir)).sort(), ["2026-10-23.png"]);
	assert.equal(store.forDay("2026-10-22"), null);
	assert.equal(store.forDay("2026-10-23"), "2026-10-23.png");
});

test("digest: announcement bodies flatten to plain text", () => {
	assert.equal(portableTextToPlain([{ _type: "image" }, { _type: "block", children: [{ text: "a" }, { text: "b" }] }]), "ab");
	assert.equal(portableTextToPlain(undefined), "");
});

