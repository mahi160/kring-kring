import { parseModelJson, type AiClient } from "./ai.ts";

export interface QuizDraft {
	question: string;
	choices: string[];
	/** 1-based, like the admin field. */
	correct: number;
	explanation: string | null;
}

export const DRAFTS_PER_NIGHT = 3;
const MAX_LEN = 200;

export const DRAFT_SCHEMA = {
	type: "object",
	properties: {
		questions: {
			type: "array",
			items: {
				type: "object",
				properties: {
					question: { type: "string" },
					choices: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 },
					correct: { type: "integer", minimum: 1, maximum: 4 },
					explanation: { type: "string" },
				},
				required: ["question", "choices", "correct"],
			},
		},
	},
	required: ["questions"],
};

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** One draft in the question-bank shape, or null. */
export function toDraft(v: unknown): QuizDraft | null {
	if (typeof v !== "object" || v === null) return null;
	const question = str(Reflect.get(v, "question"));
	const rawChoices = Reflect.get(v, "choices");
	const correct = Reflect.get(v, "correct");
	if (!question || question.length > MAX_LEN || !Array.isArray(rawChoices)) return null;
	const choices = rawChoices.map(str);
	const distinct = new Set(choices.map((c) => c.toLowerCase()));
	if (
		choices.length < 2 ||
		choices.length > 4 ||
		choices.some((c) => !c || c.length > MAX_LEN) ||
		distinct.size !== choices.length ||
		typeof correct !== "number" ||
		!Number.isInteger(correct) ||
		correct < 1 ||
		correct > choices.length
	) {
		return null;
	}
	return { question, choices, correct, explanation: str(Reflect.get(v, "explanation")) || null };
}

/** Valid drafts from model output; malformed output yields none. */
export function parseDrafts(raw: string): { drafts: QuizDraft[]; malformed: number } {
	let list: unknown;
	try {
		list = Reflect.get(Object(parseModelJson(raw)), "questions");
	} catch {
		return { drafts: [], malformed: 1 };
	}
	if (!Array.isArray(list)) return { drafts: [], malformed: 1 };
	const drafts = list.map(toDraft).filter((d) => d !== null);
	return { drafts, malformed: list.length - drafts.length };
}

const words = (s: string) =>
	new Set(
		s
			.toLowerCase()
			.replace(/[^\p{L}\p{N}\s]/gu, " ")
			.split(/\s+/)
			.filter((w) => w.length > 2 && !STOP.has(w)),
	);
const STOP = new Set(["the", "and", "what", "which", "who", "how", "does", "for", "was", "are", "is", "of", "in"]);

/** A question already in the bank (or drafted), with its correct answer when known. */
export interface KnownQuestion {
	question: string;
	answer: string | null;
}

const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Same question in other words: most meaningful words shared (Jaccard ≥ 0.8), or
 * half of them shared with the same correct answer ("flows past" vs "flows through").
 */
export function isNearDuplicate(a: KnownQuestion, b: KnownQuestion): boolean {
	const wa = words(a.question);
	const wb = words(b.question);
	if (wa.size === 0 || wb.size === 0) return same(a.question, b.question);
	let shared = 0;
	for (const w of wa) if (wb.has(w)) shared++;
	const similarity = shared / (wa.size + wb.size - shared);
	return similarity >= 0.8 || (similarity >= 0.5 && same(a.answer, b.answer));
}

const known = (d: QuizDraft): KnownQuestion => ({ question: d.question, answer: d.choices[d.correct - 1] ?? null });

/** Drops drafts that repeat an existing question or an earlier draft in the same batch. */
export function dedupeDrafts(drafts: QuizDraft[], existing: KnownQuestion[]): { fresh: QuizDraft[]; duplicates: number } {
	const seen = [...existing];
	const fresh: QuizDraft[] = [];
	for (const d of drafts) {
		if (seen.some((q) => isNearDuplicate(q, known(d)))) continue;
		seen.push(known(d));
		fresh.push(d);
	}
	return { fresh, duplicates: drafts.length - fresh.length };
}

export function draftPrompt(existing: KnownQuestion[], count = DRAFTS_PER_NIGHT) {
	const avoid = existing
		.slice(-30)
		.map((q) => `- ${q.question}`)
		.join("\n");
	return [
		{
			role: "system" as const,
			content:
				"You write questions for a friendly daily office quiz in Dhaka, Bangladesh. Mix general knowledge, science, " +
				"tech, Bangladesh, food and fun facts. Keep them light, fair, and safe for work: no politics, religion or tragedy. " +
				"Each question has 2 to 4 short choices, exactly one correct; `correct` is the 1-based number of the right choice. " +
				"Add a one-sentence explanation. Reply only with JSON.",
		},
		{
			role: "user" as const,
			content: `Write ${count} new questions.${avoid ? `\nDon't repeat these:\n${avoid}` : ""}`,
		},
	];
}

export interface DraftWriter {
	existingQuestions(): Promise<KnownQuestion[]>;
	saveDraft(d: QuizDraft): Promise<void>;
}

/** Asks the model for drafts and saves the valid, new ones unapproved. Returns a summary. */
export async function writeQuizDrafts(ai: AiClient, writer: DraftWriter, signal: AbortSignal): Promise<string> {
	const existing = await writer.existingQuestions();
	const raw = await ai.chat(draftPrompt(existing), { signal, schema: DRAFT_SCHEMA, maxTokens: 900 });
	const { drafts, malformed } = parseDrafts(raw);
	const { fresh, duplicates } = dedupeDrafts(drafts, existing);
	for (const d of fresh) await writer.saveDraft(d);
	return `Saved ${fresh.length} draft(s) for review; skipped ${duplicates} duplicate(s) and ${malformed} malformed.`;
}
