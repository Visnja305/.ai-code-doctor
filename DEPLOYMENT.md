# AI Code Doctor — Run & Deploy

## Prerequisites

- Node.js + Firebase CLI (`npm install -g firebase-tools`)
- A Google Cloud project with the Gemini API enabled and a billing-linked API key
- A Firebase project (Spark free plan works)

## 1. Configure the app

Edit `public/app-config.js` and fill in:

- `FIREBASE` — your Firebase web app config (Firebase console → Project settings → Your apps → Web)
- `GEMINI_API_KEY` — your Gemini API key
- `GEMINI_MODEL` — default `gemini-3.5-flash` (change if you want another model)
- `DAILY_REQUEST_LIMIT` — per-user daily request cap (default 20)

## 2. Enable Firebase services

- **Authentication** → Sign-in method → enable **Email/Password**
- **Firestore Database** → create a database in production mode

## 3. Deploy Firestore rules

```
firebase deploy --only firestore:rules
```

These rules let each user read/write only their own data under `users/{uid}/`.

## 4. Deploy hosting

```
firebase login
firebase use --add        # select your Firebase project
firebase deploy --only hosting
```

## Run locally

```
firebase serve --only hosting
```

or serve `public/` with any static server:

```
npx serve public
```

## What happens at runtime

1. User submits a message (snippet, GitHub URL, or question).
2. The app calls Gemini with `skills/orchestrator.md` as the system instruction to decide routing.
3. If the orchestrator asks a clarifying question, it is shown and the flow stops.
4. Otherwise the app looks up the routed skill in `config/skills.json`, fetches its `.md` file, and makes a second Gemini call.
5. For Repo Doctor, the GitHub repo is fetched/filtered/flattened first and the bundle is sent as the input.

## Security notes (required)

- The Gemini API key is client-side. In Google Cloud Console → APIs & Services → Credentials, restrict it by **HTTP referrer** to your Hosting domain, set a **low daily quota**, and create a **budget alert** on the billing account.
- Firestore rules lock data to the owner UID. The rate limit is enforced client-side and can be bypassed by a determined user — acceptable for the Spark plan, not a hard security boundary.
- Only public repos are supported; there is no GitHub token.
