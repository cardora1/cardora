require("dotenv").config();

const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const { OAuth2Client } = require("google-auth-library");
const app = express();
const PORT = Number(process.env.PORT || 3000);
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);
const dir = path.join(__dirname, "data");
const file = path.join(dir, "db.json");

fs.mkdirSync(dir, { recursive: true });

const SELLER_PAYOUT_PERCENT = Number(process.env.SELLER_PAYOUT_PERCENT || 78);
const BUYER_FEE_PERCENT = Number(process.env.BUYER_FEE_PERCENT || 3);
const BUYER_FIXED_FEE = Number(process.env.BUYER_FIXED_FEE || 0.50);
const APP_SECRET = process.env.APP_SECRET || "CHANGE_THIS_APP_SECRET";
const ENCRYPTION_KEY = crypto.createHash("sha256").update(APP_SECRET).digest();

const WALLETS = {
  "USDT_TRON": {
    label: "USDT — TRON (TRC-20)",
    symbol: "USDT",
    network: "TRON (TRC-20)",
    address: process.env.USDT_TRC20_ADDRESS || "TAe4joBirPdMf3injMPXqFmgr7Bp6vAqni"
  },
  "USDC_SOLANA": {
    label: "USDC — Solana (SPL)",
    symbol: "USDC",
    network: "Solana (SPL)",
    address: process.env.USDC_SOLANA_ADDRESS || "8WbXz2i6GvKZzpQsmBtAXDVd58ESupZw7Q3tevSeHRCP"
  },
  "SOL": {
    label: "SOL — Solana",
    symbol: "SOL",
    network: "Solana",
    address: process.env.SOL_ADDRESS || "8WbXz2i6GvKZzpQsmBtAXDVd58ESupZw7Q3tevSeHRCP"
  },
  "BTC": {
    label: "BTC — Bitcoin",
    symbol: "BTC",
    network: "Bitcoin",
    address: process.env.BTC_ADDRESS || "bc1qq5a9qz2tcz8g77ydj3puxkg2fug49ust2qahyj"
  },
  "ETH": {
    label: "ETH — Ethereum",
    symbol: "ETH",
    network: "Ethereum",
    address: process.env.ETH_ADDRESS || "0x1D73944aCB4aB0C3Acb7817C5C9c8D05Ca1B6824"
  }
};

const cards = [
  { brand:"Apple", range:"$10 - $200" },
  { brand:"Amazon", range:"$10 - $200" },
  { brand:"Walmart", range:"$10 - $200" },
  { brand:"Google Play", range:"$10 - $100" },
  { brand:"Steam", range:"$10 - $100" },
  { brand:"Visa", range:"$25 - $500" },
  { brand:"Netflix", range:"$15 - $100" },
  { brand:"Spotify", range:"$10 - $100" },
  { brand:"Xbox", range:"$10 - $100" },
  { brand:"PlayStation", range:"$10 - $200" },
  { brand:"Target", range:"$10 - $200" },
  { brand:"eBay", range:"$10 - $200" },
  { brand:"Uber", range:"$10 - $200" },
  { brand:"Airbnb", range:"$25 - $500" },
  { brand:"Nike", range:"$10 - $250" },
  { brand:"Roblox", range:"$10 - $100" },
  { brand:"Discord", range:"$10 - $100" }
];

function legacyHashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function hashPassword(password) {
  return crypto.scryptSync(String(password), APP_SECRET, 64).toString("hex");
}

function verifyAndUpgradePassword(user, password) {
  const plain = String(password);
  const modern = hashPassword(plain);
  if (user.password === modern) return true;

  // Compatibility with the original Cardora demo server.
  // If an old SHA-256 password matches, upgrade it immediately.
  if (user.password === legacyHashPassword(plain)) {
    user.password = modern;
    save();
    return true;
  }

  return false;
}

function randomCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function randomToken() {
  return crypto.randomBytes(32).toString("hex");
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map(x => x.toString("base64url")).join(".");
}

function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    ENCRYPTION_KEY,
    Buffer.from(ivB64, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function load() {
  if (!fs.existsSync(file)) {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@cardora.local";
    const adminPassword = process.env.ADMIN_PASSWORD || "ChangeThisAdminPassword";
    fs.writeFileSync(file, JSON.stringify({
      users: [{
        id: "admin",
        email: adminEmail.toLowerCase(),
        password: hashPassword(adminPassword),
        verified: true,
        role: "admin"
      }],
      vouchers: [],
      orders: []
    }, null, 2));
  }

  const db = JSON.parse(fs.readFileSync(file, "utf8"));
  db.users ||= [];
  db.vouchers ||= [];
  db.orders ||= [];
  return db;
}

function save() {
  const temp = file + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(db, null, 2));
  fs.renameSync(temp, file);
}

