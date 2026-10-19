import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import TelegramBot from "node-telegram-bot-api";
import admin from "firebase-admin";
import crypto from "node:crypto";
import { PDFS, unlockedCount, tokenHash, makeCode, isEligibleMember, safeUser } from "./domain.js";

const required = ["TELEGRAM_BOT_TOKEN","TELEGRAM_BOT_USERNAME","TELEGRAM_CHANNEL_URL","TELEGRAM_CHANNEL_ID","FIREBASE_SERVICE_ACCOUNT_JSON","FRONTEND_URL","SESSION_SECRET"];
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}
if (process.env.SESSION_SECRET.length < 32) {
  console.error("SESSION_SECRET must be at least 32 characters."); process.exit(1);
}
const FRONTEND_URL = process.env.FRONTEND_URL.replace(/\/$/, "");
const CHANNEL_ID = process.env.TELEGRAM_CHANNEL_ID;
let serviceAccount;
try { serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON); }
catch { console.error("FIREBASE_SERVICE_ACCOUNT_JSON must be valid JSON text."); process.exit(1); }

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://hrry-store-default-rtdb.firebaseio.com/"
  });
}
const db = admin.database();
const app = express();
app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: FRONTEND_URL, credentials: true, methods: ["GET","POST","OPTIONS"], allowedHeaders: ["Content-Type","X-CSRF-Token"] }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
const cookieName = "hrry_session";
const sessionMs = 7 * 24 * 60 * 60 * 1000;
const secureCookie = process.env.NODE_ENV === "production";
const sessions = db.ref("sessions");
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: process.env.BOT_MODE !== "webhook" });

