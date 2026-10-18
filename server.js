const express = require('express');
const axios = require('axios');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));

// Configuration
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'hrrrrrrrrry_bot';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '4498096954';
const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/hrbseb10thallcorse';
const FIREBASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://hrry-store-default-rtdb.firebaseio.com';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || 'secret_webhook_token';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// 9 PDF Mapping according to system specifications
const PDF_REWARDS = [
    { id: 1, req: 1, subject: 'Economics', title: 'PDF 1 - Economics', url: 'https://drive.google.com/file/d/1hbKSxeX6SWK0lpSWHo21vNK8l9F5IXJ9/view?usp=drivesdk' },
    { id: 2, req: 2, subject: 'Physics', title: 'PDF 2 - Physics', url: 'https://drive.google.com/file/d/1PN9LaQCaWWCfV7xdNCb8PgC671Fs7hdQ/view?usp=drivesdk' },
    { id: 3, req: 3, subject: 'Civics', title: 'PDF 3 - Civics', url: 'https://drive.google.com/file/d/1_t7x5irxluEdx7ugxo2lbdLctFss0dWD/view?usp=drivesdk' },
    { id: 4, req: 4, subject: 'History', title: 'PDF 4 - History', url: 'https://drive.google.com/file/d/1AujJJqkmWFl9cFeB4_MsQ9ffU2m40vsB/view?usp=drivesdk' },
    { id: 5, req: 5, subject: 'Maths', title: 'PDF 5 - Maths', url: 'https://drive.google.com/file/d/1bI5Siizo_vqftacfvZ_HR7vY3bDcgzMa/view?usp=drivesdk' },
    { id: 6, req: 6, subject: 'Chemistry', title: 'PDF 6 - Chemistry', url: 'https://drive.google.com/file/d/1O890P8zKHkRk0jmaPp4cxGHvGn-lI8OY/view?usp=drivesdk' },
    { id: 7, req: 7, subject: 'Biology', title: 'PDF 7 - Biology', url: 'https://drive.google.com/file/d/1oP8A7XC6-aPkZCwJLhAF_c2uNqXmdXzp/view?usp=drivesdk' },
    { id: 8, req: 8, subject: 'Sanskrit', title: 'PDF 8 - Sanskrit', url: 'https://drive.google.com/file/d/1X0CZR2AZ33EuEHAhFtzi9wYpsBts6FjB/view?usp=drivesdk' },
    { id: 9, req: 9, subject: 'English', title: 'PDF 9 - English', url: 'https://drive.google.com/file/d/1GSTyzCiPRwcmfGiaFR-NJRBe2El5UVEj/view?usp=drivesdk' }
];

// Firebase Helper Functions
async function getFirebaseData(path) {
    try {
        const res = await axios.get(`${FIREBASE_URL}/${path}.json`);
        return res.data;
    } catch (e) {
        console.error(`Firebase Read Error [${path}]:`, e.message);
        return null;
    }
}

async function setFirebaseData(path, data) {
    try {
        await axios.put(`${FIREBASE_URL}/${path}.json`, data);
        return true;
    } catch (e) {
        console.error(`Firebase Write Error [${path}]:`, e.message);
        return false;
    }
}

async function updateFirebaseData(path, data) {
    try {
        await axios.patch(`${FIREBASE_URL}/${path}.json`, data);
        return true;
    } catch (e) {
        console.error(`Firebase Patch Error [${path}]:`, e.message);
        return false;
    }
}

// Check Channel Membership via Telegram Bot API
async function checkChannelMembership(telegramUserId) {
    try {
        // Send channel ID with negative prefix if integer format required
        let formattedChannelId = CHANNEL_ID;
        if (!formattedChannelId.startsWith('-')) {
            formattedChannelId = `-100${CHANNEL_ID}`;
        }

        const res = await axios.get(`${TELEGRAM_API}/getChatMember`, {
            params: {
                chat_id: formattedChannelId,
                user_id: telegramUserId
            }
        });

        if (res.data && res.data.ok) {
            const status = res.data.result.status;
            return ['creator', 'administrator', 'member'].includes(status);
        }
    } catch (error) {
        console.error('Channel Verification Error:', error.response?.data || error.message);
    }
    return false;
}

