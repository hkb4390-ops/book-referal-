'use strict';

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');
const path = require('path');
const { Readable } = require('stream');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

const PORT = Number(process.env.PORT || 3000);

const BASE_URL = (
process.env.BASE_URL || ''
).replace(//+$/, '');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const BOT_USERNAME = (
process.env.TELEGRAM_BOT_USERNAME || 'hrrrrrrrrry_bot'
).replace(/^@/, '');

const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;

const CHANNEL_URL =
process.env.TELEGRAM_CHANNEL_URL ||
'https://t.me/hrbseb10thallcorse';

const DASHBOARD_TOKEN_SECRET =
process.env.DASHBOARD_TOKEN_SECRET;

const SERVICE_ACCOUNT_JSON =
process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

if (
!BASE_URL ||
!BOT_TOKEN ||
!CHANNEL_ID ||
!SERVICE_ACCOUNT_JSON ||
!DASHBOARD_TOKEN_SECRET ||
Buffer.byteLength(DASHBOARD_TOKEN_SECRET) < 32
) {
throw new Error(
'Missing required environment variables. Check Render Environment settings.'
);
}

if (!BASE_URL.startsWith('https://')) {
throw new Error('BASE_URL must use HTTPS in production.');
}

const serviceAccount = JSON.parse(SERVICE_ACCOUNT_JSON);

admin.initializeApp({
credential: admin.credential.cert(serviceAccount),
databaseURL: 'https://hrushs-default-rtdb.firebaseio.com/'
});

const db = admin.database();

const bot = new TelegramBot(BOT_TOKEN, {
polling: true
});

app.use(
helmet({
contentSecurityPolicy: {
directives: {
defaultSrc: ["'self'"],
scriptSrc: ["'self'"],
styleSrc: ["'self'", "'unsafe-inline'"],
imgSrc: ["'self'", 'data:'],
connectSrc: ["'self'"],
objectSrc: ["'none'"],
frameAncestors: ["'none'"],
baseUri: ["'self'"],
formAction: ["'self'"]
}
},
crossOriginEmbedderPolicy: false
})
);

app.use(express.json({ limit: '16kb' }));

app.use(
'/api/',
rateLimit({
windowMs: 60 * 1000,
limit: 60,
standardHeaders: 'draft-7',
legacyHeaders: false
})
);

// PDF file IDs are backend-only.
// Do not move these values into index.html.

const SUBJECTS = [
{
id: 'economics',
name: 'Economics (10 Bhramastra)',
driveId: '1hbKSxeX6SWK0lpSWHo21vNK8l9F5IXJ9'
},
{
id: 'physics',
name: 'Physics',
driveId: '1PN9LaQCaWWCfV7xdNCb8PgC671Fs7hdQ'
},
{
id: 'civics',
name: 'Civics',
driveId: '1_t7x5irxluEdx7ugxo2lbdLctFss0dWD'
},
{
id: 'history',
name: 'History',
driveId: '1AujJJqkmWFl9cFeB4_MsQ9ffU2m40vsB'
},
{
id: 'maths',
name: 'Maths',
driveId: '1bI5Siizo_vqftacfvZ_HR7vY3bDcgzMa'
},
{
id: 'chemistry',
name: 'Chemistry',
driveId: '1O890P8zKHkRk0jmaPp4cxGHvGn-lI8OY'
},
{
id: 'biology',
name: 'Biology',
driveId: '1oP8A7XC6-aPkZCwJLhAF_c2uNqXmdXzp'
},
{
id: 'sanskrit',
name: 'Sanskrit',
driveId: '1X0CZR2AZ33EuEHAhFtzi9wYpsBts6FjB'
},
{
id: 'english',
name: 'English',
driveId: '1GSTyzCiPRwcmfGiaFR-NJRBe2El5UVEj'
}
];

const SUBJECT_MAP = new Map(
SUBJECTS.map((subject, index) => [
subject.id,
{
...subject,
requiredReferrals: index + 1
}
])
);

function getUserRef(uid) {
return db.ref("users/${String(uid)}");
}