const now = () => Date.now();
const publicUser = async id => (await db.ref(`users/${id}`).get()).val();
async function getSession(req) {
  const raw = req.cookies?.[cookieName];
  if (!raw) return null;
  const [sid, sig] = raw.split(".");
  if (!sid || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(sid).digest("hex");
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const record = (await sessions.child(sid).get()).val();
  if (!record || record.expiresAt < now()) { await sessions.child(sid).remove(); return null; }
  return { sid, telegramId: String(record.telegramId), record };
}
async function requireAuth(req, res, next) {
  try {
    const s = await getSession(req);
    if (!s) return res.status(401).json({ error: "Please bind Telegram to continue.", code: "AUTH_REQUIRED" });
    req.auth = s; next();
  } catch (e) { console.error("auth lookup failed"); res.status(500).json({ error: "Authentication service unavailable." }); }
}
function setSessionCookie(res, sid) {
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(sid).digest("hex");
  res.cookie(cookieName, `${sid}.${sig}`, { httpOnly: true, secure: secureCookie, sameSite: "lax", maxAge: sessionMs, path: "/" });
}
function originGuard(req, res, next) {
  const origin = req.get("origin");
  if (origin && origin.replace(/\/$/,"") !== FRONTEND_URL) return res.status(403).json({ error: "Origin not allowed." });
  next();
}
app.use("/api", originGuard);

app.get("/healthz", (_req,res) => res.json({ ok: true, service: "hrry-telegram-referral", time: new Date().toISOString() }));
app.get("/api/public/config", (_req,res) => res.json({
  botUsername: process.env.TELEGRAM_BOT_USERNAME,
  channelUrl: process.env.TELEGRAM_CHANNEL_URL,
  websiteUrl: FRONTEND_URL,
  pdfs: PDFS.map(p => ({ id:p.id, subject:p.subject, required:p.required }))
}));
app.post("/api/link/start", async (_req,res) => {
  try {
    const token = crypto.randomBytes(32).toString("base64url");
    const hash = tokenHash(token), createdAt = now(), expiresAt = createdAt + 5*60*1000;
    await db.ref(`linkTokens/${hash}`).set({ createdAt, expiresAt, status:"pending" });
    res.json({ token, expiresAt, startUrl:`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=bind_${token}` });
  } catch { res.status(503).json({ error:"Could not start Telegram binding. Please retry." }); }
});
app.get("/api/link/status/:token", async (req,res) => {
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(token)) return res.status(400).json({ error:"Invalid binding token." });
  try {
    const ref = db.ref(`linkTokens/${tokenHash(token)}`), snap = await ref.get(), item = snap.val();
    if (!item) return res.status(404).json({ status:"invalid", error:"Binding request not found." });
    if (item.expiresAt < now() && item.status === "pending") {
      await ref.update({ status:"expired" }); return res.json({ status:"expired" });
    }
    if (item.status === "bound" && item.telegramId) {
      const sid = crypto.randomBytes(32).toString("base64url");
      await sessions.child(sid).set({ telegramId:String(item.telegramId), createdAt:now(), expiresAt:now()+sessionMs });
      await ref.update({ status:"consumed", consumedAt:now() });
      setSessionCookie(res, sid);
      return res.json({ status:"bound", user:safeUser(await publicUser(item.telegramId)) });
    }
    res.json({ status:item.status });
  } catch { res.status(503).json({ error:"Could not check binding status." }); }
});
app.get("/api/auth/session", requireAuth, async (req,res) => res.json({ authenticated:true, user:safeUser(await publicUser(req.auth.telegramId)) }));
app.post("/api/auth/logout", requireAuth, async (req,res) => {
  await sessions.child(req.auth.sid).remove();
  res.clearCookie(cookieName, { httpOnly:true, secure:secureCookie, sameSite:"lax", path:"/" });
  res.json({ ok:true });
});
app.get("/api/me", requireAuth, async (req,res) => res.json({ user:safeUser(await publicUser(req.auth.telegramId)) }));
app.get("/api/me/dashboard", requireAuth, async (req,res) => {
  try {
    const id=req.auth.telegramId, u=await publicUser(id);
    if (!u) return res.status(404).json({error:"Account was not found."});
    const [refsSnap, memSnap] = await Promise.all([
      db.ref("referrals").orderByChild("referrerId").equalTo(id).get(),
      db.ref(`channelMemberships/${id}`).get()
    ]);
    const refs=Object.values(refsSnap.val()||{}).map(r=>({
      status:r.status, username:r.username||null, firstName:r.firstName||"Telegram user",
      joinedAt:r.createdAt||null, verifiedAt:r.verifiedAt||null
    }));
    const count=unlockedCount(u.verifiedDirectReferrals||0);
    res.json({ user:safeUser({...u,membership:memSnap.val()||u.membership}), referralLink:`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${u.referralCode}`,
      referrals:refs, pdfs:PDFS.map((p,i)=>({id:p.id,subject:p.subject,required:p.required,unlocked:i<count})),
      activity:(u.activity||[]).slice(-20).reverse() });
  } catch { res.status(503).json({error:"Dashboard temporarily unavailable."}); }
});
app.get("/api/me/referral-link", requireAuth, async (req,res) => {
  const u=await publicUser(req.auth.telegramId);
  if (!u?.referralCode) return res.status(404).json({error:"Referral link unavailable."});
  res.json({ referralLink:`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${u.referralCode}` });
});
app.get("/api/me/referrals", requireAuth, async (req,res) => {
  const snap=await db.ref("referrals").orderByChild("referrerId").equalTo(req.auth.telegramId).get();
  res.json({ referrals:Object.values(snap.val()||{}).map(r=>({status:r.status,username:r.username||null,firstName:r.firstName||"Telegram user",joinedAt:r.createdAt||null,verifiedAt:r.verifiedAt||null})) });
});
app.get("/api/me/membership", requireAuth, async (req,res) => {
  res.json({membership:(await db.ref(`channelMemberships/${req.auth.telegramId}`).get()).val()||{status:"unknown"}});
});
app.post("/api/me/membership/verify", requireAuth, async (req,res) => {
  try {
    const id=req.auth.telegramId;
    const m=await bot.getChatMember(CHANNEL_ID, Number(id));
    const result={status:m.status, eligible:isEligibleMember(m), checkedAt:now()};
    await db.ref(`channelMemberships/${id}`).set(result);
    await db.ref(`users/${id}/membership`).set(result);
    res.json({membership:result});
  } catch (e) {
    console.error("Telegram membership check failed; verify channel ID and bot admin access.");
    res.status(503).json({error:"Telegram could not verify membership. Confirm the channel ID and that the bot is a channel administrator, then retry."});
  }
});
app.get("/api/me/pdfs", requireAuth, async (req,res) => {
  const u=await publicUser(req.auth.telegramId), n=unlockedCount(u?.verifiedDirectReferrals||0);
  res.json({pdfs:PDFS.map((p,i)=>({id:p.id,subject:p.subject,required:p.required,unlocked:i<n}))});
});
app.get("/api/me/pdfs/:id/access", requireAuth, async (req,res) => {
  const index=PDFS.findIndex(p=>p.id===req.params.id);
  if(index<0) return res.status(404).json({error:"PDF not found."});
  const u=await publicUser(req.auth.telegramId);
  if(index>=unlockedCount(u?.verifiedDirectReferrals||0)) return res.status(403).json({error:"This PDF is locked. Verify more direct referrals to unlock it."});
  res.json({url:`https://drive.google.com/uc?export=download&id=${PDFS[index].driveId}`,subject:PDFS[index].subject,warning:"Drive sharing permissions may allow this file to be shared outside this website."});
});

