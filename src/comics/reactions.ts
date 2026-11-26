import { REACTION_KINDS, type ReactionKind } from "./store.ts";

const FACES: Record<ReactionKind, { label: string; hint: string }> = {
	dead: { label: "Dead", hint: "Laughed too hard" },
	mindblown: { label: "Mind blown", hint: "Did not see that coming" },
	tooreal: { label: "Too real", hint: "This is my life" },
	groan: { label: "Groan", hint: "That pun hurt" },
	same: { label: "Same here", hint: "I feel seen" },
	fire: { label: "Fire", hint: "Send it to the team" },
};

export interface ReactionView {
	kind: ReactionKind;
	label: string;
	/** One line of meaning, shown in the tooltip. */
	hint: string;
	count: number;
	mine: boolean;
	/** Who reacted, "You" first, unknown people left out. */
	names: string[];
}

/** One entry per reaction kind, for the comic card and the in-place JSON reply. */
export function reactionViews(
	reactors: Record<ReactionKind, string[]>,
	nameOf: (personId: string) => string | undefined,
	me: string | null,
): ReactionView[] {
	return REACTION_KINDS.map((kind) => {
		const ids = reactors[kind];
		const mine = me !== null && ids.includes(me);
		const others = ids.filter((id) => id !== me).flatMap((id) => nameOf(id) ?? []);
		return { kind, ...FACES[kind], count: ids.length, mine, names: mine ? ["You", ...others] : others };
	});
}

/** "You, Ann and 3 others": everyone who reacted, once each; empty with nobody. */
export function reactionSummary(views: ReactionView[]): string {
	const people = [...new Set(views.flatMap((v) => v.names))];
	if (people.includes("You")) people.unshift(...people.splice(people.indexOf("You"), 1));
	if (people.length <= 2) return people.join(" and ");
	const rest = people.length - 2;
	return `${people[0]}, ${people[1]} and ${rest} ${rest === 1 ? "other" : "others"}`;
}
