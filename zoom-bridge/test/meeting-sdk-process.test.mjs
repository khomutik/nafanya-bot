import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingSdkProcessAdapter } from "../src/adapters/meeting-sdk-process.mjs";

test("meeting sdk process adapter sends chat messages through child process", async () => {
  const adapter = createMeetingSdkProcessAdapter({
    zoomSdkBotCommand: process.execPath,
    zoomSdkBotArgs: "test/support/fake-sdk-bot.mjs",
    zoomMeetingUrl: "https://example.zoom.us/j/123",
    zoomBotName: "Nafanya",
    zoomSdkReadyTimeoutMs: 2000,
    zoomSdkSendTimeoutMs: 2000
  });

  await adapter.start();
  const result = await adapter.sendMessage("hello zoom");
  assert.deepEqual(result, { sent: true, ack: true });
  await adapter.stop();
});

test("meeting sdk process adapter requires command", () => {
  assert.throws(
    () => createMeetingSdkProcessAdapter({ zoomSdkBotCommand: "" }),
    /ZOOM_SDK_BOT_COMMAND/u
  );
});
