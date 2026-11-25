import { getEmDashCollection } from "emdash";
import { dhakaDay } from "../comics/store.ts";

export const MAX_TITLE = 120;
export const MAX_DETAILS = 1000;
export const MAX_IDEAS_PER_DAY = 3;
const MAX_IDEAS = 1000;

export const STAGES = ["open", "planned", "done", "declined"] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABELS: Record<Stage, string> = { open: "Open", planned: "Planned", done: "Done", declined: "Declined" };

type IdeaEntry = Awaited<ReturnType<typeof getEmDashCollection<"ideas">>>["entries"][number];

export interface Idea {
	/** Database ULID: the key for votes and the form fields. */
	id: string;
	title: string;
	details: string;
	stage: Stage;
	anonymous: boolean;
	/** Person ULID of the poster. Never render it for anonymous ideas. */
	postedById: string | null;
	postedBy: string;
	postedAt: Date;
}

export interface RankedIdea extends Idea {
	votes: number;
	rank: number;
}

function toIdea(e: IdeaEntry): Idea {
	const d = e.data;
	const stage = STAGES.find((s) => s === d.stage) ?? "open";
	return {
		id: d.id,
		title: d.title,
		details: d.details ?? "",
		stage,
		anonymous: d.anonymous === true,
		postedById: d.posted_by_id || null,
		postedBy: d.posted_by ?? "",
		postedAt: new Date(d.createdAt),
	};
}

/** Published ideas, oldest first. */
export async function getIdeas(): Promise<Idea[]> {
	const { entries, error } = await getEmDashCollection("ideas", { limit: MAX_IDEAS, orderBy: { created_at: "asc" } });
	if (error) console.error("Failed to load ideas:", error);
	return entries.map(toIdea);
}

/** Dhaka month of a date, YYYY-MM. */
export const dhakaMonth = (d: Date) => dhakaDay(d).slice(0, 7);

/**
 * Open ideas, most votes first; the earlier idea wins a tie, so ranks never repeat.
 * With `month` (YYYY-MM), only ideas posted in that Dhaka month.
 */
export function rankIdeas(ideas: Idea[], votes: Map<string, number>, month?: string): RankedIdea[] {
	return ideas
		.filter((i) => i.stage === "open" && (!month || dhakaMonth(i.postedAt) === month))
		.map((i) => ({ ...i, votes: votes.get(i.id) ?? 0, rank: 0 }))
		.sort((a, b) => b.votes - a.votes || a.postedAt.getTime() - b.postedAt.getTime())
		.map((i, n) => ({ ...i, rank: n + 1 }));
}

export interface IdeaForm {
	title: string;
	details: string;
	anonymous: boolean;
}

export type IdeaFormResult =
	| { ok: true; idea: IdeaForm }
	| { ok: false; errors: { title?: string; details?: string }; idea: IdeaForm };

const text = (v: FormDataEntryValue | null) => (typeof v === "string" ? v.replaceAll("\r\n", "\n").trim() : "");

/** Validates the "Share an idea" form. */
export function parseIdeaForm(form: FormData): IdeaFormResult {
	const idea = {
		title: text(form.get("title")).replaceAll(/\s+/g, " "),
		details: text(form.get("details")),
		anonymous: form.get("anonymous") === "on",
	};
	const errors: { title?: string; details?: string } = {};
	if (!idea.title) errors.title = "Give your idea a title.";
	else if (idea.title.length > MAX_TITLE) errors.title = `The title can be at most ${MAX_TITLE} characters.`;
	if (idea.details.length > MAX_DETAILS) errors.details = `The details can be at most ${MAX_DETAILS} characters.`;
	return Object.keys(errors).length > 0 ? { ok: false, errors, idea } : { ok: true, idea };
}
