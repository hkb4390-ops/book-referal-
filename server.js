const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// CONFIGURATION
const BOT_TOKEN = 'YOUR_TELEGRAM_BOT_TOKEN'; // @BotFather से प्राप्त करें
const CHANNEL_ID = '@hrbseb10thallcorse'; // आपका चैनल ID
const WEBSITE_URL = 'https://yourwebsite.com'; // आपकी वेबसाइट का URL

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const db = new sqlite3.Database('./database.db');

// Database Setup
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        telegram_id TEXT PRIMARY KEY,
        first_name TEXT,
        referred_by TEXT,
        referral_count INTEGER DEFAULT 0,
        joined_channel INTEGER DEFAULT 0
    )`);
});

// PDF Links Array (1 to 9)
const PDF_LIST = [
    { id: 1, title: "1. Economics (10 Bhramastra)", link: "https://drive.google.com/file/d/1hbKSxeX6SWK0lpSWHo21vNK8l9F5IXJ9/view?usp=drivesdk" },
    { id: 2, title: "2. Physics", link: "https://drive.google.com/file/d/1PN9LaQCaWWCfV7xdNCb8PgC671Fs7hdQ/view?usp=drivesdk" },
    { id: 3, title: "3. Civics", link: "https://drive.google.com/file/d/1_t7x5irxluEdx7ugxo2lbdLctFss0dWD/view?usp=drivesdk" },
    { id: 4, title: "4. History", link: "https://drive.google.com/file/d/1AujJJqkmWFl9cFeB4_MsQ9ffU2m40vsB/view?usp=drivesdk" },
    { id: 5, title: "5. Maths", link: "https://drive.google.com/file/d/1bI5Siizo_vqftacfvZ_HR7vY3bDcgzMa/view?usp=drivesdk" },
    { id: 6, title: "6. Chemistry", link: "https://drive.google.com/file/d/1O890P8zKHkRk0jmaPp4cxGHvGn-lI8OY/view?usp=drivesdk" },
    { id: 7, title: "7. Biology", link: "https://drive.google.com/file/d/1oP8A7XC6-aPkZCwJLhAF_c2uNqXmdXzp/view?usp=drivesdk" },
    { id: 8, title: "8. Sanskrit", link: "https://drive.google.com/file/d/1X0CZR2AZ33EuEHAhFtzi9wYpsBts6FjB/view?usp=drivesdk" },
    { id: 9, title: "9. English", link: "https://drive.google.com/file/d/1GSTyzCiPRwcmfGiaFR-NJRBe2El5UVEj/view?usp=drivesdk" }
];

// 1. TELEGRAM BOT HANDLER
bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = String(msg.from.id);
    const firstName = msg.from.first_name || 'User';
    const referrerId = match[1] ? match[1].replace('ref_', '') : null;

    // Check if user exists
    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId], async (err, user) => {
        if (!user) {
            // Save new user (referred_by handles direct referral track)
            db.run(`INSERT INTO users (telegram_id, first_name, referred_by) VALUES (?, ?, ?)`, 
                [telegramId, firstName, (referrerId && referrerId !== telegramId) ? referrerId : null]);
        }

        // Send Join Channel Verification Button
        const opts = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📢 Join Telegram Channel", url: `https://t.me/hrbseb10thallcorse` }],
                    [{ text: "✅ Verify Membership", callback_data: `verify_${telegramId}` }]
                ]
            }
        };
        bot.sendMessage(chatId, `नमस्ते ${firstName}! PDFs प्राप्त करने के लिए आपको हमारे टेलीग्राम चैनल को जॉइन करना होगा।`, opts);
    });
});

// Verification Callback
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const telegramId = String(query.from.id);

    try {
        const member = await bot.getChatMember(CHANNEL_ID, telegramId);
        if (['member', 'administrator', 'creator'].includes(member.status)) {
            
            // Update User as Joined
            db.get(`SELECT * FROM users WHERE telegram_id = ?`, [telegramId], (err, user) => {
                if (user && user.joined_channel === 0) {
                    db.run(`UPDATE users SET joined_channel = 1 WHERE telegram_id = ?`, [telegramId]);

                    // Credit Referrer
                    if (user.referred_by) {
                        db.run(`UPDATE users SET referral_count = referral_count + 1 WHERE telegram_id = ?`, [user.referred_by], () => {
                            // Notify Referrer on Telegram
                            db.get(`SELECT referral_count FROM users WHERE telegram_id = ?`, [user.referred_by], (e, refUser) => {
                                if (refUser) {
                                    bot.sendMessage(user.referred_by, `🎉 **बधाई हो!** आपके रेफरल से एक नया यूजर जुड़ा है।\n📊 आपका कुल Direct Referrals: **${refUser.referral_count}/9**\n\nअपनी वेबसाइट डैशबोर्ड में नया PDF देखें!`, { parse_mode: 'Markdown' });
                                }
                            });
                        });
                    }
                }
            });

            const dashUrl = `${WEBSITE_URL}?id=${telegramId}`;
            bot.sendMessage(chatId, `✅ **सफलतापूर्वक वेरिफाई हो गया!**\n\nआपकी Telegram Profile Bind हो चुकी है। अब आप सीधे वेबसाइट डैशबोर्ड पर जाकर PDFs अनलॉक कर सकते हैं।`, {
                reply_markup: {
                    inline_keyboard: [[{ text: "🌐 Go to Web Dashboard", url: dashUrl }]]
                },
                parse_mode: 'Markdown'
            });

        } else {
            bot.answerCallbackQuery(query.id, { text: "⚠️ आपने अभी तक चैनल जॉइन नहीं किया है!", show_alert: true });
        }
    } catch (e) {
        bot.answerCallbackQuery(query.id, { text: "त्रुटि! कृपया सुनिश्चित करें कि आप चैनल में जुड़ चुके हैं।", show_alert: true });
    }
});

// 2. WEBSITE API ENDPOINT
app.get('/api/user-data', (req, res) => {
    const { id } = req.query;
    if (!id) return res.status(400).json({ error: "User ID Required" });

    db.get(`SELECT * FROM users WHERE telegram_id = ?`, [id], (err, user) => {
        if (!user || user.joined_channel === 0) {
            return res.status(403).json({ error: "User not verified via Telegram." });
        }

        const refCount = user.referral_count || 0;
        const refLink = `https://t.me/hrrrrrrrrry_bot?start=ref_${user.telegram_id}`;

        const pdfsWithStatus = PDF_LIST.map((pdf, index) => ({
            ...pdf,
            unlocked: refCount >= (index + 1)
        }));

        res.json({
            name: user.first_name,
            telegram_id: user.telegram_id,
            referral_count: refCount,
            referral_link: refLink,
            pdfs: pdfsWithStatus
        });
    });
});

app.listen(3000, () => console.log('Server running on port 3000'));
