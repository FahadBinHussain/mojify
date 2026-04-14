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

## 3) Run locally

```bash
pnpm dev
```

Open `http://localhost:3000`.

## API Endpoints

- `GET /api/twitch/user-id?username=<login>`
- `GET /api/twitch/username?id=<twitch_id>`

## Extension integration

In extension API settings, set `Translator API Base URL` to:

- Local: `http://localhost:3000`
- Deploy: `https://<your-app>.vercel.app`
