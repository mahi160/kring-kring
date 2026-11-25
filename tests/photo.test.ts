import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { MAX_PHOTO_SIDE, toStoredPhoto } from "../src/utils/photo.ts";

test("a phone photo is stored as upright WebP within the size cap, without metadata", async () => {
	// Landscape pixels with EXIF orientation 6 (rotate 90°) and a GPS-bearing EXIF block.
	const jpeg = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#c33" } })
		.jpeg()
		.withMetadata({ orientation: 6, exif: { IFD3: { GPSLatitudeRef: "N", GPSLatitude: "23/1 46/1 0/1" } } })
		.toBuffer();
	const stored = await toStoredPhoto({ filename: "gallery.jpg", base64: jpeg.toString("base64") });
	assert.ok(stored);
	assert.equal(stored.filename, "gallery.webp");
	assert.equal(stored.contentType, "image/webp");
	const meta = await sharp(Buffer.from(stored.base64, "base64")).metadata();
	assert.deepEqual([meta.format, meta.width, meta.height], ["webp", MAX_PHOTO_SIDE / 2, MAX_PHOTO_SIDE]);
	assert.equal(meta.exif, undefined);
	assert.equal(meta.orientation, undefined);
});

test("a small photo is not enlarged", async () => {
	const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#3c3" } }).png().toBuffer();
	const stored = await toStoredPhoto({ filename: "profile.png", base64: png.toString("base64") });
	assert.ok(stored);
	const meta = await sharp(Buffer.from(stored.base64, "base64")).metadata();
	assert.deepEqual([meta.width, meta.height], [200, 100]);
});

test("bytes that only look like an image are refused", async () => {
	const fake = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
	assert.equal(await toStoredPhoto({ filename: "x.jpg", base64: Buffer.from(fake).toString("base64") }), null);
});
