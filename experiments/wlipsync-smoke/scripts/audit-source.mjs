const findings = [];
const sources = [
  "https://raw.githubusercontent.com/mrxz/wLipSync/v1.3.1/src/constants.h",
  "https://raw.githubusercontent.com/mrxz/wLipSync/v1.3.1/src/main.c",
];

for (const sourceUrl of sources) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch v1.3.1 source: HTTP ${response.status}`);
  }

  const source = await response.text();
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      line.includes("#define MFCC_NUM")
      || line.includes("float mfccOut")
      || line.includes("for(int i = 1; i <= profile.mfccCount")
      || line.includes("profile.mfccCount = mfccCount")
    ) {
      findings.push({ sourceUrl, line: index + 1, source: line.trim() });
    }
  }
}

console.log(JSON.stringify({ findings }, null, 2));

const loopFinding = findings.find((finding) => finding.source.includes("for(int i = 1"));
const constantFinding = findings.find((finding) => finding.source.includes("#define MFCC_NUM"));
if (!loopFinding || !constantFinding) {
  process.exitCode = 1;
}
