import { Router, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { Types } from "mongoose";
import User, { IUser } from "../models/User";
import Report from "../models/Report";
import { requireAuth, AuthRequest, getJwtSecret } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { sendMail, actionEmail } from "../utils/mailer";

const router = Router();

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

// Throttle sensitive auth actions to blunt brute-force / abuse
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many attempts. Please wait a few minutes and try again.",
});

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

/** Create a one-time token: return the raw token + its hash + expiry. */
function makeToken(hoursValid: number) {
  const raw = crypto.randomBytes(32).toString("hex");
  return {
    raw,
    hash: sha256(raw),
    expires: new Date(Date.now() + hoursValid * 3600 * 1000),
  };
}

async function sendVerificationEmail(user: IUser) {
  const { raw, hash, expires } = makeToken(24);
  user.verifyTokenHash = hash;
  user.verifyTokenExpires = expires;
  await user.save();
  const url = `${CLIENT_URL}/verify-email?token=${raw}`;
  await sendMail({
    to: user.email,
    subject: "Verify your Plume email",
    html: actionEmail({
      heading: "Confirm your email",
      body: `Welcome to Plume, ${user.username}! Confirm this address to secure your account.`,
      buttonLabel: "Verify email",
      url,
    }),
    text: `Verify your Plume email: ${url}`,
  });
}

/* ---------- Avatar upload (local disk via multer) ---------- */
export const AVATAR_DIR = path.resolve(__dirname, "..", "..", "uploads", "avatars");
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
  filename: (req: AuthRequest, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || ".png";
    cb(null, `${req.userId}-${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPG, GIF or WEBP images are allowed"));
  },
});

function signToken(userId: string): string {
  return jwt.sign({ userId }, getJwtSecret(), {
    expiresIn: (process.env.JWT_EXPIRES_IN || "7d") as jwt.SignOptions["expiresIn"],
  });
}

function publicUser(user: IUser) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    avatar: user.avatar,
    bio: user.bio,
    onlineStatus: user.onlineStatus,
    lastSeen: user.lastSeen,
    lastSeenVisible: user.lastSeenVisible,
    readReceipts: user.readReceipts,
    emailVerified: user.emailVerified,
    blocked: (user.blocked ?? []).map((b) => b.toString()),
  };
}

// POST /api/auth/signup
router.post("/signup", authLimiter, async (req, res: Response) => {
  try {
    const { username, email, password } = req.body ?? {};

    if (!username || !email || !password) {
      res.status(400).json({ error: "username, email and password are required" });
      return;
    }
    if (typeof password !== "string" || password.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }

    const existing = await User.findOne({
      $or: [{ email: String(email).toLowerCase() }, { username }],
    });
    if (existing) {
      res.status(409).json({
        error:
          existing.email === String(email).toLowerCase()
            ? "An account with this email already exists"
            : "This username is already taken",
      });
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      email,
      password: hashed,
      avatar: "",
    });

    // Send a verification email (best-effort; never blocks signup/login)
    sendVerificationEmail(user).catch((e) =>
      console.error("Verification email error:", e)
    );

    res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ error: "Failed to create account" });
  }
});

// POST /api/auth/login — accepts an email OR a username as the identifier
router.post("/login", authLimiter, async (req, res: Response) => {
  try {
    const { email, password } = req.body ?? {};
    const identifier = String(email ?? "").trim();

    if (!identifier || !password) {
      res.status(400).json({ error: "email/username and password are required" });
      return;
    }

    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const user = await User.findOne({
      $or: [
        { email: identifier.toLowerCase() },
        { username: new RegExp(`^${escaped}$`, "i") },
      ],
    }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Failed to log in" });
  }
});

// PATCH /api/auth/me — update profile (username, bio) and privacy settings
router.patch("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { username, bio, lastSeenVisible, readReceipts } = req.body ?? {};
    const update: Record<string, unknown> = {};

    if (bio !== undefined) {
      if (typeof bio !== "string" || bio.length > 300) {
        res.status(400).json({ error: "Bio must be at most 300 characters" });
        return;
      }
      update.bio = bio.trim();
    }

    if (username !== undefined) {
      if (typeof username !== "string" || username.trim().length < 3) {
        res.status(400).json({ error: "Username must be at least 3 characters" });
        return;
      }
      const taken = await User.findOne({
        username: username.trim(),
        _id: { $ne: req.userId },
      });
      if (taken) {
        res.status(409).json({ error: "This username is already taken" });
        return;
      }
      update.username = username.trim();
    }

    if (lastSeenVisible !== undefined) update.lastSeenVisible = Boolean(lastSeenVisible);
    if (readReceipts !== undefined) update.readReceipts = Boolean(readReceipts);

    const user = await User.findByIdAndUpdate(req.userId, update, {
      new: true,
      runValidators: true,
    });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("Update profile error:", err);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// POST /api/auth/me/avatar — upload a profile photo
router.post(
  "/me/avatar",
  requireAuth,
  upload.single("avatar"),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No image uploaded" });
        return;
      }
      const url = `${req.protocol}://${req.get("host")}/uploads/avatars/${req.file.filename}`;
      const user = await User.findByIdAndUpdate(
        req.userId,
        { avatar: url },
        { new: true }
      );
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      res.json({ user: publicUser(user) });
    } catch (err) {
      console.error("Avatar upload error:", err);
      res.status(500).json({ error: "Failed to upload avatar" });
    }
  }
);

