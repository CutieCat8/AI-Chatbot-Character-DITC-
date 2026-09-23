import {
  createWLipSyncNode,
  parseBinaryProfile,
} from "../node_modules/wlipsync/dist/wlipsync-single.js";

const runButton = document.querySelector("#run");
const status = document.querySelector("#status");
const output = document.querySelector("#output");

const capturedErrors = [];
window.addEventListener("error", (event) => capturedErrors.push(`window.error: ${event.message}`));
window.addEventListener("unhandledrejection", (event) => {
  capturedErrors.push(`unhandledrejection: ${String(event.reason)}`);
});

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function clone(value) {
  return structuredClone(value);
}

function makeProfileVariant(source, entryCount) {
  const profile = clone(source);
  profile.mfccs = Array.from({ length: entryCount }, (_, index) => {
    const entry = clone(source.mfccs[index % source.mfccs.length]);
    // Every two acoustic prototypes deliberately share one output label.
    entry.name = `label-${Math.floor(index / 2)}`;
    return entry;
  });
  return JSON.parse(JSON.stringify(profile));
}

function createDeterministicAudio(context, durationSeconds = 0.9) {
  const frameCount = Math.ceil(context.sampleRate * durationSeconds);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const channel = buffer.getChannelData(0);

  for (let index = 0; index < frameCount; index += 1) {
    const time = index / context.sampleRate;
    const envelope = Math.min(1, time * 40, (durationSeconds - time) * 40);
    channel[index] = envelope * (
      0.24 * Math.sin(2 * Math.PI * 220 * time)
      + 0.13 * Math.sin(2 * Math.PI * 880 * time)
      + 0.07 * Math.sin(2 * Math.PI * 2400 * time)
    );
  }

  return buffer;
}

function finiteRecord(record) {
  return Object.values(record).every(Number.isFinite);
}

async function exerciseProfile(context, name, profile, expectedEntries, expectedLabels) {
  const processorErrors = [];
  const messages = [];
  const node = await createWLipSyncNode(context, profile);
  node.smoothness = 0.01;
  node.addEventListener("processorerror", (event) => {
    processorErrors.push(event.message || "AudioWorklet processorerror");
  });
  node.port.addEventListener("message", (event) => {
    messages.push({ ...event.data });
  });
  node.port.start();

  const source = context.createBufferSource();
  source.buffer = createDeterministicAudio(context);
  source.connect(node);
  source.start();
  await new Promise((resolve) => source.addEventListener("ended", resolve, { once: true }));
  await wait(80);

  const weights = { ...node.weights };
  const labelNames = Object.keys(weights).sort();
  const rawNames = [...new Set(messages.map((message) => message.name))].sort();
  const finiteMessages = messages.every((message) => (
    Number.isFinite(message.timestamp)
    && Number.isInteger(message.index)
    && Number.isFinite(message.volume)
    && typeof message.name === "string"
  ));
  const hasActiveWeight = Object.values(weights).some((value) => value > 0);

  const assertions = {
    profileShapeParsed: Array.isArray(profile.mfccs) && profile.mfccs.every((entry) => (
      typeof entry.name === "string"
      && (Array.isArray(entry.mfccCalibrationDataList) || Array.isArray(entry.values))
    )),
    profileEntryCount: profile.mfccs.length === expectedEntries,
    outputLabelCount: labelNames.length === expectedLabels,
    duplicateLabelsCombined: expectedLabels < expectedEntries && labelNames.length === expectedLabels,
    receivedWorkletMessages: messages.length > 0,
    finiteRawMessages: finiteMessages,
    finiteWeights: finiteRecord(weights),
    finiteVolume: Number.isFinite(node.volume),
    nonZeroVolume: node.volume > 0,
    activeWeightObserved: hasActiveWeight,
    noProcessorError: processorErrors.length === 0,
  };

  source.disconnect();
  node.disconnect();
  node.port.close();

  return {
    name,
    assertions,
    entryCount: profile.mfccs.length,
    expectedLabels,
    outputLabels: labelNames,
    rawNames,
    messageCount: messages.length,
    finalVolume: node.volume,
    finalWeights: weights,
    processorErrors,
    passed: Object.values(assertions).every(Boolean),
  };
}

async function runSmokeTest() {
  status.textContent = "Running…";
  output.textContent = "";
  capturedErrors.length = 0;

  const jsonResponse = await fetch("./fixtures/official/profile.json");
  const binaryResponse = await fetch("./fixtures/official/profile.bin");
  if (!jsonResponse.ok || !binaryResponse.ok) {
    throw new Error(`Fixture fetch failed: JSON=${jsonResponse.status}, BIN=${binaryResponse.status}`);
  }

  const officialJson = await jsonResponse.json();
  const officialBinary = parseBinaryProfile(await binaryResponse.arrayBuffer());
  const context = new AudioContext();
  await context.resume();

  const tests = [];
  tests.push(await exerciseProfile(
    context,
    "official-profile.json",
    officialJson,
    12,
    new Set(officialJson.mfccs.map((entry) => entry.name)).size,
  ));
  tests.push(await exerciseProfile(
    context,
    "official-profile.bin",
    officialBinary,
    12,
    new Set(officialBinary.mfccs.map((entry) => entry.name)).size,
  ));

  for (const entryCount of [8, 12, 16]) {
    const generatedJsonResponse = await fetch(`./fixtures/generated/profile-${entryCount}.json`);
    const generatedBinaryResponse = await fetch(`./fixtures/generated/profile-${entryCount}.bin`);
    if (!generatedJsonResponse.ok || !generatedBinaryResponse.ok) {
      throw new Error(
        `Generated fixture fetch failed for ${entryCount}: JSON=${generatedJsonResponse.status}, BIN=${generatedBinaryResponse.status}`,
      );
    }
    const generatedJson = await generatedJsonResponse.json();
    const generatedBinary = parseBinaryProfile(await generatedBinaryResponse.arrayBuffer());

    tests.push(await exerciseProfile(
      context,
      `generated-json-${entryCount}-entries`,
      generatedJson,
      entryCount,
      entryCount / 2,
    ));
    tests.push(await exerciseProfile(
      context,
      `generated-bin-${entryCount}-entries`,
      generatedBinary,
      entryCount,
      entryCount / 2,
    ));
  }

  await context.close();
  const report = {
    userAgent: navigator.userAgent,
    crossOriginIsolated: window.crossOriginIsolated,
    tests,
    capturedErrors: [...capturedErrors],
    passed: tests.every((test) => test.passed) && capturedErrors.length === 0,
    scope: "Structural/runtime behavior only; no phoneme accuracy claim.",
  };

  window.__WLIPSYNC_SMOKE_REPORT__ = report;
  status.textContent = report.passed ? "PASS" : "FAIL";
  status.className = report.passed ? "pass" : "fail";
  output.textContent = JSON.stringify(report, null, 2);
  console.info("WLIPSYNC_SMOKE_REPORT", report);
}

runButton.addEventListener("click", () => {
  runSmokeTest().catch((error) => {
    capturedErrors.push(error.stack || String(error));
    const report = {
      passed: false,
      capturedErrors: [...capturedErrors],
      scope: "Structural/runtime behavior only; no phoneme accuracy claim.",
    };
    window.__WLIPSYNC_SMOKE_REPORT__ = report;
    status.textContent = "FAIL";
    status.className = "fail";
    output.textContent = JSON.stringify(report, null, 2);
    console.error(error);
  });
});
