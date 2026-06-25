import http from "node:http";

export function startHealthServer(config, state, logger = console) {
  const server = http.createServer((request, response) => {
    if (request.url !== "/health") {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }
    const healthy = state.workerConnected === true && state.fatalError === null;
    response.writeHead(healthy ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      ok: healthy,
      adapter: state.adapter,
      workerConnected: state.workerConnected,
      lastPollAt: state.lastPollAt,
      lastErrorAt: state.lastErrorAt,
      lastError: state.lastError,
      pendingOutbox: state.pendingOutbox,
      fatalError: state.fatalError
    }));
  });
  server.listen(config.healthPort, config.healthHost, () => {
    logger.info(`Health endpoint listening on ${config.healthHost}:${config.healthPort}`);
  });
  return server;
}
