# Validation record and limitations

Prepared September 21, 2026 with Node.js 25.8.1 on macOS. All data in this validation is fictional. No external provider, production database, deployment workflow, or migration was invoked.

## Automated evidence

`npm test`: **22 tests passed, 0 failed, 0 skipped**. Nine adapted authentication tests and thirteen focused sample/domain integration tests cover:

- Archived-context restaurant search and filter exclusions.
- Fictional format validation; rejection of foreign documents.
- Authentication, malformed credentials, same-origin JSON writes, loopback Host checks, and private static-file denial.
- Account-filtered search results/counts, items, and private plans.
- Rejection of a private item in a shared plan and immutable plan audiences.
- Plan-create retry receipts, conflicting request-ID payloads, and deterministic create recovery after a missing receipt.
- Concurrent core edits, stale edit rejection, and independently versioned per-account notes.
- Read-only API behavior; unavailable preview with successful save.
- Failed synchronous mutations and outbound guard; persistence after reopening storage; corrupt state fails closed.

`npm run check` checks every released file against the explicit manifest and runs syntax checks. The candidate scan additionally checks allowed paths, personal seed overlap, identifying strings, credential patterns, external references, file types, JPEG metadata, and exact vendor font checksum. It is a bounded release scan, not a proof that arbitrary future content is safe.

The first test attempt was blocked from binding loopback ports by the execution sandbox. After permitting local loopback tests, initial harness mistakes (fictional seed timestamps, projected audience labels, note payload shape, and HTTP Host test transport) were fixed and all tests passed. No private application code was changed to address them.

## Local browser walkthrough

Verified in Chrome against `127.0.0.1` only:

- Alex login, shared shelf, Mossport → Places → Restaurants, and archived outing label.
- Saved-item notes and ratings, creation of a shared plan referencing two existing items, and checklist save.
- Two-tab conflict: a stale different plan edit is rejected while the typed summary remains in the form. Screenshot 03 captures that result.
- Per-person plan note save.
- Preview-unavailable stub followed by successful save of invented content; the item persists after refresh.
- Jamie login and plan list: shared plans and Jamie's personal plan appear, Alex's personal plan does not.
- Narrow layout at a verified 390-pixel browser viewport without horizontal overflow. This is viewport emulation, not a physical phone test.

Screenshots contain only the sample page, not browser chrome. Their dark rendering reflects the available browser's rendering settings; this is not a claim that a separate application dark-theme implementation was validated. Every screenshot was visually reviewed for sample-only content. JPEG EXIF/comment metadata is checked in the release scan.

## Not established

No full original-application regression suite, PostgreSQL integration/recovery rehearsal, independent security audit, deployed demo, physical-device test, complete accessibility audit, real-user impact measurement, or provider integration test is claimed. No live messaging, read positions, shared agreement/experience features, or book-catalog adapter exists in this subset. Its source architecture should not be presented as a reproduction of all production capabilities.

The demo stores cleartext fictional records locally. Both account credentials are intentionally known, sessions are per-process, and it is not suitable for confidential data or public hosting. One process per data directory is required. Atomic rename does not establish crash-proof disk durability. State and operation receipts are two files, not one ACID transaction. The browser retains unsent text only while the form remains open.

## Private repository preparation

On September 22, 2026, the approved MIT licence and contribution wording were applied to a clean extraction of the reviewed candidate. Source behavior and screenshots were unchanged. The resulting allowlist and checksums were regenerated, and the focused tests and release scan were repeated before the initial private push.
