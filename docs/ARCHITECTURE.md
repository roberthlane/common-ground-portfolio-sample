# Architecture and tradeoffs

```text
Local browser
    | same-origin JSON + signed account cookie
    v
Local-only HTTP harness (demo/server.js)
    | checks authentication, host/origin, payload limits
    +--> discovery.js + visibility.js --> authorized saved items
    +--> plans.js --> validation, references, versions, account-owned notes
    v
FileStateStore: serialized synchronous mutations
    +--> .demo-data/board.json
    +--> .demo-data/board.json.operations.json
```

## Selected existing mechanisms

- `src/discovery.js`: one shared search function ranks title and location terms; places remain searchable across archived collection context. Private guides are filtered before search counts are computed. Shared items' notes are shared, not private drafts.
- `src/visibility.js`: audience resolution for fictional accounts. Private plan reads use `findVisiblePlan`; a shared plan may reference only items visible to both accounts. Audiences are fixed when a plan is created.
- `src/plans.js`: normalized, bounded inputs; deterministic IDs derived from account and request UUID; plan-member references; canonical checksums for core edits and separate per-person note versions. A stale different edit receives HTTP 412. The same already-applied desired state can be recognized during retry recovery.
- `src/state-store.js`: single-process serialization prevents two handlers from overwriting each other's snapshots. Mutators must be synchronous. Writes replace files through a temporary file and rename. Exceptions before persistence preserve the old state.
- `src/transaction-context.js`: AsyncLocalStorage detects outbound adapter calls made inside a mutation. The sample has no outbound adapters; a test verifies the guard rejects attempted outbound work.
- `src/auth.js`: signed, expiring sessions and constant-time comparisons. Password hashing primitives remain and are tested; **the demo login intentionally uses the displayed local demo password**, not an undisclosed real account credential.

## New sample harness

`demo/seed.js`, `demo/store.js`, `demo/server.js`, `demo/integrations.js`, and the small `public/` shell were authored for this sample. The seed is generated from original fictional text. The harness exposes only a static asset allowlist and local APIs. It does not import the original server, runtime secret loader, board seed normalizer, PostgreSQL adapter, provider adapters, migration scripts, or production environment files.

There are no runtime npm dependencies. Browser assets are same-origin. The browser content policy disallows outside resources. Saving accepts only fictional `.invalid` source URLs and does not fetch them. The preview stub always returns an unavailable result. Provider/integration status is explicitly excluded or stubbed; no success response pretends that a task or message was sent.

## Persistence and failure boundaries

Plan writes use an account/route/request-specific receipt and payload hash. A retry with the same request and payload returns the recorded result; reuse of the ID for a different payload is a conflict. The UI keeps its request ID while retrying the same form, and never silently sends later.

The file backend writes state first and the receipt second. A crash between those writes is not atomic. The selected plan mutators identify a deterministic already-applied plan or identical desired update when a receipt is missing. The test deletes a receipt file in an isolated temporary test directory and verifies that replay does not create a second plan. This does not establish filesystem durability through power loss, multi-process coordination, or cloud recovery. There is no scheduled backup job in the sample.

New library saves use the simpler non-idempotent update path. An interrupted response may leave a successful save whose result was not displayed; search before retrying to avoid a duplicate. Do not claim exactly-once behavior for all operations.

The demo format has its own version 1 and fictional marker. Some retained modules contain historical shape-validation/migration helper functions as library code; no route, command, or startup path invokes them. The sample cannot migrate a production database.

## Interface boundaries

Form text remains after an HTTP error, including stale edits. Navigation, reload, account switching, closing the tab, or a browser crash can discard unsaved text. There is no offline queue, persistent private-draft feature, read-receipt system, or messaging endpoint. Browser sessions are shared by tabs in one browser profile; reload other tabs after switching demo accounts.