async function getUser(uid) {
const snapshot = await getUserRef(uid).get();

return snapshot.exists()
? snapshot.val()
: null;
}

function createDashboardToken(uid) {
const payload = {
uid: String(uid),
exp: Date.now() + 7 * 24 * 60 * 60 * 1000
};

const body = Buffer
.from(JSON.stringify(payload))
.toString('base64url');

const signature = crypto
.createHmac('sha256', DASHBOARD_TOKEN_SECRET)
.update(body)
.digest('base64url');

return "${body}.${signature}";
}

function verifyDashboardToken(token) {
if (
typeof token !== 'string' ||
token.length > 2048
) {
return null;
}

const parts = token.split('.');

if (parts.length !== 2) {
return null;
}

const expected = crypto
.createHmac('sha256', DASHBOARD_TOKEN_SECRET)
.update(parts[0])
.digest('base64url');

const suppliedBuffer = Buffer.from(parts[1]);
const expectedBuffer = Buffer.from(expected);

if (
suppliedBuffer.length !== expectedBuffer.length ||
!crypto.timingSafeEqual(
suppliedBuffer,
expectedBuffer
)
) {
return null;
}

try {
const payload = JSON.parse(
Buffer.from(parts[0], 'base64url').toString('utf8')
);

if (
  !/^\d{1,20}$/.test(String(payload.uid || '')) ||
  !Number.isFinite(payload.exp) ||
  payload.exp < Date.now()
) {
  return null;
}

return payload;

} catch {
return null;
}
}

function makeDashboardUrl(uid) {
const token = createDashboardToken(uid);

return (
"${BASE_URL}/?token=${encodeURIComponent(token)}"
);
}

function parseReferral(parameter, userId) {
if (
typeof parameter !== 'string' ||
!/^ref_\d{1,20}$/.test(parameter)
) {
return null;
}

const referrerId = parameter.slice(4);

if (referrerId === String(userId)) {
return null;
}

return referrerId;
}

async function createUserIfMissing(
telegramUser,
startParameter
) {
const uid = String(telegramUser.id);
const userRef = getUserRef(uid);

const proposedReferrer = parseReferral(
startParameter,
uid
);

const transaction = await userRef.transaction(
current => {
if (current !== null) {
return current;
}

  return {
    telegram_id: uid,
    first_name: String(
      telegramUser.first_name || 'Student'
    ).slice(0, 80),
    referred_by: proposedReferrer,
    referral_count: 0,
    joined_channel: 0,
    created_at: Date.now()
  };
},
undefined,
false

);

let user = transaction.snapshot.val();

// Only accept referrals from existing users.
if (user && user.referred_by) {
const referrer = await getUser(user.referred_by);

if (!referrer) {
  await userRef.child('referred_by').set(null);
  user = await getUser(uid);
}

}

return user;
}

async function verifyChannelMembership(uid) {
const member = await bot.getChatMember(
CHANNEL_ID,
Number(uid)
);

return (
['creator', 'administrator', 'member'].includes(
member.status
) ||
(
member.status === 'restricted' &&
member.is_member === true
)
);
}

async function incrementReferralOnce(referrerId, referredId) {
if (
!referrerId ||
String(referrerId) === String(referredId)
) {
return null;
}

// A unique record makes the credit idempotent even if
// verification callbacks are repeated or retried.
const creditRef = db.ref(
"referral_credits/${String(referredId)}"
);

const creditTransaction = await creditRef.transaction(
current => {
if (current !== null) {
return current;
}

  return {
    referrer_id: String(referrerId),
    referred_id: String(referredId),
    created_at: Date.now()
  };
},
undefined,
false

);

if (!creditTransaction.committed) {
return null;
}

const countTransaction = await db
.ref("users/${String(referrerId)}/referral_count")
.transaction(
current => Math.max(0, Number(current || 0)) + 1,
undefined,
false
);

return Number(countTransaction.snapshot.val() || 0);
}

