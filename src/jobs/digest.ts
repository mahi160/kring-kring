import type { DatabaseSync } from "node:sqlite";
import { parseModelJson, type AiClient } from "./ai.ts";

export interface DigestSource {
	kind: "announcement" | "event";
	title: string;
	/** Short context: an excerpt, or when/where for events. */
	detail: string;
}

export interface DigestLine {
	title: string;
	text: string;
}

/** Plain text of a Portable Text value: block text only, paragraphs separated by blank lines. */
export function portableTextToPlain(value: unknown): string {
	if (!Array.isArray(value)) return "";
	return value
		.map((block) => {
			const children = Reflect.get(Object(block), "children");
			if (Reflect.get(Object(block), "_type") !== "block" || !Array.isArray(children)) return "";
			return children.map((c) => String(Reflect.get(Object(c), "text") ?? "")).join("");
		})
		.map((p) => p.trim())
		.filter(Boolean)
		.join("\n\n");
}

const MAX_LINES = 3;
const MAX_TEXT = 220;
export const DIGEST_HOUR = 9;

export const DIGEST_SCHEMA = {
	type: "object",
	properties: {
		lines: {
			type: "array",
			minItems: 1,
			maxItems: MAX_LINES,
			items: {
				type: "object",
				properties: { item: { type: "string" }, text: { type: "string" } },
				required: ["item", "text"],
			},
		},
	},
	required: ["lines"],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Checks model output against the sources it was given. Every line must name one of
 * the source titles exactly; one invented item fails the whole digest.
 */
export function parseDigest(raw: string, sources: DigestSource[]): DigestLine[] {
	const lines = Reflect.get(Object(parseModelJson(raw)), "lines");
	if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) throw new Error("digest: wrong number of lines");
	const titles = new Map(sources.map((s) => [norm(s.title), s.title]));
	return lines.map((line) => {
		const item = Reflect.get(Object(line), "item");
		const text = Reflect.get(Object(line), "text");
		const title = typeof item === "string" ? titles.get(norm(item)) : undefined;
		if (!title) throw new Error(`digest: unknown item ${JSON.stringify(item)}`);
		if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) throw new Error("digest: bad line text");
		return { title, text: text.trim() };
	});
}

export function digestPrompt(sources: DigestSource[]) {
	const list = sources.map((s) => `- [${s.kind}] "${s.title}": ${s.detail}`).join("\n");
	return [
		{
			role: "system" as const,
			content:
				"You write a cheerful three-line morning digest for an office noticeboard. Use only the items listed. " +
				"Each line covers one item, is one short sentence, and `item` must be that item's exact title. " +
				"Never add facts that aren't in the list. Reply only with JSON.",
		},
		{ role: "user" as const, content: `Today's items:\n${list}` },
	];
}

export async function writeDigest(ai: AiClient, sources: DigestSource[], signal: AbortSignal): Promise<DigestLine[]> {
	return parseDigest(await ai.chat(digestPrompt(sources), { signal, schema: DIGEST_SCHEMA, maxTokens: 400 }), sources);
}

/** One digest per Dhaka day. */
export class DigestStore {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
		db.exec("CREATE TABLE IF NOT EXISTS digests (day TEXT PRIMARY KEY, lines TEXT NOT NULL, created_at INTEGER NOT NULL)");
	}

	save(day: string, lines: DigestLine[], now: Date): void {
		this.db
			.prepare("INSERT OR REPLACE INTO digests (day, lines, created_at) VALUES (?, ?, ?)")
			.run(day, JSON.stringify(lines), now.getTime());
	}

	forDay(day: string): DigestLine[] | null {
		const row = this.db.prepare("SELECT lines FROM digests WHERE day = ?").get(day);
		// Written only by save() above, from parseDigest() output.
		return row ? JSON.parse(String(row.lines)) : null;
	}
}
