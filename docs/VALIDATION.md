# Validation

## Reproduce the checks

With Node.js 22 or newer:

```sh
npm install
npm run check
npm test
```

The check command validates JavaScript syntax. The tests use temporary directories and ephemeral loopback ports, so they do not change a running demo’s records. CI runs on Node.js 22 and 24.

Coverage includes search across archived context; account-filtered results, counts, and plans; shared-item reference rules; concurrent edits and independent note versions; idempotent create replay and missing-receipt recovery; read-only requests; persistence; corrupt-state rejection; and the HTTP boundaries of the actual demo server.

Regression tests cover loopback aliases and rejected foreign origins, malformed JSON shapes, account selection without lockout, the actual cookie policy, missing assets, no-op version semantics, and Save/Saved navigation.

Latest local validation (September 22, 2026): **22 tests passed, none failed or skipped**, on Node.js 25.8.1. Installing before running the checks also passed.

## Browser walkthrough

Use the README walkthrough to exercise discovery, saving, plan editing, an independent note, two-tab conflicts, and account switching. Also check narrow layouts, keyboard focus after navigation, and an interrupted request. Screenshots in `screenshots/` show the normal light theme, including the stale-edit message and a narrow plan list.

The walkthrough passed in Chrome using a temporary profile, including focus on the new view, interrupted-save retry, and refresh/back navigation. The 390-pixel viewport checks found no horizontal overflow.

Automated tests and browser checks are engineering evidence for this local sample. They do not establish a hosted deployment, a complete accessibility audit, physical-phone acceptance, independent security certification, or measured user impact.
