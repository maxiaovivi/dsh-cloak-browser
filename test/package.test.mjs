import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8")
);

test("DSH singleton runtime packages are provided by the host profile", () => {
  for (const packageName of [
    "@deepseek-ai/dsh-llm",
    "@deepseek-ai/dsh-tools"
  ]) {
    assert.equal(manifest.dependencies?.[packageName], undefined);
    assert.equal(manifest.peerDependencies?.[packageName], "^0.1.0-rc.6");
    assert.equal(manifest.devDependencies?.[packageName], "0.1.0-rc.6");
  }
});
