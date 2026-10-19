'use strict';

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const TelegramBot = require('node-telegram-bot-api');
const { Readable } = require('stream');
const admin = require('firebase-admin');

const {
  TELEGRAM_BOT_TOKEN,
  FIREBASE_SERVICE_ACCOUNT_JSON,
  WEBSITE_URL
} = process.env;

const BOT_USERNAME = 'hrrrrrrrrry_bot';
const CHANNEL_URL = 'https://t.me/hrbseb10thallcorse';
const TELEGRAM_CHANNEL_ID = '@hrbseb10thallcorse';
const DATABASE_URL = 'https://hrushs-default-rtdb.firebaseio.com/';

if (!TELEGRAM_BOT_TOKEN || !FIREBASE_SERVICE_ACCOUNT_JSON || !WEBSITE_URL) {
  console.error('Missing environment variables. Add TELEGRAM_BOT_TOKEN, FIREBASE_SERVICE_ACCOUNT_JSON and WEBSITE_URL in Render.');
  process.exit(1);
}
if (!/^https:\/\//i.test(WEBSITE_URL)) {
  console.error('WEBSITE_URL must be your Vercel HTTPS website URL, e.g. https://your-project.vercel.app');
  process.exit(1);
}

const websiteUrl = WEBSITE_URL.replace(/\/+$/, '');
const tokenSecret = crypto.createHash('sha256').update(`dashboard-token-v1:${TELEGRAM_BOT_TOKEN}`).digest();
const serviceAccount = JSON.parse(FIREBASE_SERVICE_ACCOUNT_JSON);
if (!admin.apps.length) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: DATABASE_URL });
}
const db = admin.database();
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '12kb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/', rateLimit({ windowMs: 60_000, limit: 50, standardHeaders: true, legacyHeaders: false }));

const SUBJECTS = [
  { id: 'economics', name: 'Economics (10 Bhramastra)', driveId: '1hbKSxeX6SWK0lpSWHo21vNK8l9F5IXJ9' },
  { id: 'physics', name: 'Physics', driveId: '1PN9LaQCaWWCfV7xdNCb8PgC671Fs7hdQ' },
  { id: 'civics', name: 'Civics', driveId: '1_t7x5irxluEdx7ugxo2lbdLctFss0dWD' },
  { id: 'history', name: 'History', driveId: '1AujJJqkmWFl9cFeB4_MsQ9ffU2m40vsB' },
  { id: 'maths', name: 'Maths', driveId: '1bI5Siizo_vqftacfvZ_HR7vY3bDcgzMa' },
  { id: 'chemistry', name: 'Chemistry', driveId: '1O890P8zKHkRk0jmaPp4cxGHvGn-lI8OY' },
  { id: 'biology', name: 'Biology', driveId: '1oP8A7XC6-aPkZCwJLhAF_c2uNqXmdXzp' },
  { id: 'sanskrit', name: 'Sanskrit', driveId: '1X0CZR2AZ33EuEHAhFtzi9wYpsBts6FjB' },
  { id: 'english', name: 'English', driveId: '1GSTyzCiPRwcmfGiaFR-NJRBe2El5UVEj' }
];

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', tokenSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}
function verifyToken(token) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const expected = crypto.createHmac('sha256', tokenSecret).update(parts[0]).digest('base64url');
  const a = Buffer.from(parts[1]); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!payload.uid || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}
