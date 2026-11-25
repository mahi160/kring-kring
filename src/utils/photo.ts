import sharp from "sharp";

/** Longest side kept on disk; pages request smaller sizes through the image endpoint. */
export const MAX_PHOTO_SIDE = 2048;

export interface StoredPhoto {
	filename: string;
	contentType: "image/webp";
	base64: string;
}

/**
 * Re-encodes an uploaded photo as WebP no larger than MAX_PHOTO_SIDE, upright per its
 * EXIF orientation, with all metadata (GPS included) dropped. Null if it can't be decoded.
 */
export async function toStoredPhoto(photo: { filename: string; base64: string }): Promise<StoredPhoto | null> {
	try {
		const webp = await sharp(Buffer.from(photo.base64, "base64"))
			.autoOrient()
			.resize({ width: MAX_PHOTO_SIDE, height: MAX_PHOTO_SIDE, fit: "inside", withoutEnlargement: true })
			.webp({ quality: 80 })
			.toBuffer();
		return { filename: photo.filename.replace(/\.[^.]+$/, ".webp"), contentType: "image/webp", base64: webp.toString("base64") };
	} catch {
		return null;
	}
}
