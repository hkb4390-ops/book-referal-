'use strict';
/**
 * Referral-Based Educational PDF Unlock Platform — backend
 * Node 18+ / Express. Firebase Realtime Database via REST, Telegram Bot API via fetch.
 */
const express = require('express');
const crypto = require('crypto');

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */
const env = process.env;
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = (env.TELEGRAM_BOT_USERNAME || 'hrrrrrrrrry_bot').replace(/^@/, '');
const CHANNEL_ID = env.TELEGRAM_CHANNEL_ID || '-1004498096954';
const CHANNEL_URL = env.TELEGRAM_CHANNEL_URL || 'https://t.me/hrbseb10thallcorse';
const DB_URL = (env.FIREBASE_DATABASE_URL || '').replace(/\/+$/, '');
const DB_SECRET = env.FIREBASE_DATABASE_SECRET || ''; // optional, only if your DB rules are locked
const FRONTEND_URL = (env.FRONTEND_URL || '').replace(/\/+$/, '');
const BACKEND_URL = (env.BACKEND_URL || '').replace(/\/+$/, '');
const PORT = Number(env.PORT) || 3000;

for (const [k, v] of Object.entries({ TELEGRAM_BOT_TOKEN: BOT_TOKEN, FIREBASE_DATABASE_URL: DB_URL, FRONTEND_URL })) {
  if (!v) { console.error(`Missing required env var: ${k}`); process.exit(1); }
}

/* ------------------------------------------------------------------ */
/* PDF catalogue (links never leave the server until unlocked)         */
/* ------------------------------------------------------------------ */
const PDFS = [
  { id: 1, subject: 'Economics', required: 1, url: 'https://drive.google.com/file/d/1hbKSxeX6SWK0lpSWHo21vNK8l9F5IXJ9/view?usp=drivesdk' },
  { id: 2, subject: 'Physics',   required: 2, url: 'https://drive.google.com/file/d/1PN9LaQCaWWCfV7xdNCb8PgC671Fs7hdQ/view?usp=drivesdk' },
  { id: 3, subject: 'Civics',    required: 3, url: 'https://drive.google.com/file/d/1_t7x5irxluEdx7ugxo2lbdLctFss0dWD/view?usp=drivesdk' },
  { id: 4, subject: 'History',   required: 4, url: 'https://drive.google.com/file/d/1AujJJqkmWFl9cFeB4_MsQ9ffU2m40vsB/view?usp=drivesdk' },
  { id: 5, subject: 'Maths',     required: 5, url: 'https://drive.google.com/file/d/1bI5Siizo_vqftacfvZ_HR7vY3bDcgzMa/view?usp=drivesdk' },
  { id: 6, subject: 'Chemistry', required: 6, url: 'https://drive.google.com/file/d/1O890P8zKHkRk0jmaPp4cxGHvGn-lI8OY/view?usp=drivesdk' },
  { id: 7, subject: 'Biology',   required: 7, url: 'https://drive.google.com/file/d/1oP8A7XC6-aPkZCwJLhAF_c2uNqXmdXzp/view?usp=drivesdk' },
  { id: 8, subject: 'Sanskrit',  required: 8, url: 'https://drive.google.com/file/d/1X0CZR2AZ33EuEHAhFtzi9wYpsBts6FjB/view?usp=drivesdk' },
  { id: 9, subject: 'English',   required: 9, url: 'https://drive.google.com/file/d/1GSTyzCiPRwcmfGiaFR-NJRBe2El5UVEj/view?usp=drivesdk' },
];