let db = load();

const sessions = new Map();

const smtpReady =
  process.env.EMAIL_HOST &&
  process.env.EMAIL_USER &&
  process.env.EMAIL_PASS;

const transporter = smtpReady
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: String(process.env.EMAIL_SECURE || "false") === "true",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    })
  : null;

async function sendVerificationEmail(email, code) {
  if (!transporter) {
    console.log(`[DEMO EMAIL] Verification code for ${email}: ${code}`);
    return { demo: true };
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: "Your Cardora verification code",
    text: `Your Cardora verification code is ${code}. It expires in 10 minutes.`
  });

  return { demo: false };
}

async function sendPasswordResetEmail(email, code) {
  if (!transporter) {
    console.log(`[DEMO EMAIL] Password reset code for ${email}: ${code}`);
    return { demo: true };
  }

  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
    to: email,
    subject: "Reset your Cardora password",
    text: `Your Cardora password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`
  });

  return { demo: false };
}

function publicUser(user, token) {
  return {
    id: user.id,
    email: user.email,
    verified: Boolean(user.verified),
    role: user.role || "buyer",
    token
  };
}

function requireUser(req, res, next) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ error: "Please sign in again." });
  }

  const user = db.users.find(u => u.id === session.userId);
  if (!user || !user.verified) {
    return res.status(401).json({ error: "Verified sign-in is required." });
  }

  req.user = user;
  req.token = token;
  next();
}

function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required." });
    }
    next();
  });
}

function cleanAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000) return null;
  return Math.round(amount * 100) / 100;
}

function cardExists(brand) {
  return cards.some(c => c.brand.toLowerCase() === String(brand).trim().toLowerCase());
}

// Allow GitHub Pages frontend to call the Render API
app.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowedOrigins = [
    "https://cardora1.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization"
    );
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: "100kb" }));
app.use(express.static(__dirname));

app.get("/api/cards", (req, res) => res.json(cards));

app.get("/api/payment-options", (req, res) => {
  res.json({ options: Object.entries(WALLETS).map(([key, x]) => ({ key, ...x })) });
});

app.post("/api/signup", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (db.users.some(u => u.email === email)) {
    return res.status(409).json({ error: "Account already exists. Sign in instead." });
  }

  const code = randomCode();
  const user = {
    id: crypto.randomUUID(),
    email,
    password: hashPassword(password),
    verified: false,
    verificationCode: hashPassword(code),
    verificationExpiresAt: Date.now() + 10 * 60 * 1000,
    role: "buyer"
  };

  db.users.push(user);
  save();

  try {
    await sendVerificationEmail(email, code);
  } catch (err) {
    db.users = db.users.filter(u => u.id !== user.id);
    save();
    console.error("Email send failed:", err.message);
    return res.status(502).json({ error: "We could not send the verification email. Check your email settings." });
  }

  res.json({
    message: "Account created. Check your email for the 6-digit verification code.",
    user: { email, verified: false }
  });
});

app.post("/api/resend-code", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = db.users.find(u => u.email === email);

  if (!user) return res.status(404).json({ error: "Account not found." });
  if (user.verified) return res.json({ message: "Email is already verified." });

  const code = randomCode();
  user.verificationCode = hashPassword(code);
  user.verificationExpiresAt = Date.now() + 10 * 60 * 1000;
  save();

  try {
    await sendVerificationEmail(email, code);
    res.json({ message: "A new verification code was sent." });
  } catch (err) {
    console.error("Email send failed:", err.message);
    res.status(502).json({ error: "Could not send the verification email." });
  }
});

app.post("/api/verify", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  const user = db.users.find(u => u.email === email);

  if (!user || user.verified) {
    return res.status(400).json({ error: "Invalid verification request." });
  }
  if (!user.verificationExpiresAt || user.verificationExpiresAt < Date.now()) {
    return res.status(400).json({ error: "That code has expired. Request a new code." });
  }
  if (hashPassword(code) !== user.verificationCode) {
    return res.status(400).json({ error: "Invalid verification code." });
  }

  user.verified = true;
  delete user.verificationCode;
  delete user.verificationExpiresAt;
  save();

  const token = randomToken();
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });

  res.json({ message: "Email verified. You're signed in!", user: publicUser(user, token) });
});

