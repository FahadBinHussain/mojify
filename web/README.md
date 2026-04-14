# Mojify Webapp (Twitch Translator API + UI)

## 1) Install dependencies

```bash
cd webapp
pnpm install
```

## 2) Configure env

Copy `.env.example` to `.env.local` and set:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `MOJIFY_WEB_ORIGINS` (usually `https://mojify.vercel.app`)
- `MOJIFY_EXTENSION_IDS` (comma-separated extension IDs allowed to call API)

## 3) Run locally

```bash
pnpm dev
```

Open `http://localhost:3000`.

## API Endpoints

- `GET /api/twitch/user-id?username=<login>`
- `GET /api/twitch/username?id=<twitch_id>`

Requests are allowed only for:
- web app origin(s) listed in `MOJIFY_WEB_ORIGINS`
- extension origins derived from IDs in `MOJIFY_EXTENSION_IDS` (`chrome-extension://<id>`)

## Extension integration

Extension translator is hardcoded to:

- `https://mojify.vercel.app`
