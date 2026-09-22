# Content and source provenance

The release manifest is an explicit list of candidate files and their SHA-256 checksums. No old Git history, branches, PR descriptions, Actions artifacts, logs, production screenshots, real seed data, exports, backups, configuration, service identifiers, or ignored environment files are part of that allowlist.

## Content

Alex and Jamie are fictional sample identities, not aliases for the original application's people. Mossport, Lumen Coast, Cloudmere, the named venues, the author Rowan Quill, the book, article vignette, notes, ratings, dates, and plans were invented for this sample. Entire scenarios were replaced; no attempt was made to anonymize a real itinerary by changing names alone. Similarity to an actual person or business would be incidental.

Sample prose and the local interface were generated with AI assistance during preparation. No third-party articles, cover images, photographs, messages, imported catalogs, or personal stories were copied. Browser smoke-test additions are fictional and remain in ignored local storage. The packaged screenshots were captured solely from this local sample. They include its visible fictional-content banner and no browser chrome, account profile, live board, or production data.

## Code

Seven selected JavaScript domain/support modules and the authentication tests came from an existing private personal project. Fixed account names/cookie names were replaced. The entire personal destination-ordering map and destination-specific ranking fallbacks were removed. The PostgreSQL factory branch now throws rather than importing an external adapter. Private provenance records retain exact source hashes; public-facing documentation does not include operational history or production identifiers.

The selected modules are: `auth.js`, `plans.js`, `state-store.js`, `transaction-context.js`, `util.js`, `discovery.js`, and `visibility.js`. New demo code, focused integration tests, docs, release checker, and scanner belong to the sample preparation. No claim of solely unaided authorship is made.

## Assets and dependencies

The only bundled third-party asset is **Source Serif 4 Roman variable WOFF2**, release 4.005R. Its SIL Open Font License and upstream attribution remain alongside the font; see `THIRD-PARTY-NOTICES.md`. No icon pack, images from the private repository, or font modifications are distributed. The original icon pack is excluded, so none of its files or licence is needed for this subset. If icons are added later, carry their notices with them.

Node.js is an external prerequisite, not bundled. There are no runtime or development npm dependencies. The release contains no downloaded provider SDKs, model weights, archives within archives, or data packages.
