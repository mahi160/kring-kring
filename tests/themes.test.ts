import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { THEMES, resolveTheme } from "../src/utils/theme.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

function declarations(block: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [, name, value] of block.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
	return out;
}

const root = declarations(read("../src/styles/theme.css").match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "");
const themeBlocks = new Map<string, Record<string, string>>();
for (const [, id, body] of read("../src/styles/themes.css").matchAll(/\[data-theme="([\w-]+)"\]\s*\{([\s\S]*?)\n\}/g)) {
	themeBlocks.set(id, { ...root, ...declarations(body) });
}

function luminance(hex: string): number {
	assert.match(hex, /^#[0-9a-f]{6}$/i, `not a #rrggbb colour: ${hex}`);
	const [r, g, b] = [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

test("every registered theme has a CSS block and vice versa", () => {
	assert.deepEqual([...themeBlocks.keys()].sort(), THEMES.map((t) => t.id).sort());
});

for (const { id } of THEMES) {
	test(`theme ${id} keeps text readable (4.5:1)`, () => {
		const t = themeBlocks.get(id);
		assert.ok(t);
		const pairs: [string, string][] = [
			["--ink", "--paper"],
			["--ink", "--sheet"],
			["--slate", "--paper"],
			["--slate", "--sheet"],
			["--accent-ink", "--paper"],
			["--accent-ink", "--sheet"],
			["--on-accent", "--accent-ink"],
			["--on-highlight", "--highlight"],
			["--ink", "--note-yellow"],
			["--ink", "--note-mint"],
			["--ink", "--note-pink"],
			["--ink", "--note-sky"],
		];
		if (t["--face"]) pairs.push(["--on-face", "--face"]);
		const low = pairs
			.map(([fg, bg]) => ({ fg, bg, ratio: contrast(t[fg], t[bg]) }))
			.filter((p) => p.ratio < 4.5)
			.map((p) => `${p.fg} ${t[p.fg]} on ${p.bg} ${t[p.bg]} is ${p.ratio.toFixed(2)}:1`);
		assert.deepEqual(low, []);
	});
}

// Dhaka is UTC+6, so 18:00 UTC is already the next day there.
const at = (iso: string) => new Date(iso);

test("auto picks the weekday theme in Dhaka", () => {
	assert.equal(resolveTheme(at("2026-11-22T06:00:00Z"), "auto"), "sunday"); // Sun
	assert.equal(resolveTheme(at("2026-11-24T06:00:00Z"), null), "tuesday");
	assert.equal(resolveTheme(at("2026-11-28T06:00:00Z"), undefined), "saturday");
	assert.equal(resolveTheme(at("2026-11-24T18:30:00Z"), "auto"), "wednesday");
});

test("auto picks the fixed-date special theme", () => {
	assert.equal(resolveTheme(at("2026-10-31T06:00:00Z"), "auto"), "halloween");
	assert.equal(resolveTheme(at("2026-12-16T06:00:00Z"), "auto"), "victory-day");
	assert.equal(resolveTheme(at("2026-03-26T06:00:00Z"), "auto"), "independence-day");
	assert.equal(resolveTheme(at("2026-04-14T06:00:00Z"), "auto"), "pohela-boishakh");
	assert.equal(resolveTheme(at("2026-01-01T06:00:00Z"), "auto"), "new-year");
	assert.equal(resolveTheme(at("2026-10-30T18:00:00Z"), "auto"), "halloween"); // Oct 31 in Dhaka
});

test("an explicit theme always wins, even on a special date", () => {
	assert.equal(resolveTheme(at("2026-10-31T06:00:00Z"), "winter"), "winter");
	assert.equal(resolveTheme(at("2026-11-24T06:00:00Z"), "eid"), "eid");
});

test("an unknown setting falls back to auto", () => {
	assert.equal(resolveTheme(at("2026-11-24T06:00:00Z"), "nope"), "tuesday");
	assert.equal(resolveTheme(at("2026-10-31T06:00:00Z"), ""), "halloween");
});

test("random is stable within a Dhaka day and varies across days", () => {
	const morning = resolveTheme(at("2026-11-24T00:00:00Z"), "random");
	assert.equal(resolveTheme(at("2026-11-24T17:59:00Z"), "random"), morning);
	const ids = new Set(THEMES.map((t) => t.id));
	const seen = new Set<string>();
	for (let d = 1; d <= 28; d++) {
		const id = resolveTheme(at(`2026-02-${String(d).padStart(2, "0")}T06:00:00Z`), "random");
		assert.ok(ids.has(id));
		seen.add(id);
	}
	assert.ok(seen.size > 5);
});
