import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { IdeaVotes } from "../src/staff/ideas.ts";
import { UploadLimit } from "../src/staff/uploads.ts";
import { parseIdeaForm, rankIdeas, type Idea } from "../src/utils/ideas.ts";

const idea = (id: string, postedAt: string, over: Partial<Idea> = {}): Idea => ({
	id,
	title: `Idea ${id}`,
	details: "",
	stage: "open",
	anonymous: false,
	postedById: "p0",
	postedBy: "Someone",
	postedAt: new Date(postedAt),
	...over,
});

test("one vote per person per idea: up, down, switch, take back", () => {
	const votes = new IdeaVotes(new DatabaseSync(":memory:"), "secret");
	assert.equal(votes.vote("i1", "alice", 1), 1);
	assert.equal(votes.vote("i1", "bob", 1), 1);
	assert.equal(votes.vote("i1", "carol", -1), -1);
	assert.equal(votes.vote("i2", "alice", -1), -1);
	assert.deepEqual(votes.scores(), new Map([["i1", 1], ["i2", -1]]));
	assert.equal(votes.myVote("i1", "alice"), 1);
	// The other arrow switches the vote; the same arrow takes it back.
	assert.equal(votes.vote("i1", "alice", -1), -1);
	assert.deepEqual(votes.scores(), new Map([["i1", -1], ["i2", -1]]));
	assert.equal(votes.vote("i1", "alice", -1), 0);
	assert.equal(votes.myVote("i1", "alice"), 0);
	assert.deepEqual(votes.scores(), new Map([["i1", 0], ["i2", -1]]));
});

test("votes cast before downvotes existed count as upvotes", () => {
	const db = new DatabaseSync(":memory:");
	db.exec("CREATE TABLE idea_votes (idea_id TEXT NOT NULL, voter TEXT NOT NULL, PRIMARY KEY (idea_id, voter)) WITHOUT ROWID");
	db.prepare("INSERT INTO idea_votes VALUES (?, ?)").run("i1", "old-hash");
	const votes = new IdeaVotes(db, "secret");
	votes.vote("i1", "alice", -1);
	assert.deepEqual(votes.scores(), new Map([["i1", 0]]));
});

test("the vote table never stores who voted", () => {
	const db = new DatabaseSync(":memory:");
	const votes = new IdeaVotes(db, "secret");
	votes.vote("i1", "alice-ulid", -1);
	const dump = JSON.stringify(db.prepare("SELECT * FROM idea_votes").all());
	assert.ok(!dump.includes("alice"), dump);
	// Without the secret the stored hash can't be matched to a person.
	assert.equal(new IdeaVotes(db, "other").myVote("i1", "alice-ulid"), 0);
	assert.throws(() => new IdeaVotes(db, ""));
});

test("only open ideas rank: highest score first, earlier idea wins a tie", () => {
	const ideas = [
		idea("a", "2025-03-01T06:00:00Z"),
		idea("b", "2025-03-02T06:00:00Z"),
		idea("c", "2025-03-03T06:00:00Z"),
		idea("d", "2025-03-04T06:00:00Z", { stage: "done" }),
	];
	const ranked = rankIdeas(ideas, new Map([["a", -1], ["b", 2], ["c", 2], ["d", 9]]));
	assert.deepEqual(
		ranked.map((i) => [i.id, i.score, i.rank]),
		[["b", 2, 1], ["c", 2, 2], ["a", -1, 3]],
	);
});

test("the month board keeps ideas posted that Dhaka month", () => {
	const ideas = [
		idea("feb", "2025-02-28T17:59:00Z"), // 23:59 on 28 Feb in Dhaka
		idea("mar", "2025-02-28T18:00:00Z"), // 00:00 on 1 Mar in Dhaka
	];
	assert.deepEqual(rankIdeas(ideas, new Map(), "2025-03").map((i) => i.id), ["mar"]);
	assert.deepEqual(rankIdeas(ideas, new Map()).map((i) => i.id), ["feb", "mar"]);
});

const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};

test("the idea form trims, needs a title and caps lengths", () => {
	assert.deepEqual(parseIdeaForm(form({ title: "  Standing \n desks ", details: " Please\r\n ", anonymous: "on" })), {
		ok: true,
		idea: { title: "Standing desks", details: "Please", anonymous: true },
	});
	const empty = parseIdeaForm(form({ title: "  " }));
	assert.equal(empty.ok, false);
	assert.ok(!empty.ok && empty.errors.title);
	const long = parseIdeaForm(form({ title: "x".repeat(121), details: "y".repeat(1001) }));
	assert.ok(!long.ok && long.errors.title && long.errors.details);
	assert.equal(parseIdeaForm(form({ title: "x".repeat(120), details: "y".repeat(1000) })).ok, true);
});

test("idea posts have their own daily limit, apart from gallery uploads", () => {
	const db = new DatabaseSync(":memory:");
	const ideas = new UploadLimit(db, "idea_posts");
	const gallery = new UploadLimit(db);
	assert.equal(ideas.take("p", "2025-03-01", 1), true);
	assert.equal(ideas.take("p", "2025-03-01", 1), false);
	assert.equal(gallery.take("p", "2025-03-01", 1), true);
});
