/** Rows from before the `active` field existed have no value: only an explicit false is inactive. */
export const isActive = (p: { data: { active?: boolean | null } }) => p.data.active !== false;

/** What the hub calls someone: their preferred name if set, else the full name. */
export const displayName = (d: { name: string; preferred_name?: string | null }) => d.preferred_name?.trim() || d.name;

/** People search: public fields only (never contact details), case-insensitive. */
export function matchesPerson(
	d: { name: string; preferred_name?: string | null; designation?: string | null; team?: string | null },
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	return [d.name, d.preferred_name, d.designation, d.team].some((v) => v?.toLowerCase().includes(needle));
}

export function initials(name: string): string {
	const words = name.split(/\s+/).filter(Boolean);
	return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : name.slice(0, 2)).toUpperCase();
}

/** Teams listed first on the People page, in this order. */
export const TEAM_ORDER = ["Leadership", "Admin", "Engineering", "Marketing", "Office"];

const teamRank = (team: string) => {
	const i = TEAM_ORDER.indexOf(team);
	return i < 0 ? TEAM_ORDER.length : i;
};

/** Groups by team: TEAM_ORDER first, other teams A–Z, people with no team last. Each group keeps the input order. */
export function groupByTeam<T extends { data: { team?: string | null } }>(people: T[]): [string | null, T[]][] {
	const groups = new Map<string | null, T[]>();
	for (const p of people) {
		const team = p.data.team?.trim() || null;
		groups.set(team, [...(groups.get(team) ?? []), p]);
	}
	return [...groups].sort(([a], [b]) =>
		a === null ? 1 : b === null ? -1 : teamRank(a) - teamRank(b) || a.localeCompare(b),
	);
}
