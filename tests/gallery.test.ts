import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { UploadLimit } from "../src/staff/uploads.ts";
import { bentoSize, MAX_CAPTION, MAX_GALLERY_BYTES, parseGalleryUpload } from "../src/utils/gallery.ts";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const formOf = (fields: Record<string, string | File>) => {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return form;
};

test("featured photos are big whatever their shape", () => {
	assert.equal(bentoSize({ featured: true, width: 3000, height: 1000 }, 0), "big");
});

test("aspect ratio picks wide, tall or small", () => {
	assert.equal(bentoSize({ width: 1500, height: 1000 }, 0), "wide");
	assert.equal(bentoSize({ width: 750, height: 1000 }, 0), "tall");
	assert.equal(bentoSize({ width: 1200, height: 1000 }, 0), "small");
	assert.equal(bentoSize({ width: 1200, height: 1000, featured: false }, 1), "small");
});

test("unknown dimensions are small, and every 7th plain tile is promoted to big", () => {
	assert.equal(bentoSize({}, 0), "small");
	assert.equal(bentoSize({ width: 1200, height: 1000 }, 6), "big");
	assert.equal(bentoSize({}, 13), "big");
	// A wide photo keeps its shape even on the 7th slot.
	assert.equal(bentoSize({ width: 2000, height: 1000 }, 6), "wide");
});

test("a valid photo is sniffed and the caption trimmed", async () => {
	const r = await parseGalleryUpload(formOf({ photo: new File([PNG], "x.jpg", { type: "image/jpeg" }), caption: "  Tea time \r\n" }));
	assert.equal(r.ok, true);
	if (r.ok) {
		assert.equal(r.photo.contentType, "image/png");
		assert.equal(r.photo.filename, "gallery.png");
		assert.equal(r.caption, "Tea time");
	}
});

test("a missing photo, a non-image, an oversize file and a long caption are refused", async () => {
	const photoError = async (file?: File) => {
		const r = await parseGalleryUpload(formOf(file ? { photo: file } : {}));
		return r.ok ? null : r.errors.photo;
	};
	assert.match((await photoError()) ?? "", /Choose a photo/);
	assert.match((await photoError(new File(["<script>"], "x.png", { type: "image/png" }))) ?? "", /JPEG, PNG or WebP/);
	assert.match((await photoError(new File([new Uint8Array(MAX_GALLERY_BYTES + 1)], "big.png"))) ?? "", /5 MB/);
	const long = await parseGalleryUpload(formOf({ photo: new File([PNG], "x.png"), caption: "a".repeat(MAX_CAPTION + 1) }));
	assert.equal(long.ok, false);
	if (!long.ok) assert.ok(long.errors.caption);
});

test("upload limit allows max per person per day, then refuses; release gives a slot back", () => {
	const limit = new UploadLimit(new DatabaseSync(":memory:"));
	for (let i = 0; i < 3; i++) assert.equal(limit.take("rina", "2025-01-01", 3), true);
	assert.equal(limit.take("rina", "2025-01-01", 3), false);
	assert.equal(limit.take("karim", "2025-01-01", 3), true);
	assert.equal(limit.take("rina", "2025-01-02", 3), true);
	limit.release("rina", "2025-01-01");
	assert.equal(limit.take("rina", "2025-01-01", 3), true);
	assert.equal(limit.take("rina", "2025-01-01", 3), false);
});
