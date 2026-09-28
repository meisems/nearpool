/** Never return (or immutably cache) the SPA shell for a missing build asset. */
export async function handleAssetRequest(request: Request, assets: Fetcher): Promise<Response | null> {
  if (!new URL(request.url).pathname.startsWith("/assets/")) return null;
  const response = await assets.fetch(request);
  if (response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
    return new Response(request.method === "HEAD" ? null : "Asset not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (!response.ok) {
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers });
  }
  return response;
}
