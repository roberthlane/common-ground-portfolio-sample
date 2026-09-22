# Architecture and API behavior

```text
Browser controllers + view templates (public/)
    | same-origin JSON and signed demo session
    v
HTTP routes (demo/server.js)
    +-- discovery + visibility: search only authorized items
    +-- plans: references, validation, versions, personal notes
    v
FileStateStore: serialized synchronous mutations
    +-- .demo-data/board.json
    +-- .demo-data/board.json.operations.json
```

## Discovery and access

Search ranks title and structured location matches ahead of body text. Collection membership is context, so archived outings do not hide their saved places. Visibility filtering happens before results and counts are calculated.

Plans reference saved item IDs. A shared plan accepts only items visible to both accounts; a personal plan accepts its owner’s visible items. The audience is fixed at creation, and inaccessible resources return 404. Shared plan notes are readable by both members, but each member can edit only their own note.

## Sessions and HTTP boundaries

`POST /api/login` with `{"user":"Alex"}` or `{"user":"Jamie"}` selects a demo role and issues a signed one-hour session. There is intentionally no password or login lockout: every evaluator can choose either account. The cookie is HttpOnly and SameSite=Strict. Logout clears the browser cookie; a copied token remains valid until expiry or server restart.

The server binds to IPv4 loopback. Only `localhost:<port>` and `127.0.0.1:<port>` Host headers are accepted. Writes additionally require an Origin matching that exact host, JSON content type, and `X-Demo-Request: 1`. A 32 KiB request limit and object validation apply to JSON bodies. Static assets use an explicit allowlist; the browser content policy permits only local assets. Missing assets return an error without crashing the process.

The preview endpoint is an explicit failure stub. Source URLs must use `.invalid` domains; no links are fetched.

## Edits and retries

`POST /api/plans` accepts a UUID `requestId` and a `plan`. `PATCH /api/plans/:id` additionally requires a `planVersion` from the plan detail response. A note update uses `/api/plans/:id/note` with `requestId`, `noteVersion`, and `note`.

Core versions exclude notes; each person’s note has a separate version. A different edit using a stale version receives **412**, and missing or malformed versions receive **428** or **400**. Forms retain text after request errors; retry is explicit.

An authorized, identical desired-state PATCH with a syntactically valid stale version returns **200 without changing the board**. This is deliberate recovery when a prior write succeeded but its response or receipt was lost. It does not permit a stale request to change data. Permissions, shape validation, and item-reference checks still run. Notes use the same no-op rule.

Receipts are scoped by account, route, and request ID. Repeating a request and payload returns its recorded result; reusing that ID with a different payload receives **409**. The file store retains the latest 200 receipts. Deterministic plan IDs additionally prevent duplicate creates after a receipt has been removed.

## Persistence tradeoffs

Mutations run synchronously in a single-process queue. An outbound-work guard prevents adapters from making network calls inside mutations. Writes use temporary files with mode 0600 and atomic rename.

State and receipts are separate files, written in that order. They are **not one database transaction**. If a process fails between writes, plan mutators recognize deterministic creates and identical desired state during retry. Tests exercise this missing-receipt window. Atomic rename does not guarantee power-loss durability or coordinate multiple processes.

Ordinary item saves do not use receipts. If a save’s response is interrupted, search before retrying to avoid a duplicate. No exactly-once guarantee is claimed.

The sample format has its own version and marker and rejects unrelated documents. It has no production migration or cloud recovery path. Forms retain unsent text only while open: navigation, reload, account switching, or closing the browser can discard it. There is no offline sending queue.