// Telegram Message Sending Helper
async function sendMessage(chatId, text, replyMarkup = null) {
    try {
        await axios.post(`${TELEGRAM_API}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: 'HTML',
            reply_markup: replyMarkup
        });
    } catch (e) {
        console.error('Send Message Error:', e.response?.data || e.message);
    }
}

// Verify and Award Referral Credit
async function processReferralVerification(userId) {
    const user = await getFirebaseData(`users/${userId}`);
    if (!user) return { success: false, message: 'User not found' };

    const isMember = await checkChannelMembership(userId);
    if (!isMember) {
        return { success: false, message: 'Telegram channel join karo pehle verification ke liye.' };
    }

    // Update member status
    await updateFirebaseData(`users/${userId}`, { is_channel_member: true });

    // If user has pending referrer and is not yet credited
    if (user.referred_by && !user.referral_credited) {
        const referrerId = user.referred_by;
        
        // Prevent self-referral
        if (referrerId !== String(userId)) {
            const referrer = await getFirebaseData(`users/${referrerId}`);
            if (referrer) {
                const newCount = (referrer.verified_referrals || 0) + 1;
                
                // Award 1 direct referral credit to referrer
                await updateFirebaseData(`users/${referrerId}`, {
                    verified_referrals: newCount,
                    updated_at: new Date().toISOString()
                });

                // Mark current user as referral credited
                await updateFirebaseData(`users/${userId}`, {
                    referral_credited: true
                });

                // Notify Referrer on Telegram
                await sendMessage(
                    referrerId,
                    `🎉 <b>Naya Verified Referral!</b>\n\nAapko 1 direct referral credit mila hai.\nAapke kul verified referrals: <b>${newCount}</b>\n\nDashboard par jaakar dekhein kitne PDFs unlock hue!`
                );
            }
        }
    }

    return { success: true, message: 'Account & Membership verified successfully!' };
}

// Telegram Webhook Endpoint
app.post('/api/telegram/webhook', async (req, res) => {
    // Basic webhook secret check
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (WEBHOOK_SECRET && secretHeader !== WEBHOOK_SECRET) {
        return res.status(403).json({ error: 'Unauthorized webhook request' });
    }

    const { message } = req.body;
    if (!message || !message.from) {
        return res.sendStatus(200);
    }

    const chatId = message.chat.id;
    const userId = String(message.from.id);
    const text = message.text || '';
    const username = message.from.username || '';
    const firstName = message.from.first_name || 'User';

    // Ensure user exists in Firebase
    let user = await getFirebaseData(`users/${userId}`);
    if (!user) {
        user = {
            telegram_id: userId,
            username: username,
            first_name: firstName,
            verified_referrals: 0,
            referral_code: `REF_${userId}`,
            is_channel_member: false,
            referral_credited: false,
            created_at: new Date().toISOString()
        };
        await setFirebaseData(`users/${userId}`, user);
    }

    // Command: /start or /start REFERRAL_CODE
    if (text.startsWith('/start')) {
        const parts = text.split(' ');
        const refCode = parts.length > 1 ? parts[1].trim() : null;

        if (refCode && !user.referred_by && !user.referral_credited) {
            const referrerId = refCode.replace('REF_', '');
            if (referrerId !== userId) {
                await updateFirebaseData(`users/${userId}`, { referred_by: referrerId });
            }
        }

        const replyMarkup = {
            inline_keyboard: [
                [{ text: '📢 Channel Join Karein', url: CHANNEL_URL }],
                [{ text: '🌐 Dashboard Open Karein', url: `${process.env.FRONTEND_URL || 'https://your-app.com'}?user_id=${userId}` }],
                [{ text: '🔄 Verify Membership', callback_data: 'verify_membership' }]
            ]
        };

        const welcomeText = `👋 <b>Namaste ${firstName}!</b>\n\nWelcome to <b>PDF Unlock Platform</b>.\n\n` +
            `📌 <b>Niyam (Rules):</b>\n` +
            `1. Channel join karein: ${CHANNEL_URL}\n` +
            `2. Apne dosto ko apne unique link se invite karein.\n` +
            `3. Har 1 Verified Direct Referral par 1 PDF unlock hoga (Kul 9 PDFs).\n\n` +
            `Aapka Unique Referral Link:\n<code>https://t.me/${BOT_USERNAME}?start=REF_${userId}</code>`;

        await sendMessage(chatId, welcomeText, replyMarkup);
    } 
    // Command: /referral
    else if (text === '/referral') {
        const refLink = `https://t.me/${BOT_USERNAME}?start=REF_${userId}`;
        const refCount = user.verified_referrals || 0;

        const refText = `🔗 <b>Aapka Referral Status:</b>\n\n` +
            `• Direct Verified Referrals: <b>${refCount}</b>\n` +
            `• Unlocked PDFs: <b>${Math.min(refCount, 9)} / 9</b>\n\n` +
            `<b>Aapka Link:</b>\n<code>${refLink}</code>\n\n` +
            `Is link ko dosto ko bhejein aur PDFs unlock karein!`;

        await sendMessage(chatId, refText, {
            inline_keyboard: [
                [{ text: '📲 Share Link', url: `https://t.me/share/url?url=${encodeURIComponent(refLink)}&text=${encodeURIComponent('Join & Unlock 10th BSEB Notes!')}` }]
            ]
        });
    }
    // Command: /status
    else if (text === '/status') {
        const isMember = await checkChannelMembership(userId);
        const refCount = user.verified_referrals || 0;
        
        const statusText = `📊 <b>Aapka Profile Status:</b>\n\n` +
            `• Name: <b>${firstName}</b>\n` +
            `• Username: <b>@${username || 'N/A'}</b>\n` +
            `• Channel Member: <b>${isMember ? '✅ Joined' : '❌ Not Joined'}</b>\n` +
            `• Verified Referrals: <b>${refCount}</b>\n` +
            `• Unlocked PDFs: <b>${Math.min(refCount, 9)}</b>`;

        await sendMessage(chatId, statusText);
    }
    // Command: /help
    else if (text === '/help') {
        const helpText = `❓ <b>Madad Chahiye?</b>\n\n` +
            `• /start - Bot ko restart karein aur link payein\n` +
            `• /referral - Apna referral link aur points dekhein\n` +
            `• /status - Apni account verification check karein\n\n` +
            `<b>Kaise Kam Karta Hai?</b>\n` +
            `1. Channel join karna compulsion hai.\n` +
            `2. Direct refer karne par hi count badhega.\n` +
            `3. Downline (multi-level) ka koi point nahi milega.`;

        await sendMessage(chatId, helpText);
    }

    res.sendStatus(200);
});

