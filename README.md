# Excel Product Importer

Bulk product import via Excel upload. The upload endpoint stores the file and
returns immediately; a background worker parses, validates, and imports it,
then emails a report.

## Architecture

```
Client → POST /api/products/import → S3 (raw file) → ImportJob (status: queued) → BullMQ queue
                                                                                        │
                                                                                        ▼
                                                                              Worker process
                                                                    (downloads file, parses rows,
                                                                     validates, creates Products,
                                                                     builds failed-rows.xlsx if
                                                                     needed, updates ImportJob,
                                                                     sends email)
Client → GET /api/products/import/:jobId → polls ImportJob status/counts
```

The API server (`npm run dev`) and the worker (`npm run worker`) are **two
separate processes**. Both must be running for an import to actually
complete — the server only enqueues the job.

## 1. Prerequisites

No Docker, no local installs — everything below runs on free cloud tiers.
You sign up, copy a connection string / credentials into `.env`, and go.

### MongoDB — Atlas free tier
1. Register at https://www.mongodb.com/cloud/atlas/register.
2. Create a free **M0** cluster (any region).
3. **Database Access** → add a database user (pick a username/password, save them).
4. **Network Access** → add an IP entry. For local dev, "Allow access from
   anywhere" (`0.0.0.0/0`) is simplest — tighten later for production.
5. **Connect → Drivers**, copy the connection string:
   `mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
6. Insert a database name before the `?`, e.g.
   `.../excel-product-importer?retryWrites=...`, and put the whole string in
   `.env` as `MONGO_URI`.

### Redis — Upstash free tier
Redis itself doesn't officially support Windows, so a hosted free tier is the
path of least resistance here regardless of Docker.
1. Sign up at https://upstash.com/ and create a Redis database (any region).
2. On the database page, copy the **TLS connection string** — it starts with
   `rediss://`.
3. Put it in `.env` as `REDIS_URL`. Leave `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`
   blank — the app uses `REDIS_URL` whenever it's set (see `src/config/redis.ts`).

### S3 — Backblaze B2 (S3-compatible, no credit card required)
AWS requires a card even for its free tier. Backblaze B2 doesn't, and it
speaks the same S3 API — the app talks to it through the `S3_ENDPOINT`
setting that was originally built for LocalStack, which works just as well
for any S3-compatible provider.

1. Sign up at https://www.backblaze.com/sign-up/cloud-storage — no card needed.
2. In the B2 console: **Buckets → Create a Bucket**. Name it (must be
   globally unique, e.g. `your-name-product-imports`), keep it **Private**.
3. Open the bucket's details — note the **Endpoint**, something like
   `s3.us-west-004.backblazeb2.com`. The `us-west-004` part is your region.
4. **App Keys → Add a New Application Key**. Scope it to just this bucket.
   Copy the `keyID` and `applicationKey` immediately — the secret (`applicationKey`)
   is only shown once.
5. Fill in `.env`:
   ```
   AWS_REGION=<region from the endpoint, e.g. us-west-004>
   AWS_ACCESS_KEY_ID=<keyID>
   AWS_SECRET_ACCESS_KEY=<applicationKey>
   S3_BUCKET_NAME=your-name-product-imports
   S3_ENDPOINT=https://s3.<region>.backblazeb2.com
   S3_FORCE_PATH_STYLE=true
   ```
   (`S3_FORCE_PATH_STYLE=true` avoids DNS/subdomain quirks with B2's virtual-hosted
   URLs — safe to leave on.)

### Email — Ethereal for zero-config local testing

You don't need real SMTP credentials to test the email step. Nodemailer can
generate a free throwaway inbox at [Ethereal](https://ethereal.email/) — go
there, click "Create Ethereal Account", and drop the generated host/user/pass
into your `.env`:
```
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=<generated user>
SMTP_PASS=<generated pass>
```
Sent emails won't hit a real inbox — you view them at the Ethereal web
interface it gives you. Swap in real SMTP credentials (SendGrid, SES, Gmail
app password, etc.) when you're ready for production.

## 2. Setup

```bash
npm install
cp .env.example .env   # fill in the values described above
```

## 3. Run it

Three processes, three terminals:
```bash
npm run dev      # API server on PORT (default 4000)
npm run worker   # BullMQ worker — must be running for jobs to process
```
(Atlas, Upstash, and your S3 bucket from step 1 don't need "starting" — they're
already reachable as soon as the credentials are correct in `.env`.)

## 4. Generate a test file and try the full flow

```bash
npm run sample:generate
```
This writes `sample-products.xlsx` to the project root with 5 rows: two
valid, one missing a price, one duplicate SKU, and one with non-numeric
inventory — so you can see both success and failure paths in one run.

Upload it:
```bash
curl -X POST http://localhost:4000/api/products/import \
  -F "file=@sample-products.xlsx" \
  -F "userEmail=you@example.com"
```
Response:
```json
{ "jobId": "6710...", "status": "queued" }
```

Poll status:
```bash
curl http://localhost:4000/api/products/import/6710...
```
Once the worker picks it up you'll see `status: "processing"`, then
`"completed"` with `totalRows`, `successCount`, `failCount` filled in. Check
the worker's terminal logs, and check Ethereal's web inbox for the report
email (with `failed-rows.xlsx` attached, since this sample file has failures).

## Required column format (for future uploads)

First row = headers, any order:

| sku (required, unique) | name (required) | price (required, > 0) | inventory (required, > 0) | description (required) | category (required) | colors (optional) |
|---|---|---|---|---|---|---|
| SKU-001 | Classic T-Shirt | 19.99 | 100 | A comfortable cotton t-shirt | Apparel | Red, Blue, Black |

`colors` is a comma-separated list in a single cell.
