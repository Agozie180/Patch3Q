// Hosted replacement for the Vite dev proxy. The Diana REST API sends no CORS headers, so the browser reaches it
// through this route. Only the two read-only lookups Patch3Q needs are forwarded, for a single qor1 address, to a
// fixed upstream: the visitor never chooses the host, the method or an arbitrary path.
const UPSTREAM = "https://api-testnet.qore.host";
const ALLOWED_PATH = /^\/qorechain\/pqc\/v1\/(account|kem)\/qor1[02-9ac-hj-np-z]{38,90}$/u;

export async function GET(request: Request): Promise<Response> {
  const raw = new URL(request.url).searchParams.get("path") ?? "";
  const path = "/" + raw.replace(/^\/+/u, "");
  if (!ALLOWED_PATH.test(path)) {
    return Response.json({ error: "Only PQC account and ML-KEM key lookups are proxied." }, { status: 400 });
  }
  try {
    const upstream = await fetch(UPSTREAM + path, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "public, max-age=15" },
    });
  } catch {
    return Response.json({ error: "Diana REST endpoint unavailable." }, { status: 502 });
  }
}
