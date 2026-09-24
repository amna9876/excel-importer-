# E-commerce Product Processor — Guide

## Context

Clients upload an Excel sheet of products. The system stores the raw file in
**S3-compatible object storage**, then a **background pipeline** (RabbitMQ +
BullMQ) reads the file line-by-line, validates each product, creates the
valid ones in the database, counts successes/failures, builds a **new Excel
of only the failed rows**, and **emails the client** a summary plus the
required format and the error file.

### Key clarification baked into the design: S3 ≠ Database
- **S3 (object storage)** stores the *uploaded file* as one blob. Cheap,
  durable, but you cannot query inside it.
- **PostgreSQL (database)** stores each *product* as a structured, queryable
  row. This is what the rest of the e-commerce platform uses.
- Both are needed: S3 keeps the original upload; the database makes the
  products usable.

### Stack
| Layer | Choice | Why |
|---|---|---|
| Runtime / Framework | NestJS + TypeScript | Built-in support for both BullMQ and RabbitMQ microservices |
| File storage | S3-compatible (`@aws-sdk/client-s3`) | Cheap, durable object storage for the raw upload |
| Message broker | RabbitMQ | Event bus between stages — "file uploaded" event |
| Job queue | BullMQ + Redis | Reliable background jobs, retries, concurrency for row processing |
| Database | PostgreSQL + Prisma | Structured product storage, soft delete, indexing |
| Excel read/write | ExcelJS | Read uploaded sheet, generate error sheet |
| Validation | class-validator (rows) + Zod (env config) | Enforce required product fields, fail fast on bad config |
| Email | Nodemailer | Send summary + required-format note + error file |
| Upload handling | Multer (`FileInterceptor`) | Receive multipart file upload |

---

## Part A — What is this processor? (Concept)

A **processor** here is an asynchronous **batch import pipeline**. The
client's HTTP request does *not* wait for thousands of rows to be validated
and inserted. Instead:

1. The API accepts the file, stores it, and **immediately returns** "we got
   it, we'll email you."
2. The slow work happens **in the background**, driven by **events** and
   **queued jobs**.
3. When done, the client is **notified** (email) with results and an error
   file.

This is the core reason it's **event-driven**: work is triggered by events
("file uploaded", "job finished"), not by one long blocking function call.

---

## Part B — Learning: the concepts behind the design

### B1. What is RabbitMQ?
A **message broker**. Services send **messages** to it; other services
**consume** them. It decouples producers from consumers — the sender doesn't
know or care who processes the message. Think of it as a **post office**:
you drop a letter, the post office routes it, the recipient picks it up
whenever ready. Great for **communication between services** and **event
distribution**.

### B2. What is BullMQ?
A **job queue** built on **Redis** (Node.js). It's specialized for
**background jobs**: retries on failure, delays, scheduling, concurrency,
progress tracking. Think of it as a **to-do list for workers** with
automatic retry and bookkeeping. Great for **doing actual work** reliably
(like processing 10,000 Excel rows).

### B3. RabbitMQ vs BullMQ — why use both?
| | RabbitMQ | BullMQ |
|---|---|---|
| Role | Messaging / event bus (routing, pub-sub) | Job processing (do the work) |
| Strength | Decoupling services, complex routing | Retries, concurrency, scheduling, progress |
| In this app | Announces the "file uploaded" and "file processed" events | Runs the Excel-processing job |

RabbitMQ = *"tell everyone something happened."*
BullMQ = *"actually do the heavy task, reliably."*

In `src/`, this split is concrete: `FileUploadedController` (an
`@EventPattern` handler) does nothing but receive the RabbitMQ event and
enqueue a BullMQ job — it contains zero Excel-processing logic.
`ProcessingProcessor` (a BullMQ `WorkerHost`) does the actual download,
parse, validate, insert — and knows nothing about RabbitMQ except that it
emits one event when it's done.

### B4. What is Event-Driven Architecture (EDA)?
A design where components communicate by **emitting and reacting to
events** (`product.file.uploaded`, `product.file.processed`) instead of
calling each other directly. Producers emit events; consumers react.
Benefits: **loose coupling, scalability, resilience** (one part can be
slow/down without blocking others), and **responsiveness** (the API returns
instantly).

### B5. Why event-driven architecture here
- **The upload returns instantly** — the client isn't stuck waiting for
  10,000 rows.
