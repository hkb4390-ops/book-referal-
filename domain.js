import crypto from "node:crypto";

export const PDFS = [
  { id: "economics", subject: "Economics", driveId: "1hbKSxeX6SWK0lpSWHo21vNK8l9F5IXJ9", required: 1 },
  { id: "physics", subject: "Physics", driveId: "1PN9LaQCaWWCfV7xdNCb8PgC671Fs7hdQ", required: 2 },
  { id: "civics", subject: "Civics", driveId: "1_t7x5irxluEdx7ugxo2lbdLctFss0dWD", required: 3 },
  { id: "history", subject: "History", driveId: "1AujJJqkmWFl9cFeB4_MsQ9ffU2m40vsB", required: 4 },
  { id: "maths", subject: "Maths", driveId: "1bI5Siizo_vqftacfvZ_HR7vY3bDcgzMa", required: 5 },
  { id: "chemistry", subject: "Chemistry", driveId: "1O890P8zKHkRk0jmaPp4cxGHvGn-lI8OY", required: 6 },
  { id: "biology", subject: "Biology", driveId: "1oP8A7XC6-aPkZCwJLhAF_c2uNqXmdXzp", required: 7 },
  { id: "sanskrit", subject: "Sanskrit", driveId: "1X0CZR2AZ33EuEHAhFtzi9wYpsBts6FjB", required: 8 },
  { id: "english", subject: "English", driveId: "1GSTyzCiPRwcmfGiaFR-NJRBe2El5UVEj", required: 9 }
];
export const unlockedCount = n => Math.min(Math.max(0, Math.floor(Number(n) || 0)), 9);
export const tokenHash = token => crypto.createHash("sha256").update(token).digest("hex");
export const makeCode = () => crypto.randomBytes(8).toString("base64url").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,10);
export const isEligibleMember = m => ["creator", "administrator", "member"].includes(m?.status) ||
  (m?.status === "restricted" && m?.is_member === true);
export const safeUser = u => ({
  firstName: u?.firstName || "",
  username: u?.username || null,
  photoUrl: u?.photoUrl || null,
  connected: true,
  membershipStatus: u?.membership?.status || "unknown",
  verifiedDirectReferrals: Number(u?.verifiedDirectReferrals || 0),
  pendingReferrals: Number(u?.pendingReferrals || 0),
  unlockedCount: unlockedCount(u?.verifiedDirectReferrals || 0),
  createdAt: u?.createdAt || null
});
