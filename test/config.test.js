import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

test("loadConfig reads .env without overriding exported environment", async () => {
  const dir = await mkdtemp(join(tmpdir(), "trenches-env-"));
  await writeFile(join(dir, ".env"), [
    "TRENCHES_SOURCE=mock",
    "TRENCHES_SCAN_ONCE=false",
    "TRENCHES_BANKROLL_USD=321",
    "GMGN_LIVE_AUTH_CONFIG='{\"apiKey\":\"from-file\"}'",
  ].join("\n"));

  const oldCwd = process.cwd();
  const oldValues = snapshotEnv(["TRENCHES_SOURCE", "TRENCHES_SCAN_ONCE", "TRENCHES_BANKROLL_USD", "GMGN_LIVE_AUTH_CONFIG"]);
  process.chdir(dir);
  try {
    clearEnv(Object.keys(oldValues));
    const fromFile = loadConfig();
    assert.equal(fromFile.source, "mock");
    assert.equal(fromFile.scanOnce, false);
    assert.equal(fromFile.startingBankrollUsd, 321);
    assert.equal(fromFile.gmgnApiKey, "from-file");

    process.env.TRENCHES_SOURCE = "gmgn";
    const fromShell = loadConfig();
    assert.equal(fromShell.source, "gmgn");
  } finally {
    process.chdir(oldCwd);
    restoreEnv(oldValues);
  }
});

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys) {
  for (const key of keys) delete process.env[key];
}

function restoreEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
