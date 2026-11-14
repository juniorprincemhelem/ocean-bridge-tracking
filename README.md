# Ocean Bridge shipment tracking

## Run locally

Node.js 20 or newer is required. No package installation is needed.

In PowerShell, set an admin password and a persistent random session secret, then start the server:

```powershell
$env:ADMIN_PASSWORD = "replace-with-a-long-unique-password"
$env:SESSION_SECRET = "replace-with-at-least-32-random-characters"
$env:PORT = "8001"
npm start
```

Open `http://localhost:8001`. The admin page is at `http://localhost:8001/admin`.

The server intentionally disables admin sign-in when `ADMIN_PASSWORD` is not set. Do not use a public deployment without HTTPS, a strong password and a persistent random `SESSION_SECRET`.

## Tests

Run the API and admin security tests with:

```powershell
npm test
```

The test suite starts an isolated server with a temporary shipment file and does not modify the local shipment data.

## Shipment records

The server reads and writes `data/shipments.json`, which is ignored by Git. On a fresh checkout it is seeded from `data/shipments.example.json`. Public tracking returns only the record matching the submitted tracking ID. Admin changes are validated and saved to the local JSON file. History entries are ordered newest first, and the first entry is the current location.

The `shipments.js` file is the original sample snapshot; the running site no longer imports it.

## Receipt generator

After signing in at `/admin`, open **Receipt generator**, enter the shipment and charge details, select Paid, Partially paid, or Pending, then choose **Print / Save PDF**. The receipt is generated in the browser and is not stored by the server. Review entered details before printing; quote and receipt amounts are operator-provided.
