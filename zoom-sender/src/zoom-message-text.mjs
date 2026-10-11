// Strip emphasis markers that may still be present in an already queued message.
// Zoom messages are sent as ordinary text; no formatting controls are used.
export function plainZoomMessageText(value) {
  return String(value || "").replace(/\*\*([^*]+)\*\*/gu, "$1");
}