app.post("/api/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  const user = db.users.find(u => u.email === email && u.role !== "admin");
  // Do not reveal whether an account exists.
  if (!user) {
    return res.json({ message: "If that email has a Cardora account, a reset code has been sent." });
  }

  const code = randomCode();
  user.resetCode = hashPassword(code);
  user.resetExpiresAt = Date.now() + 10 * 60 * 1000;
  user.resetAttempts = 0;
  save();

  try {
    await sendPasswordResetEmail(email, code);
    res.json({ message: "If that email has a Cardora account, a reset code has been sent." });
  } catch (err) {
    delete user.resetCode;
    delete user.resetExpiresAt;
    delete user.resetAttempts;
    save();
    console.error("Password reset email failed:", err.message);
    res.status(502).json({ error: "We could not send the password reset email. Check your email settings." });
  }
});

app.post("/api/reset-password", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  const newPassword = String(req.body.password || "");
  const user = db.users.find(u => u.email === email && u.role !== "admin");

  if (!user || !user.resetCode || !user.resetExpiresAt) {
    return res.status(400).json({ error: "Invalid or expired reset request." });
  }
  if (user.resetExpiresAt < Date.now()) {
    delete user.resetCode;
    delete user.resetExpiresAt;
    delete user.resetAttempts;
    save();
    return res.status(400).json({ error: "That reset code has expired. Request a new one." });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }
  if (!/^\d{6}$/.test(code) || hashPassword(code) !== user.resetCode) {
    user.resetAttempts = Number(user.resetAttempts || 0) + 1;
    if (user.resetAttempts >= 5) {
      delete user.resetCode;
      delete user.resetExpiresAt;
      delete user.resetAttempts;
      save();
      return res.status(429).json({ error: "Too many incorrect codes. Request a new reset code." });
    }
    save();
    return res.status(400).json({ error: "Invalid reset code." });
  }

  user.password = hashPassword(newPassword);
  delete user.resetCode;
  delete user.resetExpiresAt;
  delete user.resetAttempts;
  save();

  // Invalidate any existing sessions for this user after a password reset.
  for (const [token, session] of sessions.entries()) {
    if (session.userId === user.id) sessions.delete(token);
  }

  res.json({ message: "Password reset successfully. You can now sign in with your new password." });
});

app.post("/api/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.users.find(u => u.email === email);

 if (!user || !user.password || !verifyAndUpgradePassword(user, password)) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }
  if (!user.verified) {
    return res.status(403).json({ error: "Please verify your email first." });
  }

  const token = randomToken();
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });

  res.json({ message: "Signed in.", user: publicUser(user, token) });
});