/* ------------------------------------------------------------------ */
/* Firebase Realtime Database (REST)                                   */
/* ------------------------------------------------------------------ */
function dbUrl(path) {
  const u = new URL(`${DB_URL}/${path}.json`);
  if (DB_SECRET) u.searchParams.set('auth', DB_SECRET);
  return u.toString();
}
async function dbGet(path) {
  const r = await fetch(dbUrl(path));
  if (!r.ok) throw new Error(`DB GET ${path} failed: ${r.status}`);
  return r.json();
}
async function dbPut(path, value) {
  const r = await fetch(dbUrl(path), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`DB PUT ${path} failed: ${r.status}`);
  return r.json();
}
async function dbPatch(path, value) {
  const r = await fetch(dbUrl(path), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  if (!r.ok) throw new Error(`DB PATCH ${path} failed: ${r.status}`);
  return r.json();
}
/** Atomic create-if-absent using Firebase ETags. Returns true only for the single winner. */
async function dbClaim(path, value) {
  const g = await fetch(dbUrl(path), { headers: { 'X-Firebase-ETag': 'true' } });
  if (!g.ok) throw new Error(`DB claim read ${path} failed: ${g.status}`);
  const etag = g.headers.get('etag');
  const current = await g.json();
  if (current !== null) return false;
  const p = await fetch(dbUrl(path), {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'if-match': etag },
    body: JSON.stringify(value),
  });
  return p.ok; // 412 => someone else won the race
}

/* ------------------------------------------------------------------ */
/* Telegram helpers                                                    */
/* ------------------------------------------------------------------ */
async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const send = (chatId, text, extra = {}) =>
  tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    .catch((e) => console.error('sendMessage failed', e.message));

/* Signed dashboard links: user IDs are public (they appear in referral links),
   so the dashboard URL carries an HMAC that only the bot can mint. */
const signKey = 'dashboard:' + BOT_TOKEN;
const signUser = (id) => crypto.createHmac('sha256', signKey).update(String(id)).digest('hex').slice(0, 32);
function validSig(id, sig) {
  if (typeof sig !== 'string' || sig.length !== 32) return false;
  const a = Buffer.from(signUser(id));
  const b = Buffer.from(sig);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const dashboardUrl = (id) => `${FRONTEND_URL}?user_id=${id}&sig=${signUser(id)}`;
const referralLink = (id) => `https://t.me/${BOT_USERNAME}?start=REF_${id}`;

/* ------------------------------------------------------------------ */
/* Domain logic                                                        */
/* ------------------------------------------------------------------ */
async function ensureUser(from, refId) {
  const id = String(from.id);
  const profile = { firstName: from.first_name || '', lastName: from.last_name || '', username: from.username || '' };

  let referredBy = null;
  if (refId && /^\d+$/.test(refId) && refId !== id) {
    const exists = await dbGet(`users/${refId}/id`);
    if (exists) referredBy = refId;
  }
  const fresh = { id, ...profile, createdAt: Date.now(), channelVerified: false };
  if (referredBy) fresh.referredBy = referredBy;

  const created = await dbClaim(`users/${id}`, fresh); // referrer is locked in only at first registration
  if (created) return fresh;

  await dbPatch(`users/${id}`, profile);
  const existing = await dbGet(`users/${id}`);
  return { ...existing, ...profile };
}

async function countVerified(userId) {
  const r = await dbGet(`referrals/${userId}`);
  return r ? Object.keys(r).length : 0;
}

async function checkMembership(userId) {
  const r = await tg('getChatMember', { chat_id: CHANNEL_ID, user_id: Number(userId) });
  if (!r.ok) return { ok: false, error: r.description || 'Telegram API error' };
  const s = r.result.status;
  const member = ['creator', 'administrator', 'member'].includes(s) || (s === 'restricted' && r.result.is_member === true);
  return { ok: true, member };
}

async function verifyAndCredit(userId) {
  const user = await dbGet(`users/${userId}`);
  if (!user) return { status: 'not_found' };

  const m = await checkMembership(userId);
  if (!m.ok) return { status: 'check_failed', message: m.error };
  if (!m.member) {
    await dbPatch(`users/${userId}`, { channelVerified: false });
    return { status: 'not_member' };
  }

  await dbPatch(`users/${userId}`, { channelVerified: true, verifiedAt: user.verifiedAt || Date.now() });

  let credited = false;
  const referrerId = user.referredBy ? String(user.referredBy) : null;
  if (referrerId && referrerId !== String(userId)) {
    // Lifetime idempotency: one credit record per referred user, ever.
    const record = { referrerId, at: Date.now() };
    credited = await dbClaim(`referralCredits/${userId}`, record);
    const credit = credited ? record : await dbGet(`referralCredits/${userId}`);
    if (credit && credit.referrerId === referrerId) {
      await dbPut(`referrals/${referrerId}/${userId}`, { verified: true, at: credit.at });
    }
    if (credited) notifyReferrer(referrerId, user).catch((e) => console.error('notify failed', e.message));
  }
  return { status: 'verified', credited };
}

async function notifyReferrer(referrerId, referred) {
  const count = await countVerified(referrerId);
  const name = esc([referred.firstName, referred.lastName].filter(Boolean).join(' ') || 'A friend');
  const newPdf = PDFS.find((p) => p.required === count);
  let text = `🎉 <b>${name}</b> joined the channel through your link!\nVerified referrals: <b>${count}/9</b>`;
  if (newPdf) text += `\n🔓 Unlocked: <b>PDF ${newPdf.id} (${newPdf.subject})</b>`;
  await send(referrerId, text, { reply_markup: mainKeyboard(referrerId) });
}

function buildDashboard(user, count) {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || 'Student';
  return {
    user: {
      id: String(user.id),
      name,
      username: user.username || null,
      avatarLetter: (name.trim()[0] || 'S').toUpperCase(),
    },
    channel: { verified: !!user.channelVerified, url: CHANNEL_URL },
    referrals: {
      verified: count,
      link: referralLink(user.id),
    },
    unlockedCount: PDFS.filter((p) => count >= p.required).length,
    totalPdfs: PDFS.length,
    pdfs: PDFS.map((p) => {
      const unlocked = count >= p.required;
      const item = { id: p.id, subject: p.subject, required: p.required, unlocked, remaining: unlocked ? 0 : p.required - count };
      if (unlocked) item.url = p.url; // locked links are never serialised
      return item;
    }),
  };
}

/* ------------------------------------------------------------------ */
/* Bot UI                                                              */
/* ------------------------------------------------------------------ */
function mainKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: '📚 Open Web Dashboard', url: dashboardUrl(userId) }],
      [{ text: '✅ Verify Membership', callback_data: 'verify' }],
      [{ text: '📢 Join Channel', url: CHANNEL_URL }],
    ],
  };
}

