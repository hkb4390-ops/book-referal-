const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true
}));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'hrrrrrrrrry_bot';
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID || '-1004498096954';
const CHANNEL_URL = process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/hrbseb10thallcorse';
const FIREBASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://hrry-store-default-rtdb.firebaseio.com';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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

async function getFirebaseData(path) {
    try {
        const res = await axios.get(`${FIREBASE_URL}/${path}.json`);
        return res.data;
    } catch (e) { return null; }
}

async function setFirebaseData(path, data) {
    try {
        await axios.put(`${FIREBASE_URL}/${path}.json`, data);
        return true;
    } catch (e) { return false; }
}

async function updateFirebaseData(path, data) {
    try {
        await axios.patch(`${FIREBASE_URL}/${path}.json`, data);
        return true;
    } catch (e) { return false; }
}

async function checkChannelMembership(telegramUserId) {
    try {
        let formattedChannelId = CHANNEL_ID;
        if (!formattedChannelId.startsWith('-')) formattedChannelId = `-100${formattedChannelId}`;
        const res = await axios.get(`${TELEGRAM_API}/getChatMember`, { params: { chat_id: formattedChannelId, user_id: telegramUserId } });
        if (res.data && res.data.ok) {
            return ['creator', 'administrator', 'member'].includes(res.data.result.status);
        }
    } catch (error) {}
    return false;
}

// Telegram Login Hash Verification Middleware/Function
function verifyTelegramLogin(query) {
    const { hash, ...data } = query;
    const checkString = Object.keys(data)
        .sort()
        .map(k => `${k}=${data[k]}`)
        .join('\n');
    
    const secretKey = crypto.createHash('sha256').update(BOT_TOKEN).digest();
    const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');
    
    return hmac === hash;
}

// Telegram Login Callback Endpoint
app.get('/api/auth/telegram/callback', async (req, res) => {
    const query = req.query;
    if (!query.id || !verifyTelegramLogin(query)) {
        return res.status(403).send('Invalid Telegram Authentication');
    }

    const userId = String(query.id);
    const firstName = query.first_name || 'User';
    const username = query.username || '';
    const photoUrl = query.photo_url || '';

    let user = await getFirebaseData(`users/${userId}`);
    if (!user) {
        user = {
            telegram_id: userId,
            username: username,
            first_name: firstName,
            photo_url: photoUrl,
            verified_referrals: 0,
            referral_code: `REF_${userId}`,
            is_channel_member: false,
            referral_credited: false,
            created_at: new Date().toISOString()
        };
        await setFirebaseData(`users/${userId}`, user);
    } else {
        await updateFirebaseData(`users/${userId}`, { first_name: firstName, username, photo_url: photoUrl });
    }

    // Redirect to frontend dashboard with user_id
    const frontendUrl = process.env.FRONTEND_URL || 'https://book-referal.vercel.app';
    res.redirect(`${frontendUrl}?user_id=${userId}`);
});

app.get('/api/me/dashboard', async (req, res) => {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });

    let user = await getFirebaseData(`users/${userId}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const isMember = await checkChannelMembership(userId);
    const verifiedCount = user.verified_referrals || 0;

    const pdfs = PDF_REWARDS.map(pdf => {
        const isUnlocked = verifiedCount >= pdf.req;
        return {
            id: pdf.id,
            subject: pdf.subject,
            title: pdf.title,
            required_referrals: pdf.req,
            is_unlocked: isUnlocked,
            download_url: isUnlocked ? pdf.url : null
        };
    });

    res.json({
        user: {
            telegram_id: user.telegram_id,
            username: user.username,
            first_name: user.first_name,
            photo_url: user.photo_url || '',
            verified_referrals: verifiedCount,
            unlocked_pdfs_count: Math.min(verifiedCount, 9),
            referral_link: `https://t.me/${BOT_USERNAME}?start=REF_${user.telegram_id}`,
            is_channel_member: isMember
        },
        pdfs: pdfs
    });
});

app.post('/api/referrals/verify', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const user = await getFirebaseData(`users/${user_id}`);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isMember = await checkChannelMembership(user_id);
    if (!isMember) {
        return res.json({ success: false, message: 'Pehle Telegram channel join karein!' });
    }

    await updateFirebaseData(`users/${user_id}`, { is_channel_member: true });

    if (user.referred_by && !user.referral_credited) {
        const referrerId = user.referred_by;
        if (referrerId !== String(user_id)) {
            const referrer = await getFirebaseData(`users/${referrerId}`);
            if (referrer) {
                const newCount = (referrer.verified_referrals || 0) + 1;
                await updateFirebaseData(`users/${referrerId}`, { verified_referrals: newCount });
                await updateFirebaseData(`users/${user_id}`, { referral_credited: true });
            }
        }
    }

    res.json({ success: true, message: 'Verification successful!' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
