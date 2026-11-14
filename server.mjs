import { createServer } from "node:http";
import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.resolve(process.env.SHIPMENTS_FILE || path.join(DATA_DIR, "shipments.json"));
const SAMPLE_FILE = path.join(DATA_DIR, "shipments.example.json");
const PORT = Number(process.env.PORT || 8001);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
const SESSION_MAX_AGE = 8 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
const statuses = new Set(["In Transit", "Delivered", "Exception", "Pending"]);
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

await mkdir(path.dirname(DATA_FILE), { recursive: true });
try {
  await readFile(DATA_FILE);
} catch {
  try {
    await writeFile(DATA_FILE, await readFile(SAMPLE_FILE));
  } catch {
    await writeFile(DATA_FILE, "{}\n", "utf8");
  }
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie || "";
  const pair = cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : "";
}

function sign(value) {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function getAdminSession(request) {
  const [id, signature] = cookieValue(request, "ob_session").split(".");
  if (!id || !signature) return false;
  const expected = sign(id);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
  const expiresAt = sessions.get(id);
  if (!expiresAt || expiresAt <= Date.now()) {
    sessions.delete(id);
    return false;
  }
  sessions.set(id, Date.now() + SESSION_MAX_AGE);
  return true;
}

function sessionCookie(request, value, maxAge) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `ob_session=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Request body is too large.");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function readShipments() {
  return JSON.parse(await readFile(DATA_FILE, "utf8"));
}

async function writeShipments(shipments) {
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(shipments, null, 2)}\n`, "utf8");
  await rename(temporary, DATA_FILE);
}

function validateShipment(id, shipment) {
  if (!/^[A-Z0-9]+$/.test(id)) return "Tracking ID must use uppercase letters and numbers only.";
  if (!shipment || typeof shipment !== "object") return "Shipment data is required.";
  if (!statuses.has(shipment.status)) return "Choose a valid shipment status.";
  for (const field of ["origin", "destination"]) {
    if (typeof shipment[field] !== "string" || !shipment[field].trim() || shipment[field].length > 120) {
      return `${field} must be a non-empty string under 120 characters.`;
    }
  }
  if (shipment.shippingMethod !== undefined && (typeof shipment.shippingMethod !== "string" || shipment.shippingMethod.length > 80)) {
    return "Shipping method must be under 80 characters.";
  }
  if (shipment.estimatedDelivery !== undefined && shipment.estimatedDelivery !== "") {
    if (typeof shipment.estimatedDelivery !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(shipment.estimatedDelivery)) {
      return "Estimated delivery must be a valid date.";
    }
    const etaDate = new Date(`${shipment.estimatedDelivery}T00:00:00.000Z`);
    if (Number.isNaN(etaDate.getTime()) || etaDate.toISOString().slice(0, 10) !== shipment.estimatedDelivery) {
      return "Estimated delivery must be a valid date.";
    }
  }
  if (!Array.isArray(shipment.history) || shipment.history.length < 1 || shipment.history.length > 100) {
    return "A shipment must have between 1 and 100 history entries.";
  }
  for (const entry of shipment.history) {
    if (!entry || typeof entry.location !== "string" || !entry.location.trim() || entry.location.length > 160) return "Every event needs a location under 160 characters.";
    if (typeof entry.note !== "string" || !entry.note.trim() || entry.note.length > 240) return "Every event needs a note under 240 characters.";
    if (typeof entry.time !== "string" || !entry.time.trim() || entry.time.length > 80) return "Every event needs a time under 80 characters.";
    if (!Number.isFinite(entry.lat) || entry.lat < -90 || entry.lat > 90) return "Event latitude must be between -90 and 90.";
    if (!Number.isFinite(entry.lng) || entry.lng < -180 || entry.lng > 180) return "Event longitude must be between -180 and 180.";
  }
  return "";
}

function passwordMatches(candidate) {
  const candidateHash = createHash("sha256").update(candidate).digest();
  const configuredHash = createHash("sha256").update(ADMIN_PASSWORD).digest();
  return timingSafeEqual(candidateHash, configuredHash);
}

function loginRateLimited(request) {
  const key = request.socket.remoteAddress || "unknown";
  const current = loginAttempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    loginAttempts.set(key, { count: 0, resetAt: Date.now() + 15 * 60 * 1000 });
    return false;
  }
  return current.count >= 8;
}

function recordFailedLogin(request) {
  const key = request.socket.remoteAddress || "unknown";
  const current = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
  current.count += 1;
  loginAttempts.set(key, current);
}

