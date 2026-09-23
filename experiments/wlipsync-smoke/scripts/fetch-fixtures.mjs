import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = "https://raw.githubusercontent.com/mrxz/wLipSync/v1.3.1/example";
const fixtures = ["profile.json", "profile.bin"];
const outputDirectory = new URL("../fixtures/official/", import.meta.url);

await mkdir(outputDirectory, { recursive: true });

for (const filename of fixtures) {
  const response = await fetch(`${baseUrl}/${filename}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${filename}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await writeFile(new URL(filename, outputDirectory), bytes);
  console.log(`${filename}: ${bytes.byteLength} bytes`);
}