app.post("/api/google-login", async (req, res) => {
  try {
    const { credential } = req.body || {};

    if (!credential) {
      return res.status(400).json({ error: "Google credential is required." });
    }

    if (!GOOGLE_CLIENT_ID) {
      return res.status(500).json({ error: "Google login is not configured." });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();

    if (!payload?.email || !payload.email_verified) {
      return res.status(401).json({ error: "Google email could not be verified." });
    }

    const email = String(payload.email).trim().toLowerCase();

    if (email === ADMIN_EMAIL.toLowerCase()) {
      return res.status(403).json({ error: "Admin account cannot use Google login." });
    }

    let user = users.find(
      (u) => String(u.email || "").toLowerCase() === email
    );

    if (!user) {
      user = {
        id: crypto.randomUUID(),
        email,
        password: null,
        verified: true,
        role: "buyer",
        authProvider: "google",
        googleSub: payload.sub,
        createdAt: new Date().toISOString()
      };

      users.push(user);
      saveUsers();
    } else {
      user.verified = true;
      user.googleSub = user.googleSub || payload.sub;
      saveUsers();
    }

    const token = crypto.randomBytes(32).toString("hex");

    sessions.set(token, {
      userId: user.id,
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      message: "Signed in with Google.",
      user: publicUser(user, token)
    });
  } catch (error) {
    console.error("Google login error:", error);
    res.status(401).json({ error: "Google sign-in failed." });
  }
});

app.post("/api/logout", requireUser, (req, res) => {
  sessions.delete(req.token);
  res.json({ message: "Signed out." });
});

app.get("/api/me", requireUser, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

app.post("/api/sell", requireUser, (req, res) => {
  const brand = String(req.body.brand || "").trim();
  const amount = cleanAmount(req.body.amount);
  const code = String(req.body.code || "").trim();
  const payoutMethod = String(req.body.payoutMethod || "").trim();
  const wallet = String(req.body.wallet || "").trim();

  if (!brand || !amount || !code || !payoutMethod || !wallet) {
    return res.status(400).json({ error: "Complete all seller fields." });
  }
  if (!cardExists(brand)) return res.status(400).json({ error: "Unsupported voucher brand." });
  if (!["Bitcoin (BTC)", "Ethereum (ETH)", "USDT", "USDC"].includes(payoutMethod)) {
    return res.status(400).json({ error: "Choose a supported crypto payout." });
  }

  const payout = Math.round(amount * SELLER_PAYOUT_PERCENT) / 100;
  const commission = Math.round((amount - payout) * 100) / 100;

  const voucher = {
    id: crypto.randomUUID(),
    submissionId: "CD-" + crypto.randomBytes(5).toString("hex").toUpperCase(),
    sellerUserId: req.user.id,
    sellerEmail: req.user.email,
    brand,
    amount,
    payoutMethod,
    wallet,
    payoutPercent: SELLER_PAYOUT_PERCENT,
    payoutAmount: payout,
    commissionAmount: commission,
    encryptedCode: encrypt(code),
    status: "pending_review",
    createdAt: new Date().toISOString()
  };

  db.vouchers.push(voucher);
  save();

  res.json({
    message: "Voucher submitted for review.",
    submission: {
      id: voucher.id,
      submissionId: voucher.submissionId,
      brand,
      amount,
      payoutMethod,
      payoutAmount: payout,
      commissionAmount: commission,
      status: voucher.status,
      createdAt: voucher.createdAt
    }
  });
});

app.get("/api/my-sales", requireUser, (req, res) => {
  const sales = db.vouchers
    .filter(v => v.sellerUserId === req.user.id)
    .map(v => ({
      id: v.submissionId,
      brand: v.brand,
      amount: v.amount,
      status: v.status,
      payoutMethod: v.payoutMethod,
      payoutAmount: v.payoutAmount,
      commissionAmount: v.commissionAmount,
      createdAt: v.createdAt
    }));

  res.json({ sales });
});

app.post("/api/orders", requireUser, (req, res) => {
  const brand = String(req.body.brand || "").trim();
  const amount = cleanAmount(req.body.amount);

  if (!brand || !amount) return res.status(400).json({ error: "Enter a valid voucher and amount." });
  if (!cardExists(brand)) return res.status(400).json({ error: "Unsupported voucher brand." });

  const fee = Math.round((amount * BUYER_FEE_PERCENT / 100 + BUYER_FIXED_FEE) * 100) / 100;
  const total = Math.round((amount + fee) * 100) / 100;

  const order = {
    id: "ORD-" + crypto.randomBytes(6).toString("hex").toUpperCase(),
    buyerUserId: req.user.id,
    buyerEmail: req.user.email,
    brand,
    faceValue: amount,
    buyerFee: fee,
    totalUsd: total,
    crypto: null,
    walletAddress: null,
    paymentNetwork: null,
    paymentStatus: "awaiting_payment",
    status: "awaiting_payment",
    assignedVoucherId: null,
    txHash: null,
    createdAt: new Date().toISOString()
  };

  db.orders.push(order);
  save();

  res.json({
    message: "Order created.",
    order: {
      id: order.id,
      brand: order.brand,
      faceValue: order.faceValue,
      buyerFee: order.buyerFee,
      totalUsd: order.totalUsd,
      status: order.status
    }
  });
});

app.post("/api/orders/:id/payment", requireUser, (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id && o.buyerUserId === req.user.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  const key = String(req.body.crypto || "").trim();
  const txHash = String(req.body.txHash || "").trim();

  if (!WALLETS[key]) return res.status(400).json({ error: "Choose a supported cryptocurrency." });
  if (!txHash || txHash.length < 8 || txHash.length > 200) {
    return res.status(400).json({ error: "Enter the transaction hash after payment." });
  }

  const wallet = WALLETS[key];
  order.crypto = wallet.symbol;
  order.paymentNetwork = wallet.network;
  order.walletAddress = wallet.address;
  order.txHash = txHash;
  order.paymentStatus = "payment_submitted";
  order.status = "payment_submitted";
  order.paymentSubmittedAt = new Date().toISOString();
  save();

  res.json({
    message: "Payment submitted for verification.",
    order: {
      id: order.id,
      crypto: wallet.symbol,
      network: wallet.network,
      address: wallet.address,
      txHash: order.txHash,
      totalUsd: order.totalUsd,
      status: order.status
    }
  });
});

app.get("/api/my-orders", requireUser, (req, res) => {
  const orders = db.orders
    .filter(o => o.buyerUserId === req.user.id)
    .map(o => ({
      id: o.id,
      brand: o.brand,
      faceValue: o.faceValue,
      buyerFee: o.buyerFee,
      totalUsd: o.totalUsd,
      crypto: o.crypto,
      paymentNetwork: o.paymentNetwork,
      paymentStatus: o.paymentStatus,
      status: o.status,
      txHash: o.txHash,
      delivered: o.status === "delivered",
      createdAt: o.createdAt
    }));

  res.json({ orders });
});

app.get("/api/my-orders/:id", requireUser, (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id && o.buyerUserId === req.user.id);
  if (!order) return res.status(404).json({ error: "Order not found." });

  const result = {
    id: order.id,
    brand: order.brand,
    faceValue: order.faceValue,
    buyerFee: order.buyerFee,
    totalUsd: order.totalUsd,
    crypto: order.crypto,
    paymentNetwork: order.paymentNetwork,
    paymentStatus: order.paymentStatus,
    status: order.status,
    txHash: order.txHash,
    createdAt: order.createdAt
  };

  if (order.status === "delivered" && order.assignedVoucherId) {
    const voucher = db.vouchers.find(v => v.id === order.assignedVoucherId);
    if (voucher) {
      result.voucherCode = decrypt(voucher.encryptedCode);
    }
  }

  res.json({ order: result });
});

app.post("/api/admin/login", (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.users.find(u => u.email === email && u.role === "admin");

  if (!user || !verifyAndUpgradePassword(user, password)) {
    return res.status(401).json({ error: "Incorrect admin email or password." });
  }

  user.verified = true;
  const token = randomToken();
  sessions.set(token, { userId: user.id, expiresAt: Date.now() + 8 * 60 * 60 * 1000 });

  res.json({ message: "Admin signed in.", user: publicUser(user, token) });
});

app.post("/api/admin/vouchers/manual", requireAdmin, (req, res) => {
  const brand = String(req.body.brand || "").trim();
  const amount = cleanAmount(req.body.amount);
  const code = String(req.body.code || "").trim();

  if (!brand || !amount || !code) {
    return res.status(400).json({ error: "Enter the brand, value and voucher code." });
  }
  if (!cardExists(brand)) {
    return res.status(400).json({ error: "Unsupported voucher brand." });
  }

  // Prevent the same voucher code from being added twice.
  for (const existing of db.vouchers) {
    try {
      if (decrypt(existing.encryptedCode).trim() === code) {
        return res.status(409).json({ error: "That voucher code is already in Cardora inventory." });
      }
    } catch (_) {}
  }

  const voucher = {
    id: crypto.randomUUID(),
    submissionId: "CD-MAN-" + crypto.randomBytes(5).toString("hex").toUpperCase(),
    sellerUserId: null,
    sellerEmail: "Cardora",
    source: "manual",
    brand,
    amount,
    payoutMethod: "",
    wallet: "",
    payoutPercent: 0,
    payoutAmount: 0,
    commissionAmount: 0,
    encryptedCode: encrypt(code),
    status: "approved",
    createdAt: new Date().toISOString(),
    approvedAt: new Date().toISOString(),
    addedByAdmin: req.user.id
  };

  db.vouchers.push(voucher);
  save();

  res.json({
    message: "Gift card added to inventory.",
    voucher: {
      id: voucher.id,
      submissionId: voucher.submissionId,
      brand: voucher.brand,
      amount: voucher.amount,
      status: voucher.status
    }
  });
});

app.get("/api/admin/vouchers", requireAdmin, (req, res) => {
  res.json({
    vouchers: db.vouchers.map(v => ({
      id: v.id,
      submissionId: v.submissionId,
      sellerEmail: v.sellerEmail,
      brand: v.brand,
      amount: v.amount,
      payoutAmount: v.payoutAmount,
      payoutMethod: v.payoutMethod,
      wallet: v.wallet,
      source: v.source || "seller",
      status: v.status,
      createdAt: v.createdAt
    }))
  });
});

app.get("/api/admin/vouchers/:id/code", requireAdmin, (req, res) => {
  const voucher = db.vouchers.find(v => v.id === req.params.id);
  if (!voucher) return res.status(404).json({ error: "Voucher not found." });

  try {
    res.json({ submissionId: voucher.submissionId, code: decrypt(voucher.encryptedCode) });
  } catch {
    res.status(500).json({ error: "Voucher code could not be decrypted." });
  }
});

app.post("/api/admin/vouchers/:id", requireAdmin, (req, res) => {
  const voucher = db.vouchers.find(v => v.id === req.params.id);
  if (!voucher) return res.status(404).json({ error: "Voucher not found." });

  const status = String(req.body.status || "");
  if (!["approved", "rejected"].includes(status)) {
    return res.status(400).json({ error: "Invalid status." });
  }

  voucher.status = status;
  voucher.reviewedAt = new Date().toISOString();
  save();

  res.json({ message: `Voucher ${status}.` });
});

app.get("/api/admin/orders", requireAdmin, (req, res) => {
  res.json({ orders: db.orders });
});

app.post("/api/admin/orders/:id/verify-payment", requireAdmin, (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!order.txHash || !order.crypto) {
    return res.status(400).json({ error: "Buyer has not submitted a crypto payment yet." });
  }

  order.paymentStatus = "verified";
  order.status = "payment_verified";
  order.paymentVerifiedAt = new Date().toISOString();
  save();

  res.json({ message: "Payment marked as verified.", order });
});

