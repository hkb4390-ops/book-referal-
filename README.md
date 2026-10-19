# HRRY Telegram Referral Backend

Independent Render service: Express API + Telegram long-polling bot + Firebase Admin SDK.

## Commands
- Build command: `npm install`
- Start command: `npm start`
- Checks: `npm test` and `npm run check`

## Required Render environment variables
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_CHANNEL_URL`, `TELEGRAM_CHANNEL_ID`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `FRONTEND_URL`, `SESSION_SECRET`. `PORT` is supplied by Render. `BOT_MODE=polling` is the default.

`FIREBASE_SERVICE_ACCOUNT_JSON` is the complete JSON text downloaded from Firebase Console → Project settings → Service accounts → Generate new private key. Paste into Render's environment variable field; never commit it. This backend uses the fixed database URL `https://hrry-store-default-rtdb.firebaseio.com/`.

## Important setup
1. Create a Firebase project/database matching the supplied database URL, then create a service account with appropriate access. Keep the private key secret.
2. Create the bot with `@BotFather`, get its token, and ensure its username is exactly `hrrrrrrrrry_bot`.
3. Add the bot as an administrator in `@hrbseb10thallcorse` so `getChatMember` can reliably check members.
4. Verify channel ID `4498096954`: forward a channel post to a trusted ID-check bot such as `@userinfobot` if available, or use Telegram Bot API `getChat` from a private environment with your token. The `getChat` response's `id` is authoritative. Do not publish the token. A mismatch causes membership checks to fail safely; do not silently change it.
5. Create a separate GitHub repository and upload this folder's contents.
6. On Render, create a **Web Service**, connect this repository, runtime Node, build `npm install`, start `npm start`, add the variables above, deploy.
7. Test `https://YOUR-RENDER-HOST/healthz`. It reports process health, not proof that Telegram/Firebase are fully healthy. Inspect Render logs for startup errors.
8. Test `/start`, `/help`, `/status`, `/referral`, `/profile`, `/pdfs` in Telegram.
9. On Vercel set `VITE_API_BASE_URL` to the real Render HTTPS origin and `FRONTEND_URL` here to the deployed website origin. Redeploy after changing Vercel variables.

## Bot mode
This project uses polling by default. Run exactly one active backend instance; multiple instances can conflict. Do not configure a webhook at the same time. Free hosting can sleep or restart and does not guarantee continuous uptime.

## Data model
- `users/{telegramId}`: profile, referral code, verifiedDirectReferrals, createdAt, membership.
- `referrals/{referredTelegramId}`: one immutable attribution record, status, referrerId, timestamps.
- `referralCodes/{code}`: owner Telegram ID.
- `linkTokens/{sha256(token)}`: short-lived binding request; raw token is never stored.
- `processedUpdates/{updateId}`: idempotency marker.
- `channelMemberships/{telegramId}`: last verified membership result.
- `pdfResources/{pdfId}`: resource metadata; initialized from the fixed list in code.
- `auditLogs/{pushId}`: minimal operational events.

All privileged writes use Firebase Admin SDK. Client database rules should deny all direct client access; use server APIs.

## Security / limitations
- Browser binding uses a high-entropy one-time token and only creates an HttpOnly cookie after Telegram confirms binding. The token is a bearer capability while pending; keep it private.
- Cookie sessions are signed opaque tokens, HttpOnly/Secure/SameSite=Lax, with server-side session records and expiry. Use HTTPS in production.
- CORS is restricted to `FRONTEND_URL`; same-origin deployment URL must match exactly.
- Telegram Bot API cannot guarantee perfect referral fraud prevention: users can create alternate accounts, and a bot cannot prove that separate Telegram identities are separate humans.
- The supplied Drive IDs are configured on the backend. Public Drive files are not truly protected: if their sharing permissions allow public access, links can be copied outside this site. This project does not proxy Google Drive bytes; it sends an authorized Drive link only after unlock.
- Account deletion is intentionally not a public unauthenticated operation; contact support/owner for manual review until a deletion workflow and retention policy are configured.
- Admin review endpoints are not exposed until an explicit `ADMIN_TELEGRAM_IDS` allowlist is configured.

## Verification status for this package
The pure domain tests were executed successfully in the build environment. Live Firebase, Telegram, Render and Vercel integration tests require your real secrets and deployed service, so they have not been claimed as passed. The web build could not be run here because package installation did not complete in the available environment. Before production, run the full integration checklist with a test Telegram account and test referral accounts.