// POST /api/auth/change-password
router.post(
  "/change-password",
  requireAuth,
  async (req: AuthRequest, res: Response) => {
    try {
      const { currentPassword, newPassword } = req.body ?? {};
      if (!currentPassword || !newPassword) {
        res.status(400).json({ error: "Both current and new password are required" });
        return;
      }
      if (typeof newPassword !== "string" || newPassword.length < 6) {
        res.status(400).json({ error: "New password must be at least 6 characters" });
        return;
      }

      const user = await User.findById(req.userId).select("+password");
      if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      user.password = await bcrypt.hash(newPassword, 10);
      await user.save();
      res.json({ ok: true });
    } catch (err) {
      console.error("Change password error:", err);
      res.status(500).json({ error: "Failed to change password" });
    }
  }
);

// POST /api/auth/forgot-password — email a reset link (always responds 200)
router.post("/forgot-password", authLimiter, async (req, res: Response) => {
  try {
    const { email } = req.body ?? {};
    if (!email) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    const user = await User.findOne({ email: String(email).toLowerCase() });
    if (user) {
      const { raw, hash, expires } = makeToken(1);
      user.resetTokenHash = hash;
      user.resetTokenExpires = expires;
      await user.save();
      const url = `${CLIENT_URL}/reset-password?token=${raw}`;
      await sendMail({
        to: user.email,
        subject: "Reset your Plume password",
        html: actionEmail({
          heading: "Reset your password",
          body: "We received a request to reset your password. This link expires in 1 hour.",
          buttonLabel: "Reset password",
          url,
        }),
        text: `Reset your Plume password: ${url}`,
      }).catch((e) => console.error("Reset email error:", e));
    }
    // Never reveal whether the email exists
    res.json({ ok: true });
  } catch (err) {
    console.error("Forgot-password error:", err);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// POST /api/auth/reset-password — consume the token and set a new password
router.post("/reset-password", authLimiter, async (req, res: Response) => {
  try {
    const { token, newPassword } = req.body ?? {};
    if (!token || !newPassword) {
      res.status(400).json({ error: "Token and new password are required" });
      return;
    }
    if (typeof newPassword !== "string" || newPassword.length < 6) {
      res.status(400).json({ error: "Password must be at least 6 characters" });
      return;
    }
    const user = await User.findOne({
      resetTokenHash: sha256(String(token)),
      resetTokenExpires: { $gt: new Date() },
    }).select("+password +resetTokenHash +resetTokenExpires");
    if (!user) {
      res.status(400).json({ error: "This reset link is invalid or has expired" });
      return;
    }
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetTokenHash = null;
    user.resetTokenExpires = null;
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    console.error("Reset-password error:", err);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

// POST /api/auth/verify-email — confirm an email address via token
router.post("/verify-email", async (req, res: Response) => {
  try {
    const { token } = req.body ?? {};
    if (!token) {
      res.status(400).json({ error: "Token is required" });
      return;
    }
    const user = await User.findOne({
      verifyTokenHash: sha256(String(token)),
      verifyTokenExpires: { $gt: new Date() },
    }).select("+verifyTokenHash +verifyTokenExpires");
    if (!user) {
      res.status(400).json({ error: "This verification link is invalid or has expired" });
      return;
    }
    user.emailVerified = true;
    user.verifyTokenHash = null;
    user.verifyTokenExpires = null;
    await user.save();
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    console.error("Verify-email error:", err);
    res.status(500).json({ error: "Failed to verify email" });
  }
});

// POST /api/auth/resend-verification — send a fresh verification email
router.post(
  "/resend-verification",
  requireAuth,
  authLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await User.findById(req.userId);
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (user.emailVerified) {
        res.json({ ok: true, alreadyVerified: true });
        return;
      }
      await sendVerificationEmail(user);
      res.json({ ok: true });
    } catch (err) {
      console.error("Resend-verification error:", err);
      res.status(500).json({ error: "Failed to resend verification" });
    }
  }
);

// POST /api/auth/block — block a user
router.post("/block", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.body ?? {};
    if (!Types.ObjectId.isValid(userId) || userId === req.userId) {
      res.status(400).json({ error: "Invalid user" });
      return;
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $addToSet: { blocked: userId } },
      { new: true }
    );
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("Block error:", err);
    res.status(500).json({ error: "Failed to block user" });
  }
});

// POST /api/auth/unblock — unblock a user
router.post("/unblock", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.body ?? {};
    if (!Types.ObjectId.isValid(userId)) {
      res.status(400).json({ error: "Invalid user" });
      return;
    }
    const user = await User.findByIdAndUpdate(
      req.userId,
      { $pull: { blocked: userId } },
      { new: true }
    );
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error("Unblock error:", err);
    res.status(500).json({ error: "Failed to unblock user" });
  }
});

// POST /api/auth/report — report a user
router.post("/report", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { userId, reason } = req.body ?? {};
    if (!Types.ObjectId.isValid(userId) || userId === req.userId) {
      res.status(400).json({ error: "Invalid user" });
      return;
    }
    await Report.create({
      reporter: req.userId,
      reportedUser: userId,
      reason: typeof reason === "string" ? reason.slice(0, 500) : "",
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Report error:", err);
    res.status(500).json({ error: "Failed to submit report" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: publicUser(user) });
});

export default router;
