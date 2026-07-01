function previewText(text) {
  const clean = String(text || "").replace(/\s+/gu, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}...` : clean;
}

export function createStubZoomAdapter(config, logger = console) {
  return {
    name: "stub",
    canAcknowledge: false,
    async start() {
      logger.warn("Zoom adapter is stub; SDK credentials are not configured yet");
      logger.info(`Meeting URL configured: ${config.zoomMeetingUrl}`);
      logger.info(`Bot display name configured: ${config.zoomBotName}`);
    },
    async sendMessage(text) {
      logger.info(`Zoom send skipped in stub mode: ${previewText(text)}`);
      return { sent: false, ack: false };
    },
    async stop() {
      logger.info("Zoom stub adapter stopped");
    }
  };
}