// REST API for Frontend Dashboard
app.get('/api/me/dashboard', async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) {
        return res.status(400).json({ error: 'user_id query parameter is required' });
    }

    let user = await getFirebaseData(`users/${userId}`);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const isMember = await checkChannelMembership(userId);
    const verifiedCount = user.verified_referrals || 0;

    // Filter PDFs based on unlock state
    const pdfs = PDF_REWARDS.map(pdf => {
        const isUnlocked = verifiedCount >= pdf.req;
        return {
            id: pdf.id,
            subject: pdf.subject,
            title: pdf.title,
            required_referrals: pdf.req,
            is_unlocked: isUnlocked,
            // Expose Drive link ONLY if unlocked
            download_url: isUnlocked ? pdf.url : null
        };
    });

    res.json({
        user: {
            telegram_id: user.telegram_id,
            username: user.username,
            first_name: user.first_name,
            verified_referrals: verifiedCount,
            unlocked_pdfs_count: Math.min(verifiedCount, 9),
            referral_link: `https://t.me/${BOT_USERNAME}?start=REF_${user.telegram_id}`,
            is_channel_member: isMember
        },
        pdfs: pdfs
    });
});

// Verify Membership API Call from Dashboard
app.post('/api/referrals/verify', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) {
        return res.status(400).json({ error: 'user_id is required' });
    }

    const result = await processReferralVerification(user_id);
    res.json(result);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
