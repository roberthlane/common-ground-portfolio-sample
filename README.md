# Common Ground

Saved links and good ideas are easy to lose in a message thread. Common Ground brings them onto a shared shelf, where two people can find something again and turn it into a plan.

This runnable portfolio sample demonstrates location search, shared and personal plans, and conflict-safe editing. All people and content are fictional.

![Shared shelf in the demo’s light theme](docs/screenshots/01-shared-shelf.jpg)

## Try it

Use **Node.js 22 or newer**. There are no npm dependencies, database, credentials, or external services to configure.

```sh
npm start
```

Open **http://localhost:4177** (or http://127.0.0.1:4177), then choose **Continue as Alex** or **Continue as Jamie**. These buttons select demo roles; they do not protect confidential accounts. Run this sample locally with made-up content only.

## Five-minute walkthrough

1. As Alex, search **Mossport** and choose **Places → Restaurants**. The Lantern Table remains discoverable even though its original outing is archived.
2. Open it and start a shared plan. Add Reed Loop to link dinner with a walk without duplicating either saved item.
3. Open the plan in two tabs. Save an edit in one, then a different edit in the other. The stale edit is rejected and the form keeps your unsent text.
4. Switch to Jamie. Shared plans remain visible; Alex’s personal preparation does not. Use separate browser profiles to compare both accounts side by side.
5. Save an idea, refresh, and find it again. An unavailable link preview does not prevent saving.

## Engineering decisions

- **Filter permissions before searching.** Private items stay out of results and counts. A shared plan can reference only items visible to both people.
- **Separate shared edits from personal notes.** Plan fields have one version; each person’s note has its own. Independent notes do not conflict unnecessarily.
- **Make retries deliberate and safe.** Plan requests use stable request IDs and payload receipts. A repeated create does not create a second plan.
- **Keep the sample easy to run.** A single-process file store demonstrates serialized writes and atomic file replacement, with its crash-recovery limits documented explicitly.

See [architecture and API behavior](docs/ARCHITECTURE.md), [validation](docs/VALIDATION.md), and [provenance](docs/PROVENANCE.md).

## Development

```sh
npm install    # Optional: no dependencies to download
npm run check  # JavaScript syntax checks
npm test       # Domain and local HTTP tests
```

CI runs those checks on Node.js 22 and 24.

Data lives in ignored `.demo-data/`. Restarting preserves records and invalidates sessions. Run one server per directory. To reset, stop the server, move `.demo-data/` elsewhere, and restart. Use Ctrl+C to stop.

## Contribution

I defined the product requirements and directed development using AI coding tools, which assisted with implementation, testing, and documentation. This portfolio sample uses fictional data to demonstrate shared planning, access controls, version-conflict handling, and persistence.

## License

Original code and demo content are licensed under [MIT](LICENSE). Source Serif retains its separate SIL Open Font License; see [third-party notices](THIRD-PARTY-NOTICES.md).
