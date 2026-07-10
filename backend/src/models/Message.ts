import mongoose, { Schema, Document, Types } from "mongoose";

export interface IAttachment {
  type: "image" | "file";
  url: string;
  name: string;
  size: number;
  mime: string;
}

export interface IReaction {
  user: Types.ObjectId;
  emoji: string;
}

export interface IMessage extends Document {
  sender: Types.ObjectId;
  room: Types.ObjectId;
  content: string;
  attachment: IAttachment | null;
  replyTo: Types.ObjectId | null;
  reactions: IReaction[];
  timestamp: Date;
  readBy: Types.ObjectId[];
  deliveredTo: Types.ObjectId[];
  edited: boolean;
  editedAt: Date | null;
  deleted: boolean;
}

const attachmentSchema = new Schema<IAttachment>(
  {
    type: { type: String, enum: ["image", "file"] },
    url: String,
    name: String,
    size: Number,
    mime: String,
  },
  { _id: false }
);

const messageSchema = new Schema<IMessage>(
  {
    sender: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    room: {
      type: Schema.Types.ObjectId,
      ref: "ChatRoom",
      required: true,
      index: true,
    },
    // Content is optional when an attachment is present
    content: {
      type: String,
      default: "",
      trim: true,
      maxlength: [2000, "Message must be at most 2000 characters"],
    },
    attachment: {
      type: attachmentSchema,
      default: null,
    },
    // The message this one is replying to (for threaded quotes)
    replyTo: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    reactions: [
      {
        _id: false,
        user: { type: Schema.Types.ObjectId, ref: "User" },
        emoji: String,
      },
    ],
    timestamp: {
      type: Date,
      default: Date.now,
    },
    readBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
    deliveredTo: [{ type: Schema.Types.ObjectId, ref: "User" }],
    edited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Text index to support conversation + global message search
messageSchema.index({ content: "text" });

export default mongoose.model<IMessage>("Message", messageSchema);
