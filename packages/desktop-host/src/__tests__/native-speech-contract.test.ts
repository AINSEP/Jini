import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
test("native recognition is explicitly local and probes do not request authorization", () => {
  const helper = fs.readFileSync(path.join(sourceRoot, "speech/macos/speech-helper.swift"), "utf8");
  assert.match(helper, /request\.requiresOnDeviceRecognition = true/);
  assert.match(helper, /Locale\(identifier: locale\)/);
  const probe = helper.slice(helper.indexOf("func runCheck"), helper.indexOf("func runTranscribe"));
  assert.match(probe, /SFSpeechRecognizer\.authorizationStatus\(\)/);
  assert.doesNotMatch(probe, /resolveSpeechAuthorization|requestAuthorization/);
});
