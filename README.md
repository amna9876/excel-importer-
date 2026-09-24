# E-commerce Product Processor

Event-driven bulk product import: a client uploads an Excel sheet, the file
is stashed in S3-compatible storage, an event announces the upload over
RabbitMQ, a BullMQ worker does the actual parsing/validating/inserting, and
Nodemailer emails a summary (with a failed-rows spreadsheet attached, if any
rows failed).

See [`docs/PROCESSOR_GUIDE.md`](docs/PROCESSOR_GUIDE.md) for the full
concept write-up — what RabbitMQ vs. BullMQ are for, why event-driven
architecture, why every DB query has a cost, why DELETE is the expensive one,
and why soft delete. This README is just the practical run-it guide.

## Architecture

```
Client → POST /uploads → S3 (raw file) → UploadBatch (status: PENDING)
                                                │
                                    emit "product.file.uploaded" (RabbitMQ)
                                                ▼
                                  FileUploadedController (@EventPattern)
                                                │
                                      enqueue BullMQ job
                                                ▼
                                     ProcessingProcessor (worker)
                        (downloads file, parses rows, validates each via
                         class-validator, batch-inserts valid rows, builds
                         failed-rows.xlsx if needed, updates UploadBatch)
                                                │
                                    emit "product.file.processed" (RabbitMQ)
                                                ▼
                                  NotificationController (@EventPattern)
                                                │
                                        MailerService → email

Client → GET /uploads/:id → polls UploadBatch status/counts
Client → GET/DELETE /products, POST /products/:id/restore → soft-delete CRUD
```

Everything above runs in **one Nest process** (`npm run start:dev`) — it's a
hybrid app that serves HTTP and listens on RabbitMQ at the same time. That's
simpler to run than the two-process (API + worker) split you might expect;
BullMQ's async job processing still keeps heavy Excel work off the HTTP
request path.

## 1. Prerequisites

No Docker, no local installs, no credit card — four free services, each a
sign-up-and-copy-a-connection-string away.

### PostgreSQL — Neon free tier
1. Sign up at https://neon.tech (no card).
2. Create a project — it provisions a free Postgres database immediately.
3. Copy the connection string from the dashboard (starts with `postgresql://`,
   includes `?sslmode=require`).
4. Put it in `.env` as `DATABASE_URL`.

### Redis — Upstash free tier
1. Sign up at https://upstash.com/, create a Redis database (any region).
2. Copy the **TLS connection string** (`rediss://...`) from the database page.
3. Put it in `.env` as `REDIS_URL`.

### RabbitMQ — CloudAMQP free tier
1. Sign up at https://www.cloudamqp.com/ (no card), create an instance on the
   free **"Little Lemur"** plan.
2. On the instance's details page, copy the **AMQP URL** (starts with `amqps://`).
3. Put it in `.env` as `RABBITMQ_URL`.

### S3-compatible storage — Backblaze B2
AWS requires a card even for its free tier; B2 doesn't, and speaks the same
S3 API via `@aws-sdk/client-s3` pointed at a custom endpoint.
1. Sign up at https://www.backblaze.com/sign-up/cloud-storage (no card).
2. **Buckets → Create a Bucket** — name it (globally unique), keep it **Private**.
3. Open the bucket's details, note the **Endpoint**, e.g.
   `s3.us-west-004.backblazeb2.com` (`us-west-004` is your region).
4. **App Keys → Add a New Application Key**, scoped to this bucket. Copy the
   `keyID` and `applicationKey` immediately — the secret is shown once.
5. Fill in `.env`:
   ```
   AWS_REGION=<region from the endpoint, e.g. us-west-004>
   AWS_ACCESS_KEY_ID=<keyID>
   AWS_SECRET_ACCESS_KEY=<applicationKey>
   S3_BUCKET_NAME=<your bucket name>
   S3_ENDPOINT=https://s3.<region>.backblazeb2.com
   S3_FORCE_PATH_STYLE=true
   ```

### Email — Ethereal for zero-config local testing
No real SMTP account needed. Go to https://ethereal.email/, click "Create
Ethereal Account", and put the generated credentials in `.env`:
```
SMTP_HOST=smtp.ethereal.email
SMTP_PORT=587
SMTP_USER=<generated user>
SMTP_PASS=<generated pass>
```
Sent mail shows up in Ethereal's web inbox, not a real mailbox — swap in real
SMTP credentials when you're ready for production.

## 2. Setup

```bash
npm install
cp .env.example .env      # fill in the five services above
npx prisma migrate dev --name init   # creates the Product/UploadBatch tables on Neon
```

## 3. Run it

```bash
npm run start:dev
```
One process, one terminal. On boot you should see both "HTTP listening on
port 4000" and "RabbitMQ microservice connected" — if the second line is
missing or errors, double-check `RABBITMQ_URL`.

## 4. Generate a test file and try the full flow

```bash
npm run sample:generate
```
Writes `sample-products.xlsx` with 5 rows: two valid, one missing a price,
one duplicate SKU, and one with non-numeric stock — so you see both success
and failure paths in one run.

Upload it:
```bash
curl -X POST http://localhost:4000/uploads \
  -F "file=@sample-products.xlsx" \
  -F "userEmail=you@example.com"
```
Response:
```json
{ "batchId": "a1b2c3...", "status": "PENDING" }
```

Poll status:
```bash
curl http://localhost:4000/uploads/a1b2c3...
```
You'll see `PENDING` → `PROCESSING` → `COMPLETED` with `totalRows`,
`successCount`, `failCount` filled in. Check the app's terminal logs for the
RabbitMQ event → BullMQ job → email chain, and check Ethereal's web inbox for
the report (with `failed-rows.xlsx` attached).

Try the product endpoints:
```bash
curl http://localhost:4000/products                    # list (excludes soft-deleted)
curl -X DELETE http://localhost:4000/products/<id>      # soft delete
curl -X POST http://localhost:4000/products/<id>/restore
```

## Required column format (for future uploads)

First row = headers, any order:

| sku (required, unique) | name (required) | description (required) | price (required, > 0) | category (required) | color (required) | stock (required, ≥ 0) |
|---|---|---|---|---|---|---|
| SKU-001 | Classic T-Shirt | A comfortable cotton t-shirt | 19.99 | Apparel | Blue | 100 |

A failed row's reasons show up in the `errors` column of the emailed
`failed-rows.xlsx`.