app.post("/api/admin/orders/:id/assign-voucher", requireAdmin, (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  const requestedVoucherId = String(req.body.voucherId || req.body.submissionId || "").trim();
  const voucher = db.vouchers.find(v =>
    v.id === requestedVoucherId || v.submissionId === requestedVoucherId
  );

  if (!order) return res.status(404).json({ error: "Order not found." });
  if (!voucher) return res.status(404).json({ error: "Voucher not found. Refresh the admin page and choose the voucher again." });
  if (order.paymentStatus !== "verified") {
    return res.status(400).json({ error: "Verify the buyer payment before assigning a voucher." });
  }
  if (voucher.status !== "approved") {
    return res.status(400).json({ error: "Voucher must be approved and available before delivery." });
  }
  if (voucher.brand.toLowerCase() !== order.brand.toLowerCase()) {
    return res.status(400).json({ error: "Voucher brand does not match the order." });
  }
  if (Number(voucher.amount) !== Number(order.faceValue)) {
    return res.status(400).json({ error: "Voucher value does not match the order value." });
  }
  if (voucher.assignedOrderId) {
    return res.status(400).json({ error: "That voucher is already assigned to another order." });
  }

  order.assignedVoucherId = voucher.id;
  order.status = "ready_for_delivery";
  voucher.status = "reserved";
  voucher.assignedOrderId = order.id;
  voucher.reservedAt = new Date().toISOString();
  save();

  res.json({ message: "Voucher assigned to order.", order });
});

