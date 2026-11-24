import { getEmDashCollection } from "emdash";
import { EXTENSION, sniffImage } from "./profile.ts";

export const MAX_GALLERY_BYTES = 5 * 1024 * 1024;
export const MAX_CAPTION = 140;
export const MAX_UPLOADS_PER_DAY = 10;
const MAX_PHOTOS = 200;

export type BentoSize = "big" | "wide" | "tall" | "small";

type Photo = Awaited<ReturnType<typeof getEmDashCollection<"gallery">>>["entries"][number];

/** Published photos, newest first. */
export async function getGalleryPhotos(): Promise<Photo[]> {
	const { entries, error } = await getEmDashCollection("gallery", {
		limit: MAX_PHOTOS,
		orderBy: { published_at: "desc" },
	});
	if (error) console.error("Failed to load gallery:", error);
	return entries;
}

/**
 * Tile shape on the wall: featured is big; otherwise the photo's aspect ratio decides
 * (landscape wide, portrait tall). Every 7th plain tile is promoted to big for variety.
 */
export function bentoSize(
	photo: { featured?: boolean | null; width?: number | null; height?: number | null },
	index: number,
): BentoSize {
	if (photo.featured) return "big";
	if (photo.width && photo.height) {
		const ratio = photo.width / photo.height;
		if (ratio >= 1.5) return "wide";
		if (ratio <= 0.75) return "tall";
	}
	return index % 7 === 6 ? "big" : "small";
}

export interface GalleryUpload {
	filename: string;
	contentType: "image/jpeg" | "image/png" | "image/webp";
	base64: string;
}

export type GalleryUploadResult =
	| { ok: true; photo: GalleryUpload; caption: string }
	| { ok: false; errors: { photo?: string; caption?: string }; caption: string };

/** Validates the staff "Add a photo" form: a sniffed image up to 5 MB and a trimmed caption. */
export async function parseGalleryUpload(form: FormData): Promise<GalleryUploadResult> {
	const raw = form.get("caption");
	const caption = typeof raw === "string" ? raw.replaceAll("\r\n", "\n").trim() : "";
	const errors: { photo?: string; caption?: string } = {};
	if (caption.length > MAX_CAPTION) errors.caption = `The caption can be at most ${MAX_CAPTION} characters.`;

	let photo: GalleryUpload | null = null;
	const file = form.get("photo");
	if (!(file instanceof File) || file.size === 0) {
		errors.photo = "Choose a photo to add.";
	} else if (file.size > MAX_GALLERY_BYTES) {
		errors.photo = "The photo must be 5 MB or smaller.";
	} else {
		const bytes = new Uint8Array(await file.arrayBuffer());
		const contentType = sniffImage(bytes);
		if (!contentType) errors.photo = "The photo must be a JPEG, PNG or WebP image.";
		else photo = { filename: `gallery.${EXTENSION[contentType]}`, contentType, base64: Buffer.from(bytes).toString("base64") };
	}
	if (!photo || Object.keys(errors).length > 0) return { ok: false, errors, caption };
	return { ok: true, photo, caption };
}
