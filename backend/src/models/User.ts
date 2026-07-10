import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  id: string;
  username: string;
  email: string;
  password: string;
  avatar: string;
  bio: string;
  onlineStatus: boolean;
  lastSeen: Date;
  // Privacy settings
  lastSeenVisible: boolean;
  readReceipts: boolean;
  // Email verification + password reset
  emailVerified: boolean;
  verifyTokenHash?: string | null;
  verifyTokenExpires?: Date | null;
  resetTokenHash?: string | null;
  resetTokenExpires?: Date | null;
}

const userSchema = new Schema<IUser>(
  {
    username: {
      type: String,
      required: [true, "Username is required"],
      unique: true,
      trim: true,
      minlength: [3, "Username must be at least 3 characters"],
      maxlength: [30, "Username must be at most 30 characters"],
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Invalid email address"],
    },
    password: {
      type: String,
      required: [true, "Password is required"],
      minlength: [6, "Password must be at least 6 characters"],
      select: false,
    },
    avatar: {
      type: String,
      default: "",
    },
    bio: {
      type: String,
      default: "",
      maxlength: [300, "Bio must be at most 300 characters"],
    },
    onlineStatus: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    // When false, this user's online status / last seen is hidden from others
    lastSeenVisible: {
      type: Boolean,
      default: true,
    },
    // When false, this user does not send read receipts (blue ticks)
    readReceipts: {
      type: Boolean,
      default: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    // SHA-256 hashes of one-time tokens (never store the raw token)
    verifyTokenHash: { type: String, default: null, select: false },
    verifyTokenExpires: { type: Date, default: null, select: false },
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpires: { type: Date, default: null, select: false },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", userSchema);