app.post("/api/admin/orders/:id/deliver", requireAdmin, (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order || !order.assignedVoucherId) {
    return res.status(400).json({ error: "Assign an approved voucher first." });
  }
  if (order.paymentStatus !== "verified") {
    return res.status(400).json({ error: "Verify payment before delivery." });
  }

  const voucher = db.vouchers.find(v => v.id === order.assignedVoucherId);
  if (!voucher) return res.status(404).json({ error: "Assigned voucher not found." });

  order.status = "delivered";
  order.deliveredAt = new Date().toISOString();
  voucher.status = "sold";
  voucher.soldAt = order.deliveredAt;
  save();

  res.json({ message: "Voucher delivered. Buyer can now view the code.", order });
});

app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    emailMode: transporter ? "smtp" : "demo-console",
    sellerPayoutPercent: SELLER_PAYOUT_PERCENT,
    buyerFeePercent: BUYER_FEE_PERCENT,
    buyerFixedFee: BUYER_FIXED_FEE
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Cardora running at http://localhost:${PORT}`);
  console.log(`Email mode: ${transporter ? "REAL EMAIL" : "DEMO — verification codes print here"}`);
  console.log(`Seller payout: ${SELLER_PAYOUT_PERCENT}%`);
  console.log(`Buyer fee: ${BUYER_FEE_PERCENT}% + $${BUYER_FIXED_FEE.toFixed(2)}`);
});