async function ensureUser(from) {
  const id=String(from.id), ref=db.ref(`users/${id}`), snap=await ref.get();
  if (snap.exists()) {
    await ref.update({ firstName:from.first_name||"", username:from.username||null, lastSeenAt:now() });
    return { ...(snap.val()), firstName:from.first_name||"", username:from.username||null };
  }
  let code;
  for(let i=0;i<5;i++){ code=makeCode(); if(!(await db.ref(`referralCodes/${code}`).get()).exists()) break; }
  const user={ telegramId:id, firstName:from.first_name||"", username:from.username||null, referralCode:code,
    verifiedDirectReferrals:0,pendingReferrals:0,createdAt:now(),lastSeenAt:now(),membership:{status:"unknown"},activity:[{type:"registered",at:now()}] };
  await ref.transaction(current => current || user);
  const actual=(await ref.get()).val();
  await db.ref(`referralCodes/${actual.referralCode}`).set(id);
  return actual;
}
async function checkMember(id) {
  const m=await bot.getChatMember(CHANNEL_ID, Number(id));
  const result={status:m.status,eligible:isEligibleMember(m),checkedAt:now()};
  await db.ref(`channelMemberships/${id}`).set(result);
  await db.ref(`users/${id}/membership`).set(result);
  return result;
}
async function processReferral(newUserId, code) {
  const codeSnap=await db.ref(`referralCodes/${code}`).get();
  if(!codeSnap.exists()) return;
  const referrerId=String(codeSnap.val());
  if(referrerId===String(newUserId)) return;
  const recordRef=db.ref(`referrals/${newUserId}`);
  const tx=await recordRef.transaction(current => current || {
    referrerId, referredId:String(newUserId), status:"PENDING", createdAt:now(), verifiedAt:null
  });
  // First attribution wins. Existing pending attribution may be rechecked, but never replaced.
  const attribution = tx.snapshot.val();
  if(!attribution || attribution.referrerId!==referrerId) return;
  if(tx.committed && attribution.status === "PENDING") {
    const userBefore = await publicUser(newUserId);
    if(!userBefore?.referralCredited && !attribution.pendingCounted) {
      await recordRef.update({pendingCounted:true});
      await db.ref(`users/${referrerId}/pendingReferrals`).transaction(n=>(Number(n)||0)+1);
    }
  }
  try {
    const member=await checkMember(newUserId);
    if(!member.eligible) return;
    const user=await publicUser(newUserId);
    if(user?.referralCredited) return;
    const creditRef=db.ref(`users/${referrerId}`);
    // Atomic transaction prevents two referrals concurrently overwriting each other.
    const creditTx=await creditRef.transaction(current => {
      if(!current) return;
      const existing=current.creditedReferralIds||{};
      if(existing[String(newUserId)]) return;
      current.creditedReferralIds={...existing,[String(newUserId)]:true};
      current.verifiedDirectReferrals=Object.keys(current.creditedReferralIds).length;
      current.pendingReferrals=Math.max(0,Number(current.pendingReferrals||0)-1);
      current.activity=[...(current.activity||[]),{type:"referral_verified",at:now()}].slice(-30);
      return current;
    });
    if(creditTx.committed) {
      await recordRef.update({status:"VERIFIED",verifiedAt:now()});
      await db.ref(`users/${newUserId}`).update({referralCredited:true});
      await bot.sendMessage(referrerId,`🎉 Your direct referral is verified! You now have ${unlockedCount(creditTx.snapshot.val().verifiedDirectReferrals)} PDF(s) unlocked.`,{});
      await notifyNewUnlocks(referrerId, Number(creditTx.snapshot.val().verifiedDirectReferrals||0));
    }
  } catch (e) { console.error("Referral verification failed; record remains pending."); }
}
async function notifyNewUnlocks(userId, count) {
  for(const p of PDFS.slice(0,unlockedCount(count))) {
    const marker=db.ref(`users/${userId}/notifiedPdfs/${p.id}`);
    const tx=await marker.transaction(v=>v||now());
    if(tx.committed) {
      try { await bot.sendMessage(userId,`📘 Unlocked: ${p.subject}\nhttps://drive.google.com/uc?export=download&id=${p.driveId}`); }
      catch { await marker.remove(); }
    }
  }
}
const keyboard = [
  [{text:"🌐 Open Website",url:FRONTEND_URL},{text:"📢 Join Channel",url:process.env.TELEGRAM_CHANNEL_URL}],
  [{text:"🔗 My Referral",callback_data:"referral"},{text:"📚 My PDFs",callback_data:"pdfs"}]
];
async function processUpdate(update) {
  const updateRef=db.ref(`processedUpdates/${update.update_id}`);
  const tx=await updateRef.transaction(v=>v||{at:now()});
  if(!tx.committed) return;
  const msg=update.message;
  if(!msg?.from || !msg.text) return;
  const from=msg.from, chatId=msg.chat.id, text=msg.text.trim();
  try {
    if(text.startsWith("/start")) {
      const payload=text.split(/\s+/)[1]||"";
      if(payload.startsWith("bind_")) {
        const token=payload.slice(5), hash=tokenHash(token), ref=db.ref(`linkTokens/${hash}`);
        const linkTx=await ref.transaction(v=>{
          if(!v || v.status!=="pending" || v.expiresAt<now()) return;
          return {...v,status:"bound",telegramId:String(from.id),boundAt:now()};
        });
        if(linkTx.committed) {
          await ensureUser(from);
          await bot.sendMessage(chatId,"✅ Telegram account verified. Return to the website; it will finish connecting your account.");
        } else await bot.sendMessage(chatId,"This binding link is expired or already used. Return to the website and start again.");
        return;
      }
      const user=await ensureUser(from);
      if(payload && /^[A-Z0-9]{6,16}$/.test(payload)) {
        await processReferral(user.telegramId,payload);
      }
      await bot.sendMessage(chatId,`Welcome ${from.first_name||"there"}!\\n\\nJoin the channel, then use /status to check your progress. Invite friends with /referral; each verified direct referral unlocks one PDF.`,{reply_markup:{inline_keyboard:keyboard}});
      return;
    }
    if(text.startsWith("/help")) return bot.sendMessage(chatId,"Commands: /start, /help, /status, /referral, /profile, /pdfs. Join the channel and invite direct referrals to unlock PDFs.");
    const user=await ensureUser(from);
    if(text.startsWith("/referral")) return bot.sendMessage(chatId,`Your referral link:\\nhttps://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${user.referralCode}`);
    if(text.startsWith("/profile")) return bot.sendMessage(chatId,`Name: ${user.firstName}\\nUsername: ${user.username?`@${user.username}`:"not available"}\\nTelegram ID: ${user.telegramId}`);
    if(text.startsWith("/status")) {
      let membership; try { membership=await checkMember(user.telegramId); } catch { membership={status:"unknown",eligible:false}; }
      const fresh=await publicUser(user.telegramId);
      return bot.sendMessage(chatId,`Account: registered\\nChannel: ${membership.eligible?"verified":membership.status}\\nVerified direct referrals: ${fresh.verifiedDirectReferrals||0}\\nPDFs unlocked: ${unlockedCount(fresh.verifiedDirectReferrals||0)}\\n${`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${fresh.referralCode}`}`);
    }
    if(text.startsWith("/pdfs")) {
      const n=unlockedCount(user.verifiedDirectReferrals||0);
      return bot.sendMessage(chatId,PDFS.map((p,i)=>`${i<n?"🔓":"🔒"} ${p.subject}${i<n?`\nhttps://drive.google.com/uc?export=download&id=${p.driveId}`:` — needs ${p.required} verified direct referrals`}`).join("\n\n"));
    }
  } catch { console.error("Telegram update handler failed."); }
}
bot.on("message", msg => processUpdate({update_id:`${msg.chat.id}_${msg.message_id}`, message:msg}).catch(()=>console.error("Bot message failed.")));
bot.on("polling_error", () => console.error("Telegram polling error; check token/network and ensure only one poller."));
bot.on("callback_query", async q => {
  try {
    if(q.data==="referral") {
      const u=await publicUser(q.from.id);
      await bot.sendMessage(q.message.chat.id,`https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${u.referralCode}`);
    } else if(q.data==="pdfs") {
      const u=await publicUser(q.from.id), n=unlockedCount(u?.verifiedDirectReferrals||0);
      await bot.sendMessage(q.message.chat.id,PDFS.slice(0,n).map(p=>`${p.subject}: https://drive.google.com/uc?export=download&id=${p.driveId}`).join("\n")||"No PDFs unlocked yet. Invite direct referrals.");
    }
    await bot.answerCallbackQuery(q.id);
  } catch { try { await bot.answerCallbackQuery(q.id,{text:"Please try again."}); } catch {} }
});
const port=Number(process.env.PORT||3000);
app.listen(port,()=>console.log(`Backend listening on ${port}`));
