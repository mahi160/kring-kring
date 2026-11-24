import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { HubSettings } from "../src/staff/settings.ts";

test("missing keys read as null, saved values read back, saving again overwrites", () => {
	const settings = new HubSettings(new DatabaseSync(":memory:"));
	assert.equal(settings.get("theme"), null);
	settings.set("theme", "random");
	assert.equal(settings.get("theme"), "random");
	settings.set("theme", "halloween");
	assert.equal(settings.get("theme"), "halloween");
	assert.equal(settings.get("other"), null);
});

test("values survive a new HubSettings on the same database", () => {
	const db = new DatabaseSync(":memory:");
	new HubSettings(db).set("theme", "eid");
	assert.equal(new HubSettings(db).get("theme"), "eid");
});
