import mongoose, { Schema, Document, Types } from "mongoose";

export interface IChatRoom extends Document {
  name: string;
  isGroup: boolean;
  isCommunity: boolean;
  participants: Types.ObjectId[];
  admins: Types.ObjectId[];
  joinRequests: Types.ObjectId[];
  pinnedMessages: Types.ObjectId[];
  hiddenFor: Types.ObjectId[];
  description: string;
  avatar: string;
}

const chatRoomSchema = new Schema<IChatRoom>(
  {
    name: {
      type: String,
      required: [true, "Room name is required"],
      trim: true,
      maxlength: [50, "Room name must be at most 50 characters"],
    },
    isGroup: {
      type: Boolean,
      default: false,
    },
    // A community is a public group anyone can discover and request to join
    isCommunity: {
      type: Boolean,
      default: false,
      index: true,
    },
    participants: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
      },
    ],
    // Group/community admins (the creator starts as the sole admin)
    admins: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Pending join requests (communities only)
    joinRequests: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    // Pinned messages in this room
    pinnedMessages: [{ type: Schema.Types.ObjectId, ref: "Message" }],
    // Users who "deleted" (hid) this chat; cleared when new activity arrives
    hiddenFor: [{ type: Schema.Types.ObjectId, ref: "User" }],
    description: {
      type: String,
      default: "",
      maxlength: [200, "Description must be at most 200 characters"],
    },
    avatar: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

export default mongoose.model<IChatRoom>("ChatRoom", chatRoomSchema);
