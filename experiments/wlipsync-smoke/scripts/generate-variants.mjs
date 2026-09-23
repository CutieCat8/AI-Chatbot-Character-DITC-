import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const officialPath = new URL("../fixtures/official/profile.json", import.meta.url);
const outputDirectory = new URL("../fixtures/generated/", import.meta.url);
const converterPath = new URL("../node_modules/wlipsync/tools/json2bin.js", import.meta.url);
const source = JSON.parse(await readFile(officialPath, "utf8"));

await mkdir(outputDirectory, { recursive: true });

for (const entryCount of [8, 12, 16]) {
  const profile = structuredClone(source);
  profile.mfccs = Array.from({ length: entryCount }, (_, index) => {
    const entry = structuredClone(source.mfccs[index % source.mfccs.length]);
    entry.name = `label-${Math.floor(index / 2)}`;
    return entry;
  });

  const jsonPath = new URL(`profile-${entryCount}.json`, outputDirectory);
  const binaryPath = new URL(`profile-${entryCount}.bin`, outputDirectory);
  await writeFile(jsonPath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await execFileAsync(process.execPath, [
    fileURLToPath(converterPath),
    fileURLToPath(jsonPath),
    fileURLToPath(binaryPath),
  ]);
  console.log(`generated ${entryCount} entries: ${jsonPath.pathname}, ${binaryPath.pathname}`);
}