async function serveStatic(request, response, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname === "/admin" ? "/admin.html" : pathname;
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestedPath);
  } catch {
    response.writeHead(400).end("Bad path");
    return;
  }
  const filePath = path.resolve(ROOT, `.${decodedPath}`);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  const extension = path.extname(filePath).toLowerCase();
  if (!mimeTypes[extension]) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const file = await readFile(filePath);
    response.writeHead(200, { "Content-Type": mimeTypes[extension], "Cache-Control": "no-store" });
    response.end(file);
  } catch {
    response.writeHead(404).end("Not found");
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = url.pathname;

  try {
    if (request.method === "GET" && pathname === "/api/admin/status") {
      sendJson(response, 200, { configured: Boolean(ADMIN_PASSWORD) });
      return;
    }

    if (request.method === "GET" && pathname.startsWith("/api/shipments/")) {
      const id = decodeURIComponent(pathname.slice("/api/shipments/".length)).toUpperCase();
      const shipments = await readShipments();
      if (!shipments[id]) {
        sendJson(response, 404, { error: "Shipment not found." });
        return;
      }
      sendJson(response, 200, shipments[id]);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/login") {
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: "Request origin rejected." });
        return;
      }
      if (!ADMIN_PASSWORD) {
        sendJson(response, 503, { error: "Admin access is not configured. Set ADMIN_PASSWORD before starting the server." });
        return;
      }
      if (loginRateLimited(request)) {
        sendJson(response, 429, { error: "Too many login attempts. Try again in 15 minutes." });
        return;
      }
      const body = await readBody(request);
      if (typeof body.password !== "string" || !passwordMatches(body.password)) {
        recordFailedLogin(request);
        sendJson(response, 401, { error: "Incorrect password." });
        return;
      }
      loginAttempts.delete(request.socket.remoteAddress || "unknown");
      const id = randomBytes(32).toString("base64url");
      sessions.set(id, Date.now() + SESSION_MAX_AGE);
      sendJson(response, 200, { authenticated: true }, { "Set-Cookie": sessionCookie(request, `${id}.${sign(id)}`, SESSION_MAX_AGE / 1000) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/logout") {
      if (!sameOrigin(request)) {
        sendJson(response, 403, { error: "Request origin rejected." });
        return;
      }
      const id = cookieValue(request, "ob_session").split(".")[0];
      sessions.delete(id);
      sendJson(response, 200, { authenticated: false }, { "Set-Cookie": sessionCookie(request, "", 0) });
      return;
    }

    if (pathname.startsWith("/api/admin/shipments")) {
      if (!getAdminSession(request)) {
        sendJson(response, 401, { error: "Admin login required." });
        return;
      }
      if (request.method === "GET" && pathname === "/api/admin/shipments") {
        sendJson(response, 200, await readShipments());
        return;
      }
      if ((request.method === "PUT" || request.method === "DELETE") && !sameOrigin(request)) {
        sendJson(response, 403, { error: "Request origin rejected." });
        return;
      }
      const match = pathname.match(/^\/api\/admin\/shipments\/([^/]+)$/);
      if (!match) {
        sendJson(response, 404, { error: "Admin endpoint not found." });
        return;
      }
      const id = decodeURIComponent(match[1]).toUpperCase();
      const shipments = await readShipments();
      if (request.method === "DELETE") {
        if (!shipments[id]) {
          sendJson(response, 404, { error: "Shipment not found." });
          return;
        }
        delete shipments[id];
        await writeShipments(shipments);
        sendJson(response, 200, { deleted: id });
        return;
      }
      if (request.method === "PUT") {
        const shipment = await readBody(request);
        const validationError = validateShipment(id, shipment);
        if (validationError) {
          sendJson(response, 400, { error: validationError });
          return;
        }
        const created = !shipments[id];
        shipments[id] = {
          status: shipment.status,
          origin: shipment.origin.trim(),
          destination: shipment.destination.trim(),
          shippingMethod: (shipment.shippingMethod || "").trim(),
          estimatedDelivery: shipment.estimatedDelivery || "",
          history: shipment.history.map((entry) => ({
            location: entry.location.trim(),
            lat: Number(entry.lat),
            lng: Number(entry.lng),
            time: entry.time.trim(),
            note: entry.note.trim()
          }))
        };
        await writeShipments(shipments);
        sendJson(response, created ? 201 : 200, { id, shipment: shipments[id] });
        return;
      }
      sendJson(response, 405, { error: "Method not allowed." });
      return;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(response, 404, { error: "API endpoint not found." });
      return;
    }

    await serveStatic(request, response, pathname);
  } catch (error) {
    const message = error instanceof SyntaxError ? "Invalid JSON body." : error.message;
    sendJson(response, 400, { error: message || "Request failed." });
  }
});

server.listen(PORT, () => {
  console.log(`Ocean Bridge server running at http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.warn("Admin login is disabled until ADMIN_PASSWORD is set.");
});
