import assert from "node:assert/strict";
import { test } from "node:test";
import { isCrossSite, safeNext } from "../src/staff/index.ts";

const req = (headers: Record<string, string>) =>
	new Request("http://hub.local/sign-out", { method: "POST", headers: { host: "hub.local", ...headers } });

test("isCrossSite blocks forms posted from other sites", () => {
	assert.equal(isCrossSite(req({ "sec-fetch-site": "cross-site" })), true);
	assert.equal(isCrossSite(req({ "sec-fetch-site": "same-site" })), true);
	assert.equal(isCrossSite(req({ "sec-fetch-site": "same-origin" })), false);
	assert.equal(isCrossSite(req({ origin: "http://evil.example" })), true);
	assert.equal(isCrossSite(req({ origin: "http://hub.local" })), false);
	assert.equal(isCrossSite(req({ origin: "null" })), true);
	assert.equal(isCrossSite(req({})), false);
});

test("safeNext keeps redirects on this site", () => {
	assert.equal(safeNext("/posts?x=1"), "/posts?x=1");
	for (const bad of ["//evil.com", "/\\evil.com", "https://evil.com", "", null]) assert.equal(safeNext(bad), "/");
});
