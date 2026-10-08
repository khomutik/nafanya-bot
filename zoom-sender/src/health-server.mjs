import http from "node:http";
import { timingSafeEqual } from 'node:crypto';

export function startHealthServer(config, health, logger = console, publicationDelivery = null) {
  const server = http.createServer(async (request, response) => {
    if(request.url==='/publication-status' && publicationDelivery && request.method==='GET') {
      const supplied=Buffer.from(String(request.headers['x-nafanya-zoom-secret']||'')),expected=Buffer.from(config.zoomBridgeSecret||'');
      if(!expected.length||supplied.length!==expected.length||!timingSafeEqual(supplied,expected)){response.writeHead(401);response.end('unauthorized');return;}
      try {const body=await publicationDelivery.inspect();response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});response.end(JSON.stringify(body));}
      catch{response.writeHead(503);response.end('publication inspection unavailable');}
      return;
    }
    if (request.url !== "/health") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    const body = health.snapshot();
    response.writeHead(body.ok ? 200 : 503, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  });
  server.listen(config.healthPort, config.healthHost, () => {
    logger.info?.(`Zoom Sender health endpoint listening on ${config.healthHost}:${config.healthPort}`);
  });
  return server;
}