async function sendStartKeyboard(chatId) {
await bot.sendMessage(
chatId,
'Welcome! 👋\n\n' +
'Join our Telegram channel first, then tap ' +
'Verify Membership to open your dashboard.',
{
reply_markup: {
inline_keyboard: [
[
{
text: '📢 Join Channel',
url: CHANNEL_URL
}
],
[
{
text: '✅ Verify Membership',
callback_data: 'verify_membership'
}
]
]
}
}
);
}

// Telegram /start command

bot.onText(
/^/start(?:\s+(.+))?$/,
async (message, match) => {
try {
const startParameter = (
match && match[1]
? match[1].trim()
: ''
).slice(0, 64);

  await createUserIfMissing(
    message.from,
    startParameter
  );

  await sendStartKeyboard(
    message.chat.id
  );
} catch (error) {
  console.error(
    'START_ERROR:',
    error.message
  );

  await bot.sendMessage(
    message.chat.id,
    'Something went wrong. Please try /start again.'
  ).catch(() => {});
}

}
);

// Membership verification callback

bot.on(
'callback_query',
async query => {
if (
query.data !== 'verify_membership' ||
!query.message
) {
return;
}

const uid = String(query.from.id);

try {
  await bot.answerCallbackQuery(
    query.id,
    { text: 'Checking membership…' }
  );

  const user = await getUser(uid);

  if (!user) {
    await bot.sendMessage(
      query.message.chat.id,
      'Please send /start first.'
    );

    return;
  }

  const joined = await verifyChannelMembership(uid);

  if (!joined) {
    await bot.sendMessage(
      query.message.chat.id,
      'Membership not found. Join the channel and try again.',
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '📢 Join Channel',
                url: CHANNEL_URL
              }
            ],
            [
              {
                text: '🔄 Verify Membership',
                callback_data: 'verify_membership'
              }
            ]
          ]
        }
      }
    );

    return;
  }

  // Mark joined status atomically.
  const joinedTransaction = await getUserRef(uid)
    .child('joined_channel')
    .transaction(
      current => {
        if (
          current === 1 ||
          current === true
        ) {
          return current;
        }

        return 1;
      },
      undefined,
      false
    );

  const firstVerification =
    joinedTransaction.committed &&
    joinedTransaction.snapshot.val() === 1 &&
    user.joined_channel !== 1 &&
    user.joined_channel !== true;

  // Re-read after the transaction so we use current data.
  const latestUser = await getUser(uid);

  if (
    firstVerification &&
    latestUser &&
    latestUser.referred_by
  ) {
    try {
      const newCount = await incrementReferralOnce(
        latestUser.referred_by,
        uid
      );

      if (newCount !== null) {
        await bot.sendMessage(
          Number(latestUser.referred_by),
          `🎉 New referral joined! Your count: ${newCount}/9`
        );
      }
    } catch (referralError) {
      console.error(
        'REFERRAL_ERROR:',
        referralError.message
      );
    }
  }

  await bot.sendMessage(
    query.message.chat.id,
    '✅ Membership verified!\n\n' +
      'Your personal dashboard is ready.',
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '🎓 Open Dashboard',
              url: makeDashboardUrl(uid)
            }
          ]
        ]
      }
    }
  );
} catch (error) {
  console.error(
    'VERIFY_ERROR:',
    error.message
  );

  await bot.sendMessage(
    query.message.chat.id,
    'Verification failed temporarily. Please try again.'
  ).catch(() => {});
}

}
);

bot.on(
'polling_error',
error => {
console.error(
'TELEGRAM_POLLING_ERROR:',
error.message
);
}
);

// Serve the frontend.

app.get('/', (req, res) => {
res.sendFile(
path.join(__dirname, 'index.html')
);
});

app.get('/healthz', (req, res) => {
res.status(200).json({
ok: true
});
});

// Authenticate all dashboard APIs using the signed token.

function requireDashboardToken(req, res, next) {
const token = String(
req.query.token ||
req.get('x-dashboard-token') ||
''
);

const payload = verifyDashboardToken(token);

if (!payload) {
return res.status(401).json({
error: 'Invalid or expired dashboard token. Reopen the dashboard from Telegram.'
});
}

req.dashboardUserId = payload.uid;
req.dashboardToken = token;

next();
}

// User dashboard data.

