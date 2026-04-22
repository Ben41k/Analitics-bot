/**
 * Прокси на generativelanguage.googleapis.com (прозрачная пересылка).
 * Раньше путь text-embedding-004 переписывался на embedding-001 — тот в v1beta даёт 404.
 */
const UPSTREAM = "https://generativelanguage.googleapis.com";

const EMBED_ACTIONS = [":embedContent", ":batchEmbedContents"];

function isEmbedPath(pathname) {
  return EMBED_ACTIONS.some((a) => pathname.includes(a));
}

function corsHeadersFrom(responseHeaders) {
  const corsHeaders = new Headers(responseHeaders);
  corsHeaders.set("Access-Control-Allow-Origin", "*");
  corsHeaders.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE, PUT");
  corsHeaders.set("Access-Control-Allow-Headers", "*");
  return corsHeaders;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      const h = new Headers();
      h.set("Access-Control-Allow-Origin", "*");
      h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE, PUT");
      h.set("Access-Control-Allow-Headers", "*");
      return new Response(null, { headers: h });
    }

    const originalUrl = new URL(request.url);
    const pathname = originalUrl.pathname;
    const targetUrl = UPSTREAM + pathname + originalUrl.search;

    const newHeaders = new Headers(request.headers);
    newHeaders.set("Host", "generativelanguage.googleapis.com");

    let body = request.body;

    if (isEmbedPath(pathname) && request.method === "POST") {
      const ct = request.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const text = await request.text();
        newHeaders.set("content-type", "application/json");
        body = text;
      }
      newHeaders.delete("content-length");
    }

    const newRequest = new Request(targetUrl, {
      method: request.method,
      headers: newHeaders,
      body,
      redirect: "follow",
    });

    try {
      const response = await fetch(newRequest);

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: corsHeadersFrom(response.headers),
      });
    } catch (e) {
      return new Response("Cloudflare Worker Error: " + e.message, { status: 500 });
    }
  },
};
