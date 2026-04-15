const DEFAULT_WEB_ORIGINS = ["https://mojify.vercel.app"];

function parseCsv(value) {
  return (value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isAllowedClient(request) {
  const origin = request.headers.get("origin") || "";
  if (!origin) return false;

  const webOrigins = parseCsv(process.env.MOJIFY_WEB_ORIGINS);
  const allowedWebOrigins = webOrigins.length > 0 ? webOrigins : DEFAULT_WEB_ORIGINS;
  return allowedWebOrigins.includes(origin);
}