async function handleVerifyFlow(chatId, userId) {
  const res = await verifyAndCredit(userId);
  if (res.status === 'not_found') return send(chatId, 'Please send /start first.');
  if (res.status === 'check_failed') return send(chatId, '⚠️ Could not check membership right now. Please try again in a moment.');
  if (res.status === 'not_member') {
    return send(chatId, '❌ You have not joined the channel yet.\nJoin first, then tap <b>Verify Membership</b>.', { reply_markup: mainKeyboard(userId) });
  }
  const count = await countVerified(userId);
  return send(chatId, `✅ Membership verified!\nYour verified referrals: <b>${count}/9</b>`, { reply_markup: mainKeyboard(userId) });
}

async function handleMessage(msg) {
  if (!msg || !msg.from || msg.chat.type !== 'private') return;
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*(.*)$/);
  if (!cmd) return;
  const [, command, arg] = cmd;

  if (command === 'start') {
    const refMatch = arg.match(/^REF_(\d+)$/);
    const user = await ensureUser(msg.from, refMatch ? refMatch[1] : null);
    const name = esc(msg.from.first_name || 'there');
    let welcome = `👋 Welcome, <b>${name}</b>!\n\nInvite friends and unlock free educational PDFs:\n• 1 verified referral = 1 PDF (up to 9)\n• A referral counts once your friend joins our channel.\n\n`;
    if (user.referredBy && !user.channelVerified) welcome += '👉 Join the channel and tap <b>Verify Membership</b> to get started.\n\n';
    welcome += `🔗 Your link:\n${referralLink(user.id)}`;
    return send(chatId, welcome, { reply_markup: mainKeyboard(user.id) });
  }

  if (command === 'referral') {
    const user = await ensureUser(msg.from, null);
    return send(chatId, `🔗 <b>Your referral link</b>\n${referralLink(user.id)}\n\nEvery friend who starts the bot and joins the channel counts as +1.`, { reply_markup: mainKeyboard(user.id) });
  }

  if (command === 'status') {
    const user = await ensureUser(msg.from, null);
    const count = await countVerified(user.id);
    const unlocked = PDFS.filter((p) => count >= p.required);
    const next = PDFS.find((p) => count < p.required);
    let t = `📊 <b>Your status</b>\nChannel: ${user.channelVerified ? '✅ verified' : '❌ not verified'}\nVerified referrals: <b>${count}</b>\nPDFs unlocked: <b>${unlocked.length}/9</b>`;
    if (next) t += `\nNext: <b>PDF ${next.id} (${next.subject})</b> — ${next.required - count} more referral(s)`;
    else t += '\n🏆 All PDFs unlocked!';
    return send(chatId, t, { reply_markup: mainKeyboard(user.id) });
  }

  if (command === 'verify') {
    await ensureUser(msg.from, null);
    return handleVerifyFlow(chatId, String(msg.from.id));
  }

  if (command === 'help') {
    return send(chatId, '<b>Commands</b>\n/start – register / open dashboard\n/referral – your invite link\n/status – progress &amp; unlocks\n/verify – check channel membership\n/help – this message');
  }
}

