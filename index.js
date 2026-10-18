import express from "express";
import pg from "pg";
import {
randomBytes,
timingSafeEqual
} from "node:crypto";

const app = express();
const { Pool } = pg;

const PORT = Number(process.env.PORT || 3000);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME;
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const DATABASE_URL = process.env.DATABASE_URL;
const FRONTEND_URL = process.env.FRONTEND_URL;

if (
!TOKEN ||
!BOT_USERNAME ||
!CHANNEL_ID ||
!CHANNEL_URL ||
!WEBHOOK_SECRET ||
!DATABASE_URL ||
!FRONTEND_URL
) {
throw new Error("Missing required environment variables.");
}

if (!/^-?\d+$/.test(CHANNEL_ID)) {
throw new Error("Invalid TELEGRAM_CHANNEL_ID.");
}

if (!/^[A-Za-z0-9_-]{1,256}$/.test(WEBHOOK_SECRET)) {
throw new Error("Invalid TELEGRAM_WEBHOOK_SECRET.");
}

const pool = new Pool({
connectionString: DATABASE_URL,
ssl: process.env.DATABASE_SSL === "true"
? { rejectUnauthorized: true }
: undefined,
max: 10,
connectionTimeoutMillis: 5000
});

app.disable("x-powered-by");

app.use((req, res, next) => {
res.setHeader("X-Content-Type-Options", "nosniff");
res.setHeader("X-Frame-Options", "DENY");
res.setHeader("Referrer-Policy", "no-referrer");
next();
});

app.use(express.json({ limit: "256kb" }));

async function telegram(method, body = {}) {
const response = await fetch(
"https://api.telegram.org/bot${TOKEN}/${method}",
{
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify(body),
signal: AbortSignal.timeout(10000)
}
);

const data = await response.json();

if (!response.ok || !data.ok) {
throw new Error("Telegram API error: ${method}");
}

return data.result;
}

async function sendMessage(chatId, text, extra = {}) {
return telegram("sendMessage", {
chat_id: chatId,
text,
...extra
});
}

async function initializeDatabase() {
await pool.query(`
CREATE TABLE IF NOT EXISTS users (
id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
telegram_user_id BIGINT NOT NULL UNIQUE,
telegram_username TEXT,
first_name TEXT,
account_status TEXT NOT NULL DEFAULT 'active'
CHECK (account_status IN ('active','disabled')),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referral_codes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_user_id BIGINT NOT NULL UNIQUE
    REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  referrer_user_id BIGINT NOT NULL REFERENCES users(id),
  referred_user_id BIGINT NOT NULL UNIQUE REFERENCES users(id),
  referral_code_used TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','verified','rejected')),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  CHECK (referrer_user_id <> referred_user_id)
);

CREATE INDEX IF NOT EXISTS referrals_count_idx
  ON referrals(referrer_user_id, status);

CREATE TABLE IF NOT EXISTS channel_memberships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id)
    ON DELETE CASCADE,
  channel_id BIGINT NOT NULL,
  membership_status TEXT NOT NULL DEFAULT 'unknown',
  last_verified_at TIMESTAMPTZ,
  verification_error TEXT,
  UNIQUE(user_id, channel_id)
);

CREATE TABLE IF NOT EXISTS telegram_updates (
  update_id BIGINT PRIMARY KEY,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pdf_resources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sequence_number INTEGER NOT NULL UNIQUE
    CHECK (sequence_number BETWEEN 1 AND 9),
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  resource_location TEXT NOT NULL,
  minimum_verified_referrals INTEGER NOT NULL UNIQUE
    CHECK (minimum_verified_referrals BETWEEN 1 AND 9),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

`);

const pdfs = [
["Economics", "Economics", "https://drive.google.com/file/d/1hbKSxeX6SWK0lpSWHo21vNK8l9F5IXJ9/view?usp=drivesdk"],
["Physics", "Physics", "https://drive.google.com/file/d/1PN9LaQCaWWCfV7xdNCb8PgC671Fs7hdQ/view?usp=drivesdk"],
["Civics", "Civics", "https://drive.google.com/file/d/1_t7x5irxluEdx7ugxo2lbdLctFss0dWD/view?usp=drivesdk"],
["History", "History", "https://drive.google.com/file/d/1AujJJqkmWFl9cFeB4_MsQ9ffU2m40vsB/view?usp=drivesdk"],
["Maths", "Maths", "https://drive.google.com/file/d/1bI5Siizo_vqftacfvZ_HR7vY3bDcgzMa/view?usp=drivesdk"],
["Chemistry", "Chemistry", "https://drive.google.com/file/d/1O890P8zKHkRk0jmaPp4cxGHvGn-lI8OY/view?usp=drivesdk"],
["Biology", "Biology", "https://drive.google.com/file/d/1oP8A7XC6-aPkZCwJLhAF_c2uNqXmdXzp/view?usp=drivesdk"],
["Sanskrit", "Sanskrit", "https://drive.google.com/file/d/1X0CZR2AZ33EuEHAhFtzi9wYpsBts6FjB/view?usp=drivesdk"],
["English", "English", "https://drive.google.com/file/d/1GSTyzCiPRwcmfGiaFR-NJRBe2El5UVEj/view?usp=drivesdk"]
];

for (let i = 0; i < pdfs.length; i++) {
const [title, subject, url] = pdfs[i];

await pool.query(
  `INSERT INTO pdf_resources
    (sequence_number, title, subject,
     resource_location, minimum_verified_referrals)
   VALUES ($1,$2,$3,$4,$5)
   ON CONFLICT (sequence_number) DO NOTHING`,
  [i + 1, title, subject, url, i + 1]
);

}

console.log("Database initialized.");
}