function makeDashboardUrl(uid) {
  const token = signToken({ uid: String(uid), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  return `${websiteUrl}/?token=${encodeURIComponent(token)}`;
}
function memberIsActive(member) {
  if (!member) return false;
  return ['creator', 'administrator', 'member'].includes(member.status) ||
    (member.status === 'restricted' && member.is_member === true);
}
async function isChannelMember(uid) {
  try {
    const member = await bot.getChatMember(TELEGRAM_CHANNEL_ID, Number(uid));
    return memberIsActive(member);
  } catch (err) {
    console.error('Channel membership check failed:', err.message);
    return false;
  }
}
async function getUser(uid) {
  const snap = await db.ref(`users/${uid}`).get();
  return snap.exists() ? snap.val() : null;
}
function validUid(value) { return /^[0-9]{1,20}$/.test(String(value || '')); }
function parseReferral(startParam, uid) {
  if (typeof startParam !== 'string' || !/^ref_[0-9]{1,20}$/.test(startParam)) return null;
  const referrer = startParam.slice(4);
  return referrer !== String(uid) ? referrer : null;
}
async function createUserIfNeeded(tgUser, startParam) {
  const uid = String(tgUser.id);
  const userRef = db.ref(`users/${uid}`);
  const proposedReferrer = parseReferral(startParam, uid);
  const creationNonce = crypto.randomUUID();
  const result = await userRef.transaction(current => {
    if (current) return current;
    return {
      telegram_id: uid,
      first_name: String(tgUser.first_name || 'Student').slice(0, 80),
      referred_by: null,
      referral_count: 0,
      joined_channel: false,
      credited_referrals: {},
      created_at: admin.database.ServerValue.TIMESTAMP,
      _creation_nonce: creationNonce
    };
  }, undefined, false);

  // Only the request that actually created the account can set the first referrer.
  const newlyCreated = result.snapshot.exists() && result.snapshot.child('_creation_nonce').val() === creationNonce;
  if (newlyCreated) {
    if (proposedReferrer) {
      const referrerExists = await db.ref(`users/${proposedReferrer}`).get();
      if (referrerExists.exists()) await userRef.child('referred_by').set(proposedReferrer);
    }
    await userRef.child('_creation_nonce').remove();
  }
  const fresh = await getUser(uid);
  if (fresh && !fresh.first_name && tgUser.first_name) await userRef.child('first_name').set(String(tgUser.first_name).slice(0, 80));
  return await getUser(uid);
}
async function verifyAndCredit(uid) {
  if (!(await isChannelMember(uid))) return { ok: false, reason: 'not_member' };
  const eventId = crypto.randomUUID();
  const userRef = db.ref(`users/${uid}`);
  const result = await userRef.transaction(current => {
    if (!current) return;
    if (current.joined_channel === true) return current;
    return { ...current, joined_channel: true, verified_at: admin.database.ServerValue.TIMESTAMP, verification_event: eventId };
  }, undefined, false);
  if (!result.committed || !result.snapshot.exists()) return { ok: false, reason: 'missing_user' };
  const user = result.snapshot.val();
  const newlyVerified = user.verification_event === eventId;

  // Atomic marker + count update on the inviter prevents repeat verification from earning extra credit.
  if (newlyVerified && validUid(user.referred_by) && user.referred_by !== String(uid)) {
    const inviterRef = db.ref(`users/${user.referred_by}`);
    await inviterRef.transaction(current => {
      if (!current) return;
      const credits = current.credited_referrals || {};
      if (credits[String(uid)]) return current;
      return {
        ...current,
        referral_count: Math.max(0, Number(current.referral_count) || 0) + 1,
        credited_referrals: { ...credits, [String(uid)]: true }
      };
    }, undefined, false);
  }
  return { ok: true, user: await getUser(uid) };
}
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Login link expired or invalid. Open the dashboard again from the Telegram bot.' });
  req.uid = String(payload.uid);
  next();
}

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/api/user-data', authMiddleware, async (req, res) => {
  try {
    const user = await getUser(req.uid);
    if (!user) return res.status(404).json({ error: 'User not found. Open the Telegram bot and press Start.' });
    if (!user.joined_channel || !(await isChannelMember(req.uid))) {
      return res.status(403).json({ error: 'Please join the Telegram channel and verify your membership in the bot first.', needsMembership: true, channelUrl: CHANNEL_URL });
    }
    const count = Math.max(0, Number(user.referral_count) || 0);
    res.json({
      firstName: user.first_name || 'Student',
      referralCount: count,
      requiredReferrals: 9,
      referralLink: `https://t.me/${BOT_USERNAME}?start=ref_${req.uid}`,
      subjects: SUBJECTS.map((s, i) => ({ id: s.id, name: s.name, required: i + 1, unlocked: count >= i + 1, downloadPath: count >= i + 1 ? `/api/download/${s.id}` : null }))
    });
  } catch (err) {
    console.error('user-data error:', err.message);
    res.status(500).json({ error: 'Could not load dashboard. Please try again.' });
  }
});
app.get('/api/download/:subjectId', authMiddleware, async (req, res) => {
  try {
    const subject = SUBJECTS.find(s => s.id === req.params.subjectId);
    if (!subject) return res.status(404).json({ error: 'PDF not found.' });
    const user = await getUser(req.uid);
    if (!user || !user.joined_channel || !(await isChannelMember(req.uid))) return res.status(403).send('Join the Telegram channel and verify membership first.');
    const index = SUBJECTS.findIndex(s => s.id === subject.id) + 1;
    if ((Number(user.referral_count) || 0) < index) return res.status(403).send('This PDF is locked. Complete the referral milestone first.');

    const driveUrl = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(subject.driveId)}`;
    const upstream = await fetch(driveUrl, { redirect: 'follow', signal: AbortSignal.timeout(25000) });
    const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
    if (!upstream.ok || !contentType.includes('pdf')) {
      console.error(`Drive did not return a PDF for ${subject.id}; status=${upstream.status}; content-type=${contentType}`);
      return res.status(502).send('Google Drive did not provide the PDF directly. Check that this file is accessible to viewers and try again later.');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${subject.id}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('download error:', err.message);
    if (!res.headersSent) res.status(502).send('Download failed. Please try again later.');
  }
});

async function sendHome(chatId, user, userData) {
  const keyboard = [];
  if (!userData || !userData.joined_channel) {
    keyboard.push([{ text: '📢 Join Telegram Channel', url: CHANNEL_URL }]);
    keyboard.push([{ text: '✅ Verify Membership', callback_data: 'verify_membership' }]);
  } else {
    keyboard.push([{ text: '🌐 Open My Dashboard', url: makeDashboardUrl(user.telegram_id) }]);
    keyboard.push([{ text: '🔄 Refresh / Verify Again', callback_data: 'verify_membership' }]);
  }
  await bot.sendMessage(chatId,
    `Hi ${user.first_name || 'Student'}! 👋\n\n` +
    `Welcome to the Study PDF Referral Bot.\n\n` +
    `1. Join the channel.\n2. Tap “Verify Membership”.\n3. Open your dashboard.\n4. Invite friends using your personal referral link.\n\n` +
    `One verified direct referral = one subject unlock. There are 9 subjects.`,
    { reply_markup: { inline_keyboard: keyboard } });
}

bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
  try {
    const startParam = (match && match[1] || '').trim();
    const user = await createUserIfNeeded(msg.from, startParam);
    await sendHome(msg.chat.id, user, user);
  } catch (err) {
    console.error('/start error:', err.message);
    bot.sendMessage(msg.chat.id, 'Something went wrong. Please try /start again in a moment.').catch(() => {});
  }
});

bot.on('callback_query', async query => {
  if (query.data !== 'verify_membership') return;
  const chatId = query.message && query.message.chat && query.message.chat.id;
  const uid = String(query.from.id);
  try {
    await bot.answerCallbackQuery(query.id, { text: 'Checking channel membership…' });
    const user = await getUser(uid);
    if (!user) {
      if (chatId) await bot.sendMessage(chatId, 'Please press /start first.');
      return;
    }
    const result = await verifyAndCredit(uid);
    if (!result.ok && result.reason === 'not_member') {
      if (chatId) await bot.sendMessage(chatId, `I cannot see your membership yet. Join the channel first, then tap Verify Membership.\n\n${CHANNEL_URL}`, {
        reply_markup: { inline_keyboard: [[{ text: '📢 Join Channel', url: CHANNEL_URL }, { text: '✅ Verify Again', callback_data: 'verify_membership' }]] }
      });
      return;
    }
    if (!result.ok) {
      if (chatId) await bot.sendMessage(chatId, 'Please press /start again and retry verification.');
      return;
    }
    const fresh = result.user;
    if (chatId) {
      await bot.sendMessage(chatId,
        `✅ Membership verified!\n\nYour direct verified referrals: ${Number(fresh.referral_count) || 0}/9\n\nOpen your dashboard below.`,
        { reply_markup: { inline_keyboard: [[{ text: '🌐 Open My Dashboard', url: makeDashboardUrl(uid) }], [{ text: '🔗 Share My Referral Link', url: `https://t.me/${BOT_USERNAME}?start=ref_${uid}` }]] } });
    }
  } catch (err) {
    console.error('verify callback error:', err.message);
    if (chatId) bot.sendMessage(chatId, 'Could not verify right now. Please try again.').catch(() => {});
  }
});

bot.on('polling_error', err => console.error('Telegram polling error:', err.message));
app.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Bot API listening on port', process.env.PORT || 3000));
