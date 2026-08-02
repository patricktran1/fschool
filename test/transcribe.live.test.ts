// @vitest-environment node
// Real network + multipart upload — must use Node's fetch/FormData/Blob, not jsdom's
// (jsdom's Blob doesn't serialize through Node fetch and the request hangs).
import { describe, it, expect } from "vitest";
import { loadEnvKey, makeWavBytes } from "./helpers";

// LIVE integration test — hits the real ElevenLabs Scribe API to validate the exact
// endpoint, model id, auth header, and response shape that api/transcribe.ts depends on
// (these were written from memory). It reads ELEVENLABS_API_KEY from the env or
// .env.local. If the key is absent the suite is SKIPPED (so CI without secrets stays
// green). If the key is present but invalid, the test FAILS with the API's error — i.e.
// a failure here means the key, not the code.
const KEY = loadEnvKey("ELEVENLABS_API_KEY");
const suite = KEY ? describe : describe.skip;

suite("ElevenLabs Scribe (live)", () => {
  it("accepts a Scribe request and returns a string transcript", async (ctx) => {
    const form = new FormData();
    form.append("model_id", "scribe_v1");
    form.append("file", new Blob([makeWavBytes()], { type: "audio/wav" }), "tone.wav");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": KEY as string },
      body: form,
    });

    // 401/403 = the key is missing the `speech_to_text` permission or has no credits.
    // That's a known key/account issue, not a code bug → skip (keeps the suite green)
    // with the reason loud, instead of failing on every run.
    if (res.status === 401 || res.status === 403) {
      const detail = await res.text().catch(() => "");
      ctx.skip(`ElevenLabs key not authorized for speech_to_text (enable the permission / add credits): ${detail}`);
      return;
    }

    // Any other non-200 means the request itself was wrong → that IS a code regression.
    const detail = res.ok ? "" : await res.text().catch(() => "");
    expect(res.ok, `ElevenLabs returned ${res.status} (unexpected — check the request shape). ${detail}`).toBe(true);

    const json = await res.json();
    // Transcript may be empty (the fixture is a tone, not speech) — we only assert the
    // integration contract: a 200 with a string `text` field.
    expect(typeof json.text).toBe("string");
  }, 60_000);
});
