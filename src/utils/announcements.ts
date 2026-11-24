export interface AnnouncementLike {
	data: {
		pinned?: boolean | null;
		expires_at?: string | null;
		publishedAt?: Date | null;
		createdAt: Date;
	};
}

/** Drops expired announcements; pinned first, then newest first. */
export function currentAnnouncements<T extends AnnouncementLike>(entries: T[], now: Date): T[] {
	const time = (d: AnnouncementLike["data"]) => (d.publishedAt ?? d.createdAt).getTime();
	return entries
		.filter(({ data }) => !data.expires_at || new Date(data.expires_at).getTime() > now.getTime())
		.sort((a, b) => Number(!!b.data.pinned) - Number(!!a.data.pinned) || time(b.data) - time(a.data));
}
