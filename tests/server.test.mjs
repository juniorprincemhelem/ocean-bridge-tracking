import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST_PASSWORD = "test-password-only";
const TEST_SESSION_SECRET = "unit-test-session-secret-not-for-use";
let temporaryDirectory;
let baseUrl;
let serverProcess;
let sessionCookie;
let seedShipment;
let dataFile;

async function getFreePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${url}/api/admin/status`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Test server did not start in time.");
}

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "ocean-bridge-test-"));
  const example = JSON.parse(await readFile(path.join(ROOT, "data", "shipments.example.json"), "utf8"));
  seedShipment = example.OB1000123456;
  dataFile = path.join(temporaryDirectory, "shipments.json");
  await writeFile(dataFile, JSON.stringify(example), "utf8");
  const port = await getFreePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_PASSWORD: TEST_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
      VERCEL: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      SHIPMENTS_FILE: dataFile
    },
    stdio: "ignore"
  });
  await waitForServer(baseUrl);
});

after(async () => {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill();
    await new Promise((resolve) => serverProcess.once("exit", resolve));
  }
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

test("public tracking returns one matching record and 404 for an unknown ID", async () => {
  const response = await fetch(`${baseUrl}/api/shipments/OB1000123456`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).destination, "Los Angeles, USA");

  const missing = await fetch(`${baseUrl}/api/shipments/OB4040000000`);
  assert.equal(missing.status, 404);
});

test("admin shipment list requires an authenticated session", async () => {
  const response = await fetch(`${baseUrl}/api/admin/shipments`);
  assert.equal(response.status, 401);
});

test("login rejects cross-origin requests and invalid passwords", async () => {
  const crossOrigin = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD })
  });
  assert.equal(crossOrigin.status, 403);

  const invalidPassword = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ password: "wrong-test-password" })
  });
  assert.equal(invalidPassword.status, 401);
});

test("login rate limiting handles a null socket and uses the forwarded client IP", async () => {
  const environmentKeys = [
    "ADMIN_PASSWORD",
    "SESSION_SECRET",
    "SHIPMENTS_FILE",
    "VERCEL",
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL",
    "KV_REST_API_TOKEN"
  ];
  const previousEnvironment = Object.fromEntries(environmentKeys.map((key) => [key, process.env[key]]));

  Object.assign(process.env, {
    ADMIN_PASSWORD: TEST_PASSWORD,
    SESSION_SECRET: TEST_SESSION_SECRET,
    SHIPMENTS_FILE: dataFile,
    VERCEL: "",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    KV_REST_API_URL: "",
    KV_REST_API_TOKEN: ""
  });

  try {
    const { handleRequest } = await import("../server.mjs");
    const requestLogin = async () => {
      const request = Readable.from([Buffer.from(JSON.stringify({ password: "wrong-test-password" }))]);
      Object.assign(request, {
        method: "POST",
        url: "/api/admin/login",
        headers: {
          origin: "https://example.test",
          host: "example.test",
          "x-forwarded-for": "203.0.113.42, 10.0.0.1"
        },
        socket: null
      });
      let status;
      const response = {
        writeHead(code) {
          status = code;
          return this;
        },
        end() {}
      };
      await handleRequest(request, response);
      return status;
    };

    for (let attempt = 0; attempt < 8; attempt += 1) {
      assert.equal(await requestLogin(), 401);
    }
    assert.equal(await requestLogin(), 429);
  } finally {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("admin can log in, update ETA and method, and create/delete a shipment", async () => {
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD })
  });
  assert.equal(login.status, 200);
  sessionCookie = login.headers.get("set-cookie").split(";")[0];

  const updatedShipment = {
    ...seedShipment,
    shippingMethod: "Air Freight",
    estimatedDelivery: "2026-11-16"
  };
  const update = await fetch(`${baseUrl}/api/admin/shipments/OB1000123456`, {
    method: "PUT",
    headers: { Origin: baseUrl, Cookie: sessionCookie, "Content-Type": "application/json" },
    body: JSON.stringify(updatedShipment)
  });
  assert.equal(update.status, 200);
  const publicRecord = await fetch(`${baseUrl}/api/shipments/OB1000123456`);
  const saved = await publicRecord.json();
  assert.equal(saved.shippingMethod, "Air Freight");
  assert.equal(saved.estimatedDelivery, "2026-11-16");

  const invalidDate = await fetch(`${baseUrl}/api/admin/shipments/OB1000123456`, {
    method: "PUT",
    headers: { Origin: baseUrl, Cookie: sessionCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ ...updatedShipment, estimatedDelivery: "2026-02-31" })
  });
  assert.equal(invalidDate.status, 400);

  const newId = "OB3000000001";
  const create = await fetch(`${baseUrl}/api/admin/shipments/${newId}`, {
    method: "PUT",
    headers: { Origin: baseUrl, Cookie: sessionCookie, "Content-Type": "application/json" },
    body: JSON.stringify(seedShipment)
  });
  assert.equal(create.status, 201);

  const remove = await fetch(`${baseUrl}/api/admin/shipments/${newId}`, {
    method: "DELETE",
    headers: { Origin: baseUrl, Cookie: sessionCookie }
  });
  assert.equal(remove.status, 200);

  const logout = await fetch(`${baseUrl}/api/admin/logout`, {
    method: "POST",
    headers: { Origin: baseUrl, Cookie: sessionCookie }
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);

  const afterLogout = await fetch(`${baseUrl}/api/admin/shipments`, {
    headers: { Cookie: logout.headers.get("set-cookie").split(";")[0] }
  });
  assert.equal(afterLogout.status, 401);
});

test("signed admin cookies work in a fresh server process", async () => {
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: { Origin: baseUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ password: TEST_PASSWORD })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];

  const port = await getFreePort();
  const secondUrl = `http://127.0.0.1:${port}`;
  const secondServer = spawn(process.execPath, [path.join(ROOT, "server.mjs")], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      ADMIN_PASSWORD: TEST_PASSWORD,
      SESSION_SECRET: TEST_SESSION_SECRET,
      VERCEL: "",
      UPSTASH_REDIS_REST_URL: "",
      UPSTASH_REDIS_REST_TOKEN: "",
      KV_REST_API_URL: "",
      KV_REST_API_TOKEN: "",
      SHIPMENTS_FILE: dataFile
    },
    stdio: "ignore"
  });

  try {
    await waitForServer(secondUrl);
    const response = await fetch(`${secondUrl}/api/admin/shipments`, {
      headers: { Cookie: cookie }
    });
    assert.equal(response.status, 200);
  } finally {
    if (secondServer.exitCode === null) {
      secondServer.kill();
      await new Promise((resolve) => secondServer.once("exit", resolve));
    }
  }
});
