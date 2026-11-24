/** Rows from before the `active` field existed have no value: only an explicit false is inactive. */
export const isActive = (p: { data: { active?: boolean | null } }) => p.data.active !== false;

export function initials(name: string): string {
	const words = name.split(/\s+/).filter(Boolean);
	return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

/** Groups by team, teams A–Z, people with no team last. Each group keeps the input order. */
export function groupByTeam<T extends { data: { team?: string | null } }>(people: T[]): [string | null, T[]][] {
	const groups = new Map<string | null, T[]>();
	for (const p of people) {
		const team = p.data.team?.trim() || null;
		groups.set(team, [...(groups.get(team) ?? []), p]);
	}
	return [...groups].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
}
