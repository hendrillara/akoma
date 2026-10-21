// The served API: HTTP request in, response out, over a built dataset.
import type { Dataset, Provision } from "../schema/dataset.ts";
import { createSearch } from "./search.ts";

export function createHandler(dataset: Dataset): (request: Request) => Promise<Response> {
  const provisions = new Map<string, Provision>();
  for (const provision of dataset.provisions) provisions.set(`${provision.norm}/${provision.id}`, provision);
  const search = createSearch(dataset, provisions);

  return async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method !== "GET") return notFound();

    if (pathname === "/v1/search") return search(new URL(request.url));

    if (pathname === "/v1/norms") {
      return Response.json({ norms: dataset.norms });
    }

    const provision = /^\/v1\/provisions\/([^/]+)\/([^/]+)$/.exec(pathname);
    if (provision) {
      const found = provisions.get(`${provision[1]}/${provision[2]}`);
      return found ? Response.json(found) : notFound();
    }

    return notFound();
  };
}

function notFound(): Response {
  return Response.json({ error: "not_found" }, { status: 404 });
}
