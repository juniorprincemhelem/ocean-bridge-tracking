# Ocean Bridge shipment tracking

## Run locally

Node.js 20 or newer is required. Install the dependencies once with `npm install`.

In PowerShell, set an admin password and a persistent random session secret, then start the server:

```powershell
$env:ADMIN_PASSWORD = "replace-with-a-long-unique-password"
$env:SESSION_SECRET = "replace-with-at-least-32-random-characters"
$env:PORT = "8001"
npm start
```

Open `http://localhost:8001`. The admin page is at `http://localhost:8001/admin`.

The server intentionally disables admin sign-in when `ADMIN_PASSWORD` is not set. Do not use a public deployment without HTTPS, a strong password and a persistent random `SESSION_SECRET`.

## Deploy to Vercel

Create an Upstash Redis database and connect this repository to Vercel with the project root as the root directory. Add these environment variables for Production and Preview:

- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, or their Vercel KV aliases `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
- `ADMIN_PASSWORD`: a strong, unique admin password.
- `SESSION_SECRET`: a persistent random value of at least 32 characters.

Deploy after setting the variables. `api/index.js` handles API and fallback routes while Vercel serves matching static files normally. The function seeds `data/shipments.example.json` into Redis when the shipment hash is empty. Shipment changes made in `/admin` are stored in Redis. Quote and support forms continue to create Gmail drafts in the browser; they do not call server endpoints. Locally, the server uses `data/shipments.json` when no Redis variables are set.

## Tests

Run the API and admin security tests with:

```powershell
npm test
```

The test suite starts an isolated server with a temporary shipment file and does not modify the local shipment data.

## Shipment records

The local server reads and writes `data/shipments.json`, which is ignored by Git. On a fresh checkout it is seeded from `data/shipments.example.json`. Public tracking returns only the record matching the submitted tracking ID. Admin changes are validated and saved to the configured store. History entries are ordered newest first, and the first entry is the current location.

The `shipments.js` file is the original sample snapshot; the running site no longer imports it.

## Receipt generator

After signing in at `/admin`, open **Receipt generator**, enter the shipment and charge details, select Paid, Partially paid, or Pending, then choose **Print / Save PDF**. The receipt is generated in the browser and is not stored by the server. Review entered details before printing; quote and receipt amounts are operator-provided.