- **Scalable** — add more workers to process faster; queues absorb spikes.
- **Resilient** — if a worker crashes, BullMQ retries the job; the file is
  safe in S3 either way.
- **Decoupled** — upload, processing, and emailing are independent stages
  that only know about events, not each other's internals.

### B6. Why does every database query have a cost?
Every query consumes real resources: **CPU** (parsing, planning, executing),
**disk I/O** (reading pages), **memory** (buffers, sorting), **locks**
(concurrency control), and **network**. The database must find the data
(scan or index lookup), possibly sort/join, and return it. More rows
scanned = more cost. Indexes reduce read cost but **add write cost** (every
insert/update/delete must also update the index).

This is why `ProcessingProcessor` pre-fetches existing SKUs in **one**
`findMany` query instead of one query per row, and inserts valid rows in
**chunks of 500** via `createMany` instead of one `INSERT` per row.

### B7. Why does DELETE have the highest cost?
A `DELETE` is not just "remove a row." The database must:
1. **Find** the target rows (a read/scan).
2. **Lock** them.
3. **Remove them from every index** the table has (not just the table).
4. **Write to the transaction log (WAL)** for durability/rollback.
5. **Handle foreign keys / cascades / triggers**.
6. Leave **dead tuples** that later need **VACUUM/cleanup** (in Postgres),
   causing bloat.

So one delete triggers work across the table, all indexes, the log, and
future cleanup — often heavier than a read or even an update.

### B8. What is soft delete?
Instead of physically removing the row, you mark it as deleted — a
`deletedAt` timestamp. Queries then filter out rows where `deletedAt IS NOT
NULL`. The data stays in the table but is treated as "gone."

### B9. Why we (almost) always soft delete
- **Recoverable** — undo mistakes; "restore" is just clearing the flag.
- **Audit / history** — you keep a record of what existed (compliance,
  analytics).
- **Referential safety** — other rows referencing it don't break (e.g.
  orders → products).
- **Cheaper at delete time** — it's an `UPDATE` (set a flag) instead of the
  heavy physical delete + index cleanup from B7.
- **Trade-off** — the table grows; you need an index on `deletedAt` and,
  eventually, an archival strategy.

`ProductService` implements exactly this: `softDelete()` sets `deletedAt`,
`restore()` clears it, and every read (`findAll`, `findOne`) filters
`deletedAt: null`.

---

## Part C — End-to-end flow

```
  Client              NestJS API              S3            RabbitMQ            BullMQ (Redis)      Worker             PostgreSQL          Nodemailer
    │  POST /uploads      │                    │                 │                    │                │                    │                    │
    ├─────────────────────►                    │                 │                    │                │                    │                    │
    │                     │  create UploadBatch(PENDING)          │                    │                │                    │                    │
    │                     ├──────────────────────────────────────┼────────────────────┼────────────────┼────────────────────►                    │
    │                     │  put file           │                 │                    │                │                    │                    │
    │                     ├────────────────────►│                 │                    │                │                    │                    │
    │                     │  emit product.file.uploaded            │                    │                │                    │                    │
    │                     ├─────────────────────────────────────►│                    │                │                    │                    │
    │  202 { batchId }    │                    │                 │                    │                │                    │                    │
    │◄─────────────────────┤                    │                 │                    │                │                    │                    │
    │                     │                    │        FileUploadedController        │                │                    │                    │
    │                     │                    │                 ├───────consume──────►│                │                    │                    │
    │                     │                    │                 │        enqueue job  ├───────────────►│                    │                    │
    │                     │                    │                 │                    │                │  download, parse,  │                    │
    │                     │                    │                 │                    │                │  validate, batch-  │                    │
    │                     │                    │                 │                    │                │  insert valid rows ├───────────────────►│
    │                     │                    │◄────get file────┤                    │                │                    │                    │
    │                     │                    │◄──put error.xlsx─┤ (if any failures) │                │                    │                    │
    │                     │                    │                 │  update UploadBatch(COMPLETED)      ├────────────────────►                    │
    │                     │                    │                 │◄────emit product.file.processed─────┤                    │                    │
    │                     │                    │        NotificationController        │                │                    │                    │
    │                     │                    │                 ├───────consume──────►│                │                    │                    │
    │                     │                    │◄────get error.xlsx (if any)───────────┤                │                    │                    │
    │                     │                    │                 │                    │                │                    │  sendMail(summary  │
    │                     │                    │                 │                    │                │                    │  + required format  │
    │                     │                    │                 │                    │                │                    │  + error.xlsx)      ├───►
```

