# Security Policy

Mojify is a browser extension that interacts with active web pages, stores provider credentials locally, and imports media from third-party services. Please report security issues responsibly.

## Supported Versions

Mojify is currently in active pre-store development. Security fixes target the latest `main` branch unless release branches are introduced later.

## What To Report

Please report:

- Extension permission abuse or unnecessary broad access.
- Provider key leakage.
- Stored data exposure from `chrome.storage.local` or IndexedDB misuse.
- Cross-site scripting in popup, options, or injected page code.
- Unsafe handling of remote media, filenames, blobs, or downloads.
- Bugs that let one site access another site's Mojify data.
- Discord import behavior that exposes more data than needed.

## What Not To Report

Please do not report expected platform behavior as a vulnerability, such as:

- A site blocking synthetic drag/drop or paste events.
- A provider refusing an API request without a key.
- A browser asking for extension permissions listed in `manifest.json`.

## Reporting Process

Preferred path:

1. Use GitHub private vulnerability reporting if it is enabled for the repository.
2. If private reporting is unavailable, open a public issue with minimal detail and ask for a private contact path.
3. Do not include working exploit payloads, private tokens, or copied user data in public issues.

Please include:

- Browser and version.
- Extension version or commit SHA.
- Affected page or provider.
- Reproduction steps.
- Impact and suggested fix, if known.

## Project Security Principles

- Keep user data local by default.
- Store provider credentials only in browser extension storage.
- Avoid remote code execution and dynamic third-party script loading.
- Keep host permissions understandable and tied to real features.
- Sanitize imported names, filenames, and rendered metadata.
- Prefer least-powerful insertion methods before privileged debugger routes.