app.get(
'/api/user-data',
requireDashboardToken,
async (req, res) => {
try {
const uid = req.dashboardUserId;
const user = await getUser(uid);

  if (!user) {
    return res.status(404).json({
      error: 'User not found.'
    });
  }

  const referralCount = Math.max(
    0,
    Number(user.referral_count || 0)
  );

  const subjects = SUBJECTS.map(
    (subject, index) => {
      const requiredReferrals = index + 1;

      const unlocked =
        referralCount >= requiredReferrals;

      return {
        id: subject.id,
        name: subject.name,
        required_referrals: requiredReferrals,
        unlocked,
        download_url: unlocked
          ? (
              `/api/download/${subject.id}` +
              `?token=${encodeURIComponent(req.dashboardToken)}`
            )
          : null
      };
    }
  );

  res.set('Cache-Control', 'no-store');

  res.json({
    first_name: String(
      user.first_name || 'Student'
    ),
    referral_count: referralCount,
    referral_target: 9,
    joined_channel:
      user.joined_channel === 1 ||
      user.joined_channel === true,
    referral_link:
      `https://t.me/${BOT_USERNAME}?start=ref_${uid}`,
    subjects
  });
} catch (error) {
  console.error(
    'USER_DATA_ERROR:',
    error.message
  );

  res.status(500).json({
    error: 'Unable to load dashboard data.'
  });
}

}
);

// Secure PDF download proxy.
// Raw Drive URLs and IDs never leave the backend.

app.get(
'/api/download/:subjectId',
requireDashboardToken,
async (req, res) => {
try {
const subject = SUBJECT_MAP.get(
String(req.params.subjectId || '')
);

  if (!subject) {
    return res.status(404).send('Not found.');
  }

  const user = await getUser(
    req.dashboardUserId
  );

  if (!user) {
    return res.status(404).send('User not found.');
  }

  const joined =
    user.joined_channel === 1 ||
    user.joined_channel === true;

  if (!joined) {
    return res.status(403).send(
      'Verify channel membership first.'
    );
  }

  const count = Math.max(
    0,
    Number(user.referral_count || 0)
  );

  if (count < subject.requiredReferrals) {
    return res.status(403).send(
      'This PDF is locked. Invite more direct referrals.'
    );
  }

  const driveUrl =
    'https://drive.google.com/uc?export=download&id=' +
    encodeURIComponent(subject.driveId);

  const upstream = await fetch(
    driveUrl,
    {
      redirect: 'follow',
      signal: AbortSignal.timeout(25000)
    }
  );

  if (!upstream.ok || !upstream.body) {
    return res.status(502).send(
      'PDF provider is unavailable.'
    );
  }

  const contentType =
    upstream.headers.get('content-type') || '';

  if (
    !contentType.toLowerCase().includes('pdf') &&
    !contentType.toLowerCase().includes('octet-stream')
  ) {
    return res.status(502).send(
      'Google Drive did not return a direct PDF. Configure an authenticated Drive download.'
    );
  }

  res.setHeader(
    'Content-Type',
    'application/pdf'
  );

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${subject.id}.pdf"`
  );

  res.setHeader(
    'Cache-Control',
    'private, no-store'
  );

  Readable.fromWeb(upstream.body).pipe(res);
} catch (error) {
  console.error(
    'DOWNLOAD_ERROR:',
    error.message
  );

  if (!res.headersSent) {
    res.status(502).send(
      'Download failed. Please try again later.'
    );
  }
}

}
);

// Global error handler.

app.use(
(error, req, res, next) => {
console.error(
'SERVER_ERROR:',
error.message
);

if (!res.headersSent) {
  res.status(500).json({
    error: 'Internal server error.'
  });
}

}
);

const server = app.listen(
PORT,
() => {
console.log(
"Server listening on port ${PORT}"
);
}
);

async function shutdown(signal) {
console.log("${signal}: shutting down");

server.close();

try {
await bot.stopPolling();
} catch {}

process.exit(0);
}

process.on(
'SIGTERM',
() => shutdown('SIGTERM')
);

process.on(
'SIGINT',
() => shutdown('SIGINT')
);
