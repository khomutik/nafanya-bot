import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { DockerOps } from "./docker-ops.mjs";
import { ZoomControlService } from "./service.mjs";
import { buildControlHtml } from "./html.mjs";

function env(name, fallback = "") { return String(process.env[name] || fallback).trim(); }
const config = {
  host: env("ZOOM_CONTROL_HOST", "127.0.0.1"),
  port: Number(env("ZOOM_CONTROL_PORT", "3098")),
  token: env("ZOOM_CONTROL_TOKEN"),
  cookieName: "nafanya_zoom_control",
  projectDir: env("ZOOM_CONTROL_PROJECT_DIR", "/workspace"),
  envPath: env("ZOOM_CONTROL_ENV_PATH", "/workspace/.env"),
  profileDir: env("ZOOM_CONTROL_PROFILE_DIR", "/sender-profile"),
  diagnosticsDir: env("ZOOM_CONTROL_DIAGNOSTICS_DIR", "/workspace/diagnostics"),
  workerBaseUrl: env("WORKER_BASE_URL").replace(/\/+$/u, ""),
  zoomOnlySecret: env("ZOOM_ONLY_SECRET") || env("ZOOM_BRIDGE_SECRET"),
  panelToken: env("ZOOM_PANEL_TOKEN") || env("ZOOM_V2_PANEL_TOKEN"),
  healthUrl: env("ZOOM_CONTROL_HEALTH_URL", "http://host.docker.internal:3097/health")
};
if (!config.token || !config.workerBaseUrl || !config.zoomOnlySecret || !config.panelToken) throw new Error("Missing control-agent configuration");

const service = new ZoomControlService(new DockerOps(config));
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
const same = (a, b) => { const x = Buffer.from(String(a || "")); const y = Buffer.from(String(b || "")); return x.length === y.length && timingSafeEqual(x, y); };
const cookies = (request) => Object.fromEntries(String(request.headers.cookie || "").split(";").map((item) => item.trim().split("=")).filter(([key]) => key));
const authorized = (request) => same(cookies(request)[config.cookieName], config.token) || same(request.headers["x-nafanya-control-token"], config.token);

async function proxyWorker(request, res, pathname) {
  const body = request.method === "POST" ? await new Promise((resolve) => { const chunks = []; request.on("data", (chunk) => chunks.push(chunk)); request.on("end", () => resolve(Buffer.concat(chunks))); }) : undefined;
  const response = await fetch(`${config.workerBaseUrl}${pathname}`, {
    method: request.method,
    headers: { "x-nafanya-zoom-panel-token": config.panelToken, "content-type": request.headers["content-type"] || "application/json", "user-agent": "Nafanya-Zoom-Control/1.0" },
    body
  });
  const contentType = response.headers.get("content-type") || "application/json";
  res.writeHead(response.status, { "content-type": contentType, "cache-control": "no-store" });
  if (pathname === "/zoom-only/app" && contentType.includes("text/html")) {
    const html = (await response.text())
      .replace('const actionPath = "/zoom-only/app/action";', 'const actionPath = "./zoom-only/app/action";')
      .replace('const statusPath = "/zoom-only/status";', 'const statusPath = "./zoom-only/status";');
    return res.end(html);
  }
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = http.createServer(async (request, res) => {
  try {
    const url = new URL(request.url, "http://control.local");
    if (url.pathname === "/health") return json(res, 200, { ok: true });
    if (url.pathname === "/app" && url.searchParams.has("token")) {
      if (!same(url.searchParams.get("token"), config.token)) return json(res, 401, { ok: false });
      res.writeHead(302, { location: "./app", "set-cookie": `${config.cookieName}=${config.token}; HttpOnly; Secure; SameSite=Strict; Path=/nafanya-zoom-control; Max-Age=43200`, "cache-control": "no-store" });
      return res.end();
    }
    if (!authorized(request)) return json(res, 401, { ok: false, error: "unauthorized" });
    if (request.method === "GET" && url.pathname === "/auth/check") { res.writeHead(204, { "cache-control": "no-store" }); return res.end(); }
    if (request.method === "GET" && url.pathname === "/app") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(buildControlHtml()); }
    if (request.method === "GET" && url.pathname === "/worker-panel") return proxyWorker(request, res, "/zoom-only/app");
    if (url.pathname === "/zoom-only/status" || url.pathname === "/zoom-only/app/action") return proxyWorker(request, res, url.pathname);
    if (request.method === "GET" && url.pathname === "/api/status") return json(res, 200, await service.status());
    if (request.method === "POST" && url.pathname === "/api/start") return json(res, 202, service.requestStart());
    if (request.method === "POST" && url.pathname === "/api/stop") { const result = await service.stop(); return json(res, result.status, result); }
    if (request.method === "POST" && url.pathname === "/api/auth-setup") return json(res, 202, service.requestAuthSetup());
    if (request.method === "POST" && url.pathname === "/api/auth-setup/stop") { const result = await service.stopAuthSetup(); return json(res, result.status, result); }
    return json(res, 404, { ok: false, error: "not_found" });
  } catch (error) {
    return json(res, 500, { ok: false, error: "control_agent_error" });
  }
});
server.listen(config.port, config.host, () => console.log(`Nafanya Zoom control listening on ${config.host}:${config.port}`));
