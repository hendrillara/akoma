// The served API: HTTP request in, response out, over a built dataset.
import type { Dataset } from "../schema/dataset.ts";

export function createHandler(dataset: Dataset): (request: Request) => Promise<Response> {
  return async (request) => {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/v1/norms") {
      return Response.json({ norms: dataset.norms });
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  };
}