async function handleCallback(cq) {
  if (!cq || !cq.from) return;
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Checking membership…' }).catch(() => {});
  if (cq.data === 'verify' && cq.message) {
    await ensureUser(cq.from, null);
    await handleVerifyFlow(cq.message.chat.id, String(cq.from.id));
  }
}

/* ------------------------------------------------------------------ */
/* HTTP server                                                         */
/* ------------------------------------------------------------------ */
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

const allowedOrigin = new URL(FRONTEND_URL).origin;
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && origin === allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, time: Date.now() }));

/* Webhook: intentionally NOT gated on any header, so a secret-token mismatch can never produce a 403.
   Always answers 200 so Telegram never retries/blocks the queue. */
app.post('/api/telegram/webhook', (req, res) => {
  res.sendStatus(200);
  const update = req.body || {};
  Promise.resolve()
    .then(() => (update.callback_query ? handleCallback(update.callback_query) : handleMessage(update.message)))
    .catch((e) => console.error('update failed:', e.message));
});

function authUser(source, res) {
  const id = String(source.user_id || '');
  if (!/^\d{1,20}$/.test(id)) { res.status(400).json({ error: 'invalid_user_id' }); return null; }
  if (!validSig(id, source.sig)) { res.status(401).json({ error: 'invalid_link', message: 'Please open the dashboard from the bot.' }); return null; }
  return id;
}

app.get('/api/me/dashboard', async (req, res) => {
  try {
    const id = authUser(req.query, res);
    if (!id) return;
    const user = await dbGet(`users/${id}`);
    if (!user) return res.status(404).json({ error: 'user_not_found', message: 'Send /start to the bot first.' });
    res.set('Cache-Control', 'no-store');
    res.json(buildDashboard(user, await countVerified(id)));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

const lastVerify = new Map();
app.post('/api/referrals/verify', async (req, res) => {
  try {
    const id = authUser(req.body || {}, res);
    if (!id) return;
    const now = Date.now();
    if (now - (lastVerify.get(id) || 0) < 3000) return res.status(429).json({ error: 'slow_down' });
    lastVerify.set(id, now);

    const result = await verifyAndCredit(id);
    if (result.status === 'not_found') return res.status(404).json({ error: 'user_not_found' });
    if (result.status === 'check_failed') return res.status(502).json({ error: 'telegram_check_failed', message: result.message });

    const user = await dbGet(`users/${id}`);
    res.set('Cache-Control', 'no-store');
    res.json({ status: result.status, credited: !!result.credited, dashboard: buildDashboard(user, await countVerified(id)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server_error' });
  }
});

app.listen(PORT, async () => {
  console.log(`Server listening on :${PORT}`);
  try {
    if (BACKEND_URL) {
      const wh = await tg('setWebhook', { url: `${BACKEND_URL}/api/telegram/webhook`, allowed_updates: ['message', 'callback_query'] });
      console.log('setWebhook:', wh.ok ? 'ok' : wh.description);
    }
    await tg('setMyCommands', {
      commands: [
        { command: 'start', description: 'Register & open dashboard' },
        { command: 'referral', description: 'Get your referral link' },
        { command: 'status', description: 'Your progress & unlocks' },
        { command: 'verify', description: 'Verify channel membership' },
        { command: 'help', description: 'Help' },
      ],
    });
  } catch (e) {
    console.error('Startup Telegram setup failed:', e.message);
  }
});
