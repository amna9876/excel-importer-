# Bulk Product Importer

A backend service that lets an e-commerce client bulk-import products from an
Excel sheet instead of adding them one by one. The upload responds instantly;
the actual file processing runs asynchronously through an event-driven
pipeline, and the client gets an emailed report of what succeeded and what
didn't.

**Live demo:** https://excel-importer-production-dace.up.railway.app

## Features

- **Drag-and-drop web UI** — upload a file, watch a live progress timeline, browse/search/delete/restore products.
- **Non-blocking upload** — the API responds immediately; a background worker does the actual processing.
- **Per-row validation** — required fields, SKU uniqueness, numeric checks; bad rows are skipped and logged, not the whole file.
- **Tolerant column matching** — headers are case-insensitive, and common synonyms are accepted (`Colors` for `color`, `Inventory` for `stock`).
- **Emailed report** — a summary of counts, plus two attached spreadsheets: the products that were imported, and the rows that failed with a reason for each.
- **Soft delete** — deleting a product hides it, not erases it; it can be restored, and its SKU becomes reusable once deleted.

## Tech stack

| Layer | Choice |
|---|---|
| Backend framework | NestJS (TypeScript) |
| Database | PostgreSQL (via Prisma ORM) |
| Job queue | BullMQ (Redis-backed) |
| Message bus | RabbitMQ |
| File storage | S3-compatible object storage |
| Spreadsheet I/O | ExcelJS |
| Validation | class-validator (row data), Zod (environment config) |
| Email | Nodemailer, with an HTTPS relay fallback for hosts that block SMTP |
| Frontend | Static HTML/CSS/JS, no build step |
| Deployment | Railway (CI/CD from `main`) |

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
                        (downloads file, parses rows, validates each,
                         batch-inserts valid rows, builds the
                         imported/failed spreadsheets, updates UploadBatch)
                                                │
                                    emit "product.file.processed" (RabbitMQ)
                                                ▼
                                  NotificationController (@EventPattern)
                                                │
                                        MailerService → email

Client → GET  /uploads/:id                → poll batch status/counts
Client → GET  /products                   → list active products
Client → DELETE /products/:id             → soft delete
Client → POST /products/:id/restore       → restore
```

The upload endpoint only stores the file and emits an event — it never
parses the sheet itself, which is what keeps the HTTP response fast
regardless of file size. `public/index.html` is a static page served
alongside the API at `/` that exercises these same endpoints.

See [`docs/PROCESSOR_GUIDE.md`](docs/PROCESSOR_GUIDE.md) for a deeper
write-up of the design decisions (why RabbitMQ *and* BullMQ, why soft delete,
why S3 and a database are both needed).

## Running it locally

### 1. Prerequisites

Four free-tier services, each just a sign-up:

| Service | Used for | Free tier |
|---|---|---|
| [Neon](https://neon.tech) | PostgreSQL | No card required |
| [Upstash](https://upstash.com) | Redis (BullMQ) | No card required |
| [CloudAMQP](https://www.cloudamqp.com) | RabbitMQ | No card required |
| [Backblaze B2](https://www.backblaze.com/sign-up/cloud-storage) | S3-compatible storage | No card required |

Copy each service's connection string into `.env` (see `.env.example`).

### 2. Email

For local testing, an [Ethereal](https://ethereal.email) test account works
with zero setup (fake inbox, viewable on their site). For a real inbox,
use Gmail SMTP with an [app password](https://myaccount.google.com/apppasswords).

Some hosts block outbound SMTP entirely (Railway's free plan does). For
those, set `EMAIL_RELAY_URL`/`EMAIL_RELAY_TOKEN` instead of `SMTP_*` — this
points at a small Google Apps Script web app that sends the mail over HTTPS
instead. Details in `.env.example` and `MailerService.sendViaRelay`.

### 3. Setup and run

```bash
npm install
cp .env.example .env      # fill in the values above
npx prisma migrate dev --name init
npm run start:dev
```

On boot you should see both `HTTP listening on port 4000` and `RabbitMQ
microservice connected`.

### 4. Try it

Open http://localhost:4000 for the web UI, or generate a sample file and use
the API directly:

```bash
npm run sample:generate
curl -X POST http://localhost:4000/uploads \
  -F "file=@sample-products.xlsx" \
  -F "userEmail=you@example.com"
```

Poll `GET /uploads/:batchId` to watch it go `PENDING` → `PROCESSING` →
`COMPLETED`, with `totalRows`/`successCount`/`failCount` filled in.

## Required spreadsheet format

First row = headers, any order:

| sku (unique) | name | description | price (> 0) | category | color | stock (≥ 0) |
|---|---|---|---|---|---|---|
| SKU-001 | Classic T-Shirt | A comfortable cotton t-shirt | 19.99 | Apparel | Blue | 100 |

`color` also accepts `colors`; `stock` also accepts `inventory`. A file
missing a required column is rejected outright; a file with the right
columns but bad row data still processes, and the bad rows are listed with
their reasons in the emailed report.

## Deployment

Deployed on [Railway](https://railway.com) from this repo's `main` branch —
every push redeploys automatically.

- **Build:** `npm install && npx prisma generate && npm run build`
- **Start:** `npm run start:prod`
- **Environment:** same as `.env.example`, minus `PORT` (host-injected)

## Project structure

```
src/
├─ upload/          # POST /uploads — stores the file, emits the event
├─ messaging/        # RabbitMQ connection and event constants
├─ processing/        # BullMQ worker — parsing, validation, spreadsheet generation
├─ notification/      # Emails the report (SMTP or HTTPS relay)
├─ product/          # Product CRUD + soft delete
├─ prisma/           # Database client
└─ config/           # Environment variable validation
public/index.html     # Web UI
prisma/schema.prisma  # Data model
docs/PROCESSOR_GUIDE.md # Design write-up
```
