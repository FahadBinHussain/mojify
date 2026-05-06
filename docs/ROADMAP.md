# Roadmap

Mojify is moving toward a polished open-source extension with a strong local media library, reliable insertion adapters, and clean provider workflows.

## Near Term

- Stabilize Discord emoji and sticker import flows.
- Improve very large library performance in the popup.
- Add better empty, loading, and error states for provider tabs.
- Keep WhatsApp image insertion useful while animated media support is researched separately.
- Make the workspace scope drawer easier to navigate with keyboard controls.

## Medium Term

- Introduce provider boundaries so Twitch, Discord, and remote media search code is easier to test independently.
- Add a compact diagnostics export for bug reports.
- Improve backup and restore validation.
- Add screenshot-driven docs for installation, imports, and platform insertion.
- Build repeatable release QA steps.

## Later

- Consider a provider plugin model.
- Explore optional cloud sync without making the extension cloud-dependent.
- Improve desktop companion experiments if they prove useful.
- Add richer collection management: tags, aliases, packs, and conflict resolution.

## Non-Goals For Now

- Bundling copyrighted emote packs directly into the repository.
- Requiring a backend for core extension usage.
- Building platform automation that bypasses user account or service rules.
- Adding heavyweight dependencies for small UI features.
