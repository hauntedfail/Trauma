import { createCapturedTabSnapshot } from "./capture";

function readExtensionVersion() {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

createCapturedTabSnapshot(readExtensionVersion());