async function getOrCreateUser(from) {
const client = await pool.connect();

try {
await client.query("BEGIN");

const result = await client.query(
  `INSERT INTO users
    (telegram_user_id, telegram_username, first_name)
   VALUES ($1,$2,$3)
   ON CONFLICT (telegram_user_id)
   DO UPDATE SET
     telegram_username = EXCLUDED.telegram_username,
     first_name = EXCLUDED.first_name
   RETURNING id, account_status`,
  [
    String(from.id),
    from.username ?? null,
    from.first_name ?? null
  ]
);

const user = result.rows[0];

const existing = await client.query(
  "SELECT id FROM referral_codes WHERE owner_user_id = $1",
  [user.id]
);

if (!existing.rowCount) {
  await client.query(
    `INSERT INTO referral_codes(owner_user_id, code)
     VALUES ($1,$2)`,
    [user.id, randomBytes(18).toString("base64url")]
  );
}

await client.query("COMMIT");
return user;

} catch (error) {
await client.query("ROLLBACK");
throw error;
} finally {
client.release();
}
}

async function saveReferral(userId, code) {
const client = await pool.connect();

try {
await client.query("BEGIN");

const result = await client.query(
  `SELECT owner_user_id
   FROM referral_codes
   WHERE code = $1 AND active = TRUE`,
  [code]
);

if (!result.rowCount) {
  await client.query("ROLLBACK");
  return "invalid";
}

const referrerId = result.rows[0].owner_user_id;

if (String(referrerId) === String(userId)) {
  await client.query("ROLLBACK");
  return "self";
}

const inserted = await client.query(
  `INSERT INTO referrals
    (referrer_user_id, referred_user_id, referral_code_used)
   VALUES ($1,$2,$3)
   ON CONFLICT (referred_user_id) DO NOTHING
   RETURNING id`,
  [referrerId, userId, code]
);

await client.query("COMMIT");

return inserted.rowCount ? "pending" : "existing";

} catch (error) {
await client.query("ROLLBACK");
throw error;
} finally {
client.release();
}
}

async function checkMembership(telegramUserId) {
const result = await telegram("getChatMember", {
chat_id: CHANNEL_ID,
user_id: telegramUserId
});

return (
["creator", "administrator", "member"].includes(result.status) ||
(result.status === "restricted" && result.is_member === true)
);
}

async function processUpdate(update) {
const message = update.message;

if (!message?.text || !message.from || message.from.is_bot) {
return;
}

const chatId = message.chat.id;
const from = message.from;
const text = message.text.trim();

const start = text.match(
/^/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{1,100}))?$/
);

