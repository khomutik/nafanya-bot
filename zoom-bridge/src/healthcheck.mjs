const host = process.env.HEALTH_HOST || "127.0.0.1";
const port = process.env.HEALTH_PORT || "3087";
const url = `http://${host}:${port}/health`;

try {
  const response = await fetch(url);
  if (!response.ok) {
    process.exit(1);
  }
  const data = await response.json();
  process.exit(data.ok ? 0 : 1);
} catch {
  process.exit(1);
}
