import { Router, Response } from "express";
import { Types } from "mongoose";
import multer from "multer";
import path from "path";
import fs from "fs";
import ChatRoom from "../models/ChatRoom";
import Message from "../models/Message";
import User from "../models/User";
import { requireAuth, AuthRequest } from "../middleware/auth";
import { getIO } from "../socket";

const router = Router();

router.use(requireAuth);

const PARTICIPANT_FIELDS =
  "username avatar bio onlineStatus lastSeen lastSeenVisible";
const REPLY_POPULATE = {
  path: "replyTo",
  select: "content attachment deleted sender",
  populate: { path: "sender", select: "username" },
};

/* ---------- Media / group-avatar uploads (local disk) ---------- */
export const MEDIA_DIR = path.resolve(__dirname, "..", "..", "uploads", "media");
fs.mkdirSync(MEDIA_DIR, { recursive: true });

const mediaStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const mediaUpload = multer({
  storage: mediaStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
});

function fileUrl(req: AuthRequest, filename: string) {
  return `${req.protocol}://${req.get("host")}/uploads/media/${filename}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitizeUser(u: any): Record<string, unknown> {
  const obj = u && typeof u.toJSON === "function" ? u.toJSON() : { ...u };
  if (obj.lastSeenVisible === false) {
    obj.onlineStatus = false;
    obj.lastSeen = null;
  }
  delete obj.lastSeenVisible;
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function roomJSON(room: any): Record<string, any> {
  const json = room.toJSON() as Record<string, any>;
  json.participants = json.participants.map(sanitizeUser);
  return json;
}

// GET /api/rooms — rooms the current user participates in, with last message
router.get("/", async (req: AuthRequest, res: Response) => {
  const rooms = await ChatRoom.find({ participants: req.userId })
    .populate("participants", PARTICIPANT_FIELDS)
    .populate("joinRequests", "username avatar")
    .sort({ updatedAt: -1 });

  const withLastMessage = await Promise.all(
    rooms.map(async (room) => {
      const lastMessage = await Message.findOne({ room: room._id })
        .sort({ timestamp: -1 })
        .populate("sender", "username avatar");
      return { ...roomJSON(room), lastMessage };
    })
  );

  res.json({ rooms: withLastMessage });
});

// POST /api/rooms — create a room (group or 1:1)
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const { name, isGroup, isCommunity, participantIds, description } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Room name is required" });
      return;
    }
    const community = Boolean(isCommunity);
    const group = Boolean(isGroup) || community; // a community is a public group
    const ids: string[] = Array.isArray(participantIds) ? participantIds : [];
    const participants = [
      ...new Set([req.userId!, ...ids.filter((id) => Types.ObjectId.isValid(id))]),
    ];

    // Reuse an existing 1:1 room only for pure DMs
    if (!group && participants.length === 2) {
      const existing = await ChatRoom.findOne({
        isGroup: false,
        isCommunity: false,
        participants: { $all: participants, $size: 2 },
      }).populate("participants", PARTICIPANT_FIELDS);
      if (existing) {
        res.json({ room: roomJSON(existing), existing: true });
        return;
      }
    }

    const room = await ChatRoom.create({
      name,
      isGroup: group,
      isCommunity: community,
      participants,
      admins: group ? [req.userId!] : [],
      description: description || "",
    });
    const populated = await room.populate("participants", PARTICIPANT_FIELDS);
    res.status(201).json({ room: roomJSON(populated) });
  } catch (err) {
    console.error("Create room error:", err);
    res.status(500).json({ error: "Failed to create room" });
  }
});

// GET /api/rooms/communities — all public communities (discovery)
router.get("/communities", async (req: AuthRequest, res: Response) => {
  const uid = String(req.userId);
  const communities = await ChatRoom.find({ isCommunity: true }).sort({ updatedAt: -1 });
  const list = communities.map((c) => ({
    _id: c.id,
    name: c.name,
    description: c.description,
    avatar: c.avatar,
    memberCount: c.participants.length,
    isMember: c.participants.some((p) => p.toString() === uid),
    isPending: c.joinRequests.some((r) => r.toString() === uid),
    isAdmin: c.admins.some((a) => a.toString() === uid),
  }));
  res.json({ communities: list });
});

// GET /api/rooms/users/lookup?username= — find a user by exact username
router.get("/users/lookup", async (req: AuthRequest, res: Response) => {
  const username = String(req.query.username ?? "").trim();
  if (!username) {
    res.status(400).json({ error: "A username is required" });
    return;
  }
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const user = await User.findOne({
    username: new RegExp(`^${escaped}$`, "i"),
  }).select(PARTICIPANT_FIELDS);
  if (!user) {
    res.status(404).json({ error: `No user found with username "${username}"` });
    return;
  }
  if (user.id === String(req.userId)) {
    res.status(400).json({ error: "That's you!" });
    return;
  }
  res.json({ user: sanitizeUser(user) });
});

// POST /api/rooms/upload — upload a message attachment (image or file)
router.post(
  "/upload",
  mediaUpload.single("file"),
  (req: AuthRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const isImage = /^image\//.test(req.file.mimetype);
    res.json({
      attachment: {
        type: isImage ? "image" : "file",
        url: fileUrl(req, req.file.filename),
        name: req.file.originalname,
        size: req.file.size,
        mime: req.file.mimetype,
      },
    });
  }
);

// POST /api/rooms/:id/avatar — set a group photo (admins only)
router.post(
  "/:id/avatar",
  mediaUpload.single("avatar"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!req.file || !/^image\//.test(req.file.mimetype)) {
        res.status(400).json({ error: "An image is required" });
        return;
      }
      const room = await ChatRoom.findOne({ _id: id, isGroup: true, participants: req.userId });
      if (!room) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      if (!room.admins.some((a) => a.toString() === req.userId)) {
        res.status(403).json({ error: "Only admins can change the group photo" });
        return;
      }
      room.avatar = fileUrl(req, req.file.filename);
      await room.save();
      const populated = await room.populate("participants", PARTICIPANT_FIELDS);
      const json = roomJSON(populated);
      getIO()?.to(room.id).emit("room_updated", json as never);
      res.json({ room: json });
    } catch (err) {
      console.error("Group avatar error:", err);
      res.status(500).json({ error: "Failed to set group photo" });
    }
  }
);

// GET /api/rooms/search?q= — global search across the user's chats & messages
router.get("/search", async (req: AuthRequest, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json({ rooms: [], messages: [] });
    return;
  }
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  const myRooms = await ChatRoom.find({ participants: req.userId }).populate(
    "participants",
    "username avatar"
  );
  const roomMatches = myRooms.filter((room) => {
    if (rx.test(room.name)) return true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (room.participants as any[]).some(
      (p) => p._id.toString() !== req.userId && rx.test(p.username)
    );
  });

  const roomIds = myRooms.map((r) => r._id);
  const messageMatches = await Message.find({
    room: { $in: roomIds },
    deleted: { $ne: true },
    content: rx,
  })
    .populate("sender", "username avatar")
    .sort({ timestamp: -1 })
    .limit(20);

  res.json({
    rooms: roomMatches.map((r) => roomJSON(r)),
    messages: messageMatches,
  });
});

// GET /api/rooms/:id/messages/search?q= — search within one conversation
router.get("/:id/messages/search", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "Invalid room id" });
    return;
  }
  const room = await ChatRoom.findOne({ _id: id, participants: req.userId }).select("_id");
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.json({ messages: [] });
    return;
  }
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const messages = await Message.find({ room: id, deleted: { $ne: true }, content: rx })
    .populate("sender", "username avatar")
    .sort({ timestamp: -1 })
    .limit(50);
  res.json({ messages });
});

// GET /api/rooms/:id/messages — paginated history (newest page first)
router.get("/:id/messages", async (req: AuthRequest, res: Response) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: "Invalid room id" });
    return;
  }
  const room = await ChatRoom.findOne({ _id: id, participants: req.userId });
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }

  const limit = Math.min(
    Math.max(parseInt(String(req.query.limit ?? "50"), 10) || 50, 1),
    100
  );
  const before = req.query.before ? new Date(String(req.query.before)) : null;
  const filter: Record<string, unknown> = { room: id };
  if (before && !isNaN(before.getTime())) filter.timestamp = { $lt: before };

  const page = await Message.find(filter)
    .populate("sender", "username avatar")
    .populate(REPLY_POPULATE)
    .sort({ timestamp: -1 })
    .limit(limit + 1);

  const hasMore = page.length > limit;
  const messages = page.slice(0, limit).reverse();
  res.json({ messages, hasMore });
});

// GET /api/rooms/users/all — everyone else, for starting new chats
router.get("/users/all", async (req: AuthRequest, res: Response) => {
  const users = await User.find({ _id: { $ne: req.userId } })
    .select(PARTICIPANT_FIELDS)
    .sort({ username: 1 });
  res.json({ users: users.map((u) => sanitizeUser(u)) });
});

export default router;
