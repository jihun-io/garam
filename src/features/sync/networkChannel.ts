import { Channel } from "@tauri-apps/api/core";

import type { Progress, RemoteEvent } from "../../ipc";
import { useCredentials } from "../credentials/credentialStore";

/**
 * Channel for a network command (clone, fetch, pull, push): progress goes to
 * `onProgress`, credential prompts to the app-wide credential dialog.
 */
export function networkChannel(onProgress: (progress: Progress) => void): Channel<RemoteEvent> {
  const channel = new Channel<RemoteEvent>();
  channel.onmessage = (event) => {
    if (event.type === "credential") {
      useCredentials.getState().add({ requestId: event.requestId, prompt: event.prompt });
    } else {
      onProgress({
        phase: event.phase,
        phasePercent: event.phasePercent,
        overallPercent: event.overallPercent,
      });
    }
  };
  return channel;
}
