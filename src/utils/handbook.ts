import { getEmDashCollection } from "emdash";

/** Reading order of topics; must match the topic options in seed/seed.json. */
export const TOPICS = [
	"Office basics",
	"Working hours & leave",
	"Tech & accounts",
	"Kitchen & tea",
	"Safety",
	"Culture",
] as const;

type Page = Awaited<ReturnType<typeof getEmDashCollection<"handbook">>>["entries"][number];

const topicRank = (topic: string) => TOPICS.findIndex((t) => t === topic);

/** All published handbook pages, in topic order then `order` then title. */
export async function getHandbookPages(): Promise<Page[]> {
	const { entries } = await getEmDashCollection("handbook", { limit: 1000 });
	return [...entries].sort(
		(a, b) =>
			topicRank(a.data.topic) - topicRank(b.data.topic) ||
			(a.data.order ?? 0) - (b.data.order ?? 0) ||
			a.data.title.localeCompare(b.data.title),
	);
}

/** Group pages (already sorted) by topic, keeping first-seen topic order. */
export function groupByTopic(pages: Page[]): { topic: string; pages: Page[] }[] {
	const groups = new Map<string, Page[]>();
	for (const p of pages) groups.set(p.data.topic, [...(groups.get(p.data.topic) ?? []), p]);
	return [...groups].map(([topic, pages]) => ({ topic, pages }));
}
