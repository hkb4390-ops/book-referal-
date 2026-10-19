# Telegram Referral Bot + API (Render)

This is the **bot/backend only** repository. The website lives in a separate Vercel repository.

## What it does
- Telegram bot: `hrrrrrrrrry_bot`
- Channel to verify: `https://t.me/hrbseb10thallcorse`
- Stores user/referral data in Firebase Realtime Database `https://hrushs-default-rtdb.firebaseio.com/`
- Counts only direct referrals after the new user is verified as a channel member.
- Stops duplicate credit when a user verifies more than once.
- Unlocks subjects at 1 to 9 verified direct referrals.
- Keeps Google Drive file IDs on the backend and checks access before streaming a PDF.
- Dashboard login tokens expire after 7 days.

## Render environment variables (only 3)
Add these under your Render service → **Environment**:

1. `TELEGRAM_BOT_TOKEN` — token from Telegram's official **@BotFather**. Use `/mybots` → select your bot → API Token. Never share it.
2. `FIREBASE_SERVICE_ACCOUNT_JSON` — the complete JSON text from Firebase Console → gear icon → Project settings → Service accounts → Generate new private key. Open the downloaded JSON file and copy all its text into this value. Do not upload the JSON file to GitHub.
3. `WEBSITE_URL` — your deployed Vercel website URL, for example `https://your-dashboard.vercel.app` (replace with your real URL; no trailing slash needed).

The channel username `@hrbseb10thallcorse` is already set in the code, so no channel ID variable is needed. The bot must be an administrator in the channel. No `BASE_URL` or separate dashboard secret is required in this version.

## Render settings
- New → **Web Service** → select this bot repository.
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Health check path (if asked): `/healthz`
- Node version: 20 or newer.

The service must stay running because it uses Telegram long polling and also serves the dashboard API. Render's free web services can sleep when idle; for reliable always-on bot operation, choose an always-on service plan. Do not deploy two copies of this polling bot at the same time.

## Firebase notes
Use the service account belonging to the Firebase project that owns the RTDB URL above. Do not make the database public. Firebase Admin SDK uses the service account on the server.

## Google Drive PDFs
The IDs are private to the backend code, but the simple Drive download URL only works if Google Drive returns the PDF bytes directly. Each file must be accessible to viewers (or the code must be extended to use an authenticated Drive API). If a file produces an access/quota/confirmation page, the download endpoint will show an error instead of sending a fake PDF.

## Quick test
1. After deploy, open `https://YOUR-RENDER-SERVICE.onrender.com/healthz` — it should show `{"ok":true}`.
2. Open the bot and send `/start`.
3. Join the channel, then tap **Verify Membership**.
4. Open the dashboard button.
5. Test with a second Telegram account to confirm one direct referral unlocks Economics.

## Security
Never commit the bot token, Firebase private key, or other secrets. If a token is leaked, revoke/rotate it immediately.
