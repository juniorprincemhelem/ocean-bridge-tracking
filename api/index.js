import { handleRequest } from "../server.mjs";

export default function handler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const routedPath = url.searchParams.get("__path");
  if (routedPath) request.url = routedPath;
  return handleRequest(request, response);
}