**Events that drive it:** `product.file.uploaded` (RabbitMQ) → triggers
enqueueing the processing job (BullMQ) → on completion emits
`product.file.processed` (RabbitMQ) → triggers the email stage.

---

## Part D — Required Excel format

Each row = one product. Header row required. Columns (all required):

| Column | Type | Rule |
|---|---|---|
| `sku` | string | required, unique across all products |
| `name` | string | required, non-empty |
| `description` | string | required |
| `price` | number | required, > 0 |
| `category` | string | required |
| `color` | string | required |
| `stock` | integer | required, ≥ 0 |

A row is **successful** if all fields pass validation; **unsuccessful** if
any are missing or malformed. The error Excel (`failed-rows.xlsx`, emailed
back to the client) contains the original row plus an `errors` column
explaining each failure, and the email body restates this exact required
format.

---

## Part E — File map

```
src/
├─ main.ts                          # HTTP + RabbitMQ microservice bootstrap
├─ app.module.ts
├─ config/env.validation.ts         # Zod schema — refuses to boot on bad .env
├─ prisma/
│  ├─ prisma.service.ts
│  └─ prisma.module.ts
├─ upload/
│  ├─ upload.controller.ts          # POST /uploads, GET /uploads/:id
│  ├─ s3.service.ts                 # S3 put/get
│  └─ upload.module.ts
├─ messaging/
│  ├─ messaging.constants.ts        # event names, queue name
│  └─ messaging.module.ts           # RabbitMQ producer (ClientProxy)
├─ processing/
│  ├─ file-uploaded.controller.ts   # @EventPattern -> enqueue BullMQ job
│  ├─ processing.processor.ts       # BullMQ worker (core logic)
│  ├─ excel.service.ts              # ExcelJS read + error-sheet write + row validation
│  ├─ dto/product-row.dto.ts        # class-validator rules
│  └─ processing.module.ts
├─ notification/
│  ├─ notification.controller.ts    # @EventPattern -> send email
│  ├─ mailer.service.ts
│  └─ notification.module.ts
└─ product/
   ├─ product.controller.ts         # GET/DELETE /products, POST /:id/restore
   ├─ product.service.ts            # soft delete + deletedAt-filtered queries
   └─ product.module.ts

prisma/schema.prisma                # Product, UploadBatch models
scripts/generate-sample-file.ts     # writes a test .xlsx with valid + invalid rows
```

---

## Part F — Verification (how to test end-to-end)

See [`README.md`](../README.md) for the exact commands. In short:
1. `npm run start:dev` — confirms it connects to Postgres, Redis, RabbitMQ, S3.
2. `npm run sample:generate`, then `POST /uploads` with that file — expect an
   immediate `202`-style response with a `batchId`.
3. Watch the logs: RabbitMQ event fired → BullMQ job picked up → rows processed.
4. `GET /uploads/:batchId` — watch `PENDING` → `PROCESSING` → `COMPLETED`.
5. Check the email inbox (Ethereal): summary correct, required-format shown,
   `failed-rows.xlsx` attached with an `errors` column.
6. Soft delete: `DELETE /products/:id` → row still in the database with
   `deletedAt` set; `GET /products` no longer lists it; `POST /:id/restore`
   brings it back.

---

## Notes / trade-offs

- **Both RabbitMQ and BullMQ** is intentional, to make the messaging-vs-jobs
  distinction concrete (see Part B3). A production-minimal version could use
  BullMQ alone and skip the RabbitMQ hop.
- **Chunked batch inserts** (`createMany`, 500 rows at a time) instead of
  streaming a full 10,000-row file into memory at once in a single query —
  keeps both memory and per-query cost bounded (see B6).
- **The error file is stored in S3, not passed through the RabbitMQ event
  payload.** Message buses are for small, fast messages — the
  `product.file.processed` event carries only the S3 key, and
  `NotificationController` re-downloads the file to attach it. This trades
  one extra S3 round trip for keeping every message on the bus small.
- **Manual RabbitMQ acknowledgement** (`noAck: false` + `channel.ack(...)`)
  on both event handlers, so a crash mid-processing leaves the message
  unacked for redelivery instead of silently dropping it.