if (start) {
const user = await getOrCreateUser(from);

if (user.account_status !== "active") {
  await sendMessage(chatId, "Your account is unavailable.");
  return;
}

let notice = "";

if (start[1]) {
  const result = await saveReferral(user.id, start[1]);

  const messages = {
    invalid: "This referral code is invalid or inactive.",
    self: "You cannot use your own referral link.",
    pending: "Your referral is pending verification.",
    existing: "A referral is already recorded for your account."
  };

  notice = `\n\n${messages[result]}`;
}

await sendMessage(
  chatId,
  `Welcome to the HRRY PDF Unlock Platform!\n\n` +
  `1. Open the website.\n` +
  `2. Log in with Telegram.\n` +
  `3. Join the required channel.\n` +
  `4. Complete verification.\n\n` +
  `Referral credit is awarded only after the required checks.` +
  notice,
  {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Open Website", url: FRONTEND_URL }],
        [{ text: "Join Channel", url: CHANNEL_URL }]
      ]
    }
  }
);

return;

}

if (/^/help(?:@\w+)?$/.test(text)) {
await sendMessage(
chatId,
"Available commands:\n" +
"/start - Start the bot\n" +
"/help - Show help\n" +
"/status - Check channel membership\n" +
"/referral - Get your referral link"
);
return;
}

if (/^/status(?:@\w+)?$/.test(text)) {
const user = await getOrCreateUser(from);

let member;

try {
  member = await checkMembership(from.id);
} catch (error) {
  console.error("Membership check failed:", error.message);

  await sendMessage(
    chatId,
    "Membership could not be verified. Check your channel membership and try again later."
  );

  return;
}

await pool.query(
  `INSERT INTO channel_memberships
    (user_id, channel_id, membership_status,
     last_verified_at, verification_error)
   VALUES ($1,$2,$3,NOW(),NULL)
   ON CONFLICT(user_id,channel_id)
   DO UPDATE SET
     membership_status = EXCLUDED.membership_status,
     last_verified_at = NOW(),
     verification_error = NULL`,
  [
    user.id,
    CHANNEL_ID,
    member ? "member" : "not_member"
  ]
);

await sendMessage(
  chatId,
  member
    ? "Channel membership verified. Referral eligibility is checked separately."
    : "You are not a verified channel member. Join the channel and try again."
);

return;

}

if (/^/referral(?:@\w+)?$/.test(text)) {
const user = await getOrCreateUser(from);

const result = await pool.query(
  `SELECT code FROM referral_codes
   WHERE owner_user_id = $1 AND active = TRUE`,
  [user.id]
);

const link =
  `https://t.me/${BOT_USERNAME}?start=${result.rows[0].code}`;

await sendMessage(
  chatId,
  `Your referral link:\n${link}\n\n` +
  "Only verified direct referrals count toward PDF unlocking."
);

}
}

app.get("/health", async (_req, res) => {
try {
await pool.query("SELECT 1");
res.json({ ok: true, database: "connected" });
} catch {
res.status(503).json({
ok: false,
database: "unavailable"
});
}
});

app.post("/api/telegram/webhook", async (req, res) => {
const supplied =
req.get("X-Telegram-Bot-Api-Secret-Token") || "";

const a = Buffer.from(supplied);
const b = Buffer.from(WEBHOOK_SECRET);

if (a.length !== b.length || !timingSafeEqual(a, b)) {
return res.status(401).json({ error: "unauthorized" });
}

const update = req.body;

if (!Number.isSafeInteger(update?.update_id)) {
return res.status(400).json({ error: "invalid_update" });
}

const client = await pool.connect();

try {
await client.query("BEGIN");

const inserted = await client.query(
  `INSERT INTO telegram_updates(update_id)
   VALUES ($1)
   ON CONFLICT DO NOTHING
   RETURNING update_id`,
  [update.update_id]
);

if (!inserted.rowCount) {
  await client.query("COMMIT");
  return res.sendStatus(200);
}

await processUpdate(update);

await client.query("COMMIT");
return res.sendStatus(200);

} catch (error) {
await client.query("ROLLBACK");

console.error("Webhook processing failed:", error.message);

return res.status(500).json({
  error: "processing_failed"
});

} finally {
client.release();
}
});

async function main() {
await initializeDatabase();

app.listen(PORT, "0.0.0.0", () => {
console.log("HRRY Telegram Bot running on port ${PORT}");
});
}

main().catch((error) => {
console.error("Startup failed:", error.message);
process.exit(1);
});
