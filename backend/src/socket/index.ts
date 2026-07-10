import { Server, Socket } from "socket.io";
import { Types } from "mongoose";
import jwt from "jsonwebtoken";
import { getJwtSecret, JwtPayload } from "../middleware/auth";
import User from "../models/User";
import ChatRoom from "../models/ChatRoom";
import Message from "../models/Message";
import { createActionLimiter } from "../middleware/rateLimit";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
  MessageDTO,
  RoomDTO,
} from "./events";

export type ChatServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type ChatSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

const PARTICIPANT_FIELDS = "username avatar bio onlineStatus lastSeen";
const SENDER_FIELDS = "username avatar";
const REPLY_POPULATE = {
  path: "replyTo",
  select: "content attachment deleted sender",
  populate: { path: "sender", select: "username" },
};

let ioRef: ChatServer | null = null;
/** Access the running Socket.io server from REST routes (for broadcasts). */
export function getIO(): ChatServer | null {
  return ioRef;
}

// Abuse protection: cap how fast a user can send messages / reactions
const messageLimiter = createActionLimiter({ windowMs: 10 * 1000, max: 20 });
const reactionLimiter = createActionLimiter({ windowMs: 10 * 1000, max: 30 });

function joinUserSockets(io: ChatServer, userIds: string[], roomId: string) {
  for (const s of io.sockets.sockets.values()) {
    if (userIds.includes(s.data.userId) && !s.rooms.has(roomId)) s.join(roomId);
  }
}

function leaveUserSockets(io: ChatServer, userId: string, roomId: string) {
  for (const s of io.sockets.sockets.values()) {
    if (s.data.userId === userId) s.leave(roomId);
  }
}

function hasOtherSockets(io: ChatServer, userId: string, exceptId: string) {
  for (const s of io.sockets.sockets.values()) {
    if (s.data.userId === userId && s.id !== exceptId) return true;
  }
  return false;
}

function isUserOnline(io: ChatServer, userId: string) {
  for (const s of io.sockets.sockets.values()) {
    if (s.data.userId === userId) return true;
  }
  return false;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildRoomDTO(room: any): Promise<RoomDTO> {
  const populated = await room.populate([
    { path: "participants", select: PARTICIPANT_FIELDS },
    { path: "joinRequests", select: "username avatar" },
  ]);
  return populated.toJSON() as unknown as RoomDTO;
}

export function registerSocketHandlers(io: ChatServer) {
  ioRef = io;

  /* ---------- Handshake: authenticate with the REST API's JWT ---------- */
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Authentication required"));
    try {
      const payload = jwt.verify(token, getJwtSecret()) as JwtPayload;
      const user = await User.findById(payload.userId).select("username");
      if (!user) return next(new Error("User not found"));
      socket.data.userId = payload.userId;
      socket.data.username = user.username;
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", async (socket) => {
    const { userId, username } = socket.data;
    console.log(`Socket connected: ${socket.id} (${username})`);

    try {
      // Personal room so we can target events at one user across their tabs
      socket.join(`user:${userId}`);

      const rooms = await ChatRoom.find({ participants: userId }).select("_id");
      const roomIds = rooms.map((r) => r._id);
      for (const room of rooms) socket.join(room.id);

      const me = await User.findByIdAndUpdate(userId, { onlineStatus: true });
      if (me?.lastSeenVisible !== false) {
        io.emit("user_status_change", { userId, onlineStatus: true });
      }

      const undeliveredRooms = await Message.distinct("room", {
        room: { $in: roomIds },
        sender: { $ne: userId },
        deliveredTo: { $ne: userId },
      });
      if (undeliveredRooms.length > 0) {
        await Message.updateMany(
          { room: { $in: roomIds }, sender: { $ne: userId }, deliveredTo: { $ne: userId } },
          { $addToSet: { deliveredTo: userId } }
        );
        for (const rid of undeliveredRooms) {
          io.to(rid.toString()).emit("messages_delivered", {
            roomId: rid.toString(),
            userId,
          });
        }
      }
    } catch (err) {
      console.error("Connection setup error:", err);
    }

    socket.on("join_room", async (roomId) => {
      try {
        const room = await ChatRoom.findOne({ _id: roomId, participants: userId }).select("_id");
        if (room) socket.join(room.id);
      } catch (err) {
        console.error("join_room error:", err);
      }
    });

    socket.on("join_private_room", async (recipientId, ack) => {
      try {
        const recipient = await User.findById(recipientId).select("username");
        if (!recipient || recipientId === userId) {
          ack({ ok: false, error: "Recipient not found" });
          return;
        }
        const participants = [userId, recipientId];
        let room = await ChatRoom.findOne({
          isGroup: false,
          participants: { $all: participants, $size: 2 },
        });
        const created = !room;
        if (!room) {
          room = await ChatRoom.create({ name: `${username} × ${recipient.username}`, isGroup: false, participants });
        }
        joinUserSockets(io, participants, room.id);
        const dto = await buildRoomDTO(room);
        if (created) socket.to(room.id).emit("private_room_created", dto);
        ack({ ok: true, room: dto });
      } catch (err) {
        console.error("join_private_room error:", err);
        ack({ ok: false, error: "Failed to open private room" });
      }
    });

    /* ---------- Messaging: persist to MongoDB, then broadcast ---------- */
    socket.on("send_message", async (payload, ack) => {
      try {
        const { roomId, content, replyTo, attachment } = payload ?? {};
        const text = (content ?? "").trim();
        if (!roomId || (!text && !attachment)) {
          ack({ ok: false, error: "A message or attachment is required" });
          return;
        }
        if (!messageLimiter(userId)) {
          ack({ ok: false, error: "You're sending messages too fast. Slow down a moment." });
          return;
        }

        const room = await ChatRoom.findOne({ _id: roomId, participants: userId });
        if (!room) {
          ack({ ok: false, error: "Room not found" });
          return;
        }

        const others = room.participants.map((p) => p.toString()).filter((id) => id !== userId);
        const onlineOthers = others.filter((id) => isUserOnline(io, id));

        const message = await Message.create({
          sender: userId,
          room: roomId,
          content: text,
          attachment: attachment ?? null,
          replyTo: replyTo && Types.ObjectId.isValid(replyTo) ? replyTo : null,
          readBy: [userId],
          deliveredTo: [userId, ...onlineOthers],
        });

        await message.populate([{ path: "sender", select: SENDER_FIELDS }, REPLY_POPULATE]);
        const dto = message.toJSON() as unknown as MessageDTO;

        room.set({ updatedAt: new Date() });
        await room.save();

        joinUserSockets(io, [userId, ...others], room.id);
        io.to(room.id).emit("receive_message", dto);
        ack({ ok: true, message: dto });
      } catch (err) {
        console.error("send_message error:", err);
        ack({ ok: false, error: "Failed to send message" });
      }
    });

    /* ---------- Reactions ---------- */
    socket.on("react_message", async ({ messageId, emoji }) => {
      try {
        if (!emoji || !reactionLimiter(userId)) return;
        const msg = await Message.findById(messageId);
        if (!msg) return;
        const room = await ChatRoom.findOne({ _id: msg.room, participants: userId }).select("_id");
        if (!room) return;

        const idx = msg.reactions.findIndex((r) => r.user.toString() === userId);
        let previous: string | null = null;
        if (idx >= 0) {
          previous = msg.reactions[idx].emoji;
          msg.reactions.splice(idx, 1);
        }
        // Toggle off if same emoji, otherwise set the new one
        if (previous !== emoji) {
          msg.reactions.push({ user: new Types.ObjectId(userId), emoji });
        }
        await msg.save();

        io.to(msg.room.toString()).emit("message_reaction", {
          messageId: msg.id,
          roomId: msg.room.toString(),
          reactions: msg.reactions.map((r) => ({ user: r.user.toString(), emoji: r.emoji })),
        });
      } catch (err) {
        console.error("react_message error:", err);
      }
    });

    socket.on("mark_read", async (roomId) => {
      try {
        const room = await ChatRoom.findOne({ _id: roomId, participants: userId }).select("_id");
        if (!room) return;
        const result = await Message.updateMany(
          { room: roomId, readBy: { $ne: userId } },
          { $addToSet: { readBy: userId } }
        );
        if (result.modifiedCount === 0) return;
        const me = await User.findById(userId).select("readReceipts");
        if (me?.readReceipts !== false) {
          socket.to(room.id).emit("messages_read", { roomId: room.id, userId });
        }
      } catch (err) {
        console.error("mark_read error:", err);
      }
    });

    socket.on("edit_message", async ({ messageId, content }, ack) => {
      try {
        if (!content?.trim()) {
          ack?.({ ok: false, error: "Content is required" });
          return;
        }
        const msg = await Message.findOne({ _id: messageId, sender: userId });
        if (!msg || msg.deleted) {
          ack?.({ ok: false, error: "Message not found" });
          return;
        }
        msg.content = content.trim();
        msg.edited = true;
        msg.editedAt = new Date();
        await msg.save();
        await msg.populate([{ path: "sender", select: SENDER_FIELDS }, REPLY_POPULATE]);
        io.to(msg.room.toString()).emit("message_edited", msg.toJSON() as unknown as MessageDTO);
        ack?.({ ok: true });
      } catch (err) {
        console.error("edit_message error:", err);
        ack?.({ ok: false, error: "Failed to edit message" });
      }
    });

    socket.on("delete_message", async (messageId, ack) => {
      try {
        const msg = await Message.findOneAndUpdate(
          { _id: messageId, sender: userId },
          { deleted: true, content: "", attachment: null, reactions: [] },
          { new: true }
        );
        if (!msg) {
          ack?.({ ok: false, error: "Message not found" });
          return;
        }
        io.to(msg.room.toString()).emit("message_deleted", {
          messageId: msg.id,
          roomId: msg.room.toString(),
        });
        ack?.({ ok: true });
      } catch (err) {
        console.error("delete_message error:", err);
        ack?.({ ok: false, error: "Failed to delete message" });
      }
    });

    socket.on("typing", ({ roomId }) => {
      if (roomId) socket.to(roomId).emit("user_typing", { roomId, userId, username });
    });

    socket.on("announce_profile", ({ avatar, bio, username: newName }) => {
      socket.data.username = newName || socket.data.username;
      socket.broadcast.emit("user_updated", { userId, avatar, bio, username: newName });
    });

    /* ---------- Group admin controls ---------- */
    async function loadAdminGroup(roomId: string) {
      const room = await ChatRoom.findOne({ _id: roomId, isGroup: true, participants: userId });
      if (!room) return { error: "Group not found" as const, room: null };
      if (!room.admins.some((a) => a.toString() === userId)) {
        return { error: "Only admins can do that" as const, room: null };
      }
      return { error: null, room };
    }

    socket.on("group_update", async ({ roomId, name, description, avatar }, ack) => {
      try {
        const { error, room } = await loadAdminGroup(roomId);
        if (error || !room) return ack?.({ ok: false, error: error ?? "Not found" });
        if (typeof name === "string" && name.trim()) room.name = name.trim().slice(0, 50);
        if (typeof description === "string") room.description = description.trim().slice(0, 200);
        if (typeof avatar === "string") room.avatar = avatar;
        await room.save();
        const dto = await buildRoomDTO(room);
        io.to(room.id).emit("room_updated", dto);
        ack?.({ ok: true, room: dto });
      } catch (err) {
        console.error("group_update error:", err);
        ack?.({ ok: false, error: "Failed to update group" });
      }
    });

    socket.on("group_add_members", async ({ roomId, userIds }, ack) => {
      try {
        const { error, room } = await loadAdminGroup(roomId);
        if (error || !room) return ack?.({ ok: false, error: error ?? "Not found" });
        const valid = (userIds ?? []).filter((id) => Types.ObjectId.isValid(id));
        const existing = new Set(room.participants.map((p) => p.toString()));
        const toAdd = valid.filter((id) => !existing.has(id));
        if (toAdd.length === 0) return ack?.({ ok: false, error: "No new members to add" });
        room.participants.push(...toAdd.map((id) => new Types.ObjectId(id)));
        await room.save();
        joinUserSockets(io, toAdd, room.id);
        const dto = await buildRoomDTO(room);
        io.to(room.id).emit("room_updated", dto);
        ack?.({ ok: true, room: dto });
      } catch (err) {
        console.error("group_add_members error:", err);
        ack?.({ ok: false, error: "Failed to add members" });
      }
    });

    socket.on("group_remove_member", async ({ roomId, userId: targetId }, ack) => {
      try {
        const { error, room } = await loadAdminGroup(roomId);
        if (error || !room) return ack?.({ ok: false, error: error ?? "Not found" });
        if (targetId === userId) return ack?.({ ok: false, error: "Use leave group instead" });
        room.participants = room.participants.filter((p) => p.toString() !== targetId);
        room.admins = room.admins.filter((a) => a.toString() !== targetId);
        await room.save();
        io.to(`user:${targetId}`).emit("removed_from_room", { roomId: room.id });
        leaveUserSockets(io, targetId, room.id);
        const dto = await buildRoomDTO(room);
        io.to(room.id).emit("room_updated", dto);
        ack?.({ ok: true, room: dto });
      } catch (err) {
        console.error("group_remove_member error:", err);
        ack?.({ ok: false, error: "Failed to remove member" });
      }
    });

    socket.on("group_set_admin", async ({ roomId, userId: targetId, isAdmin }, ack) => {
      try {
        const { error, room } = await loadAdminGroup(roomId);
        if (error || !room) return ack?.({ ok: false, error: error ?? "Not found" });
        const isParticipant = room.participants.some((p) => p.toString() === targetId);
        if (!isParticipant) return ack?.({ ok: false, error: "User is not a member" });
        const already = room.admins.some((a) => a.toString() === targetId);
        if (isAdmin && !already) {
          room.admins.push(new Types.ObjectId(targetId));
        } else if (!isAdmin && already) {
          if (room.admins.length <= 1) return ack?.({ ok: false, error: "A group needs at least one admin" });
          room.admins = room.admins.filter((a) => a.toString() !== targetId);
        }
        await room.save();
        const dto = await buildRoomDTO(room);
        io.to(room.id).emit("room_updated", dto);
        ack?.({ ok: true, room: dto });
      } catch (err) {
        console.error("group_set_admin error:", err);
        ack?.({ ok: false, error: "Failed to update admin" });
      }
    });

    socket.on("group_leave", async (roomId, ack) => {
      try {
        const room = await ChatRoom.findOne({ _id: roomId, isGroup: true, participants: userId });
        if (!room) return ack?.({ ok: false, error: "Group not found" });
        room.participants = room.participants.filter((p) => p.toString() !== userId);
        room.admins = room.admins.filter((a) => a.toString() !== userId);
        // Keep the group governable: promote someone if no admins remain
        if (room.admins.length === 0 && room.participants.length > 0) {
          room.admins.push(room.participants[0]);
        }
        io.to(`user:${userId}`).emit("removed_from_room", { roomId: room.id });
        leaveUserSockets(io, userId, room.id);
        if (room.participants.length === 0) {
          await Message.deleteMany({ room: room._id });
          await room.deleteOne();
        } else {
          await room.save();
          const dto = await buildRoomDTO(room);
          io.to(room.id).emit("room_updated", dto);
        }
        ack?.({ ok: true });
      } catch (err) {
        console.error("group_leave error:", err);
        ack?.({ ok: false, error: "Failed to leave group" });
      }
    });

    /* ---------- Communities: request → admin approval ---------- */
    socket.on("community_request", async (roomId, ack) => {
      try {
        const room = await ChatRoom.findOne({ _id: roomId, isCommunity: true });
        if (!room) return ack?.({ ok: false, error: "Community not found" });
        if (room.participants.some((p) => p.toString() === userId)) {
          return ack?.({ ok: false, error: "You're already a member" });
        }
        if (!room.joinRequests.some((r) => r.toString() === userId)) {
          room.joinRequests.push(new Types.ObjectId(userId));
          await room.save();
          // Admins are members, so they'll see the updated request list
          const dto = await buildRoomDTO(room);
          io.to(room.id).emit("room_updated", dto);
        }
        ack?.({ ok: true });
      } catch (err) {
        console.error("community_request error:", err);
        ack?.({ ok: false, error: "Failed to send request" });
      }
    });

    async function loadAdminCommunity(roomId: string) {
      const room = await ChatRoom.findOne({
        _id: roomId,
        isCommunity: true,
        participants: userId,
      });
      if (!room) return { error: "Community not found" as const, room: null };
      if (!room.admins.some((a) => a.toString() === userId)) {
        return { error: "Only admins can do that" as const, room: null };
      }
      return { error: null, room };
    }

    socket.on("community_approve", async ({ roomId, userId: targetId }, ack) => {
      try {
        const { error, room } = await loadAdminCommunity(roomId);
        if (error || !room) return ack?.({ ok: false, error: error ?? "Not found" });
        if (!room.joinRequests.some((r) => r.toString() === targetId)) {
          return ack?.({ ok: false, error: "No pending request from that user" });
        }
        room.joinRequests = room.joinRequests.filter((r) => r.toString() !== targetId);
        if (!room.participants.some((p) => p.toString() === targetId)) {
          room.participants.push(new Types.ObjectId(targetId));
        }
        await room.save();
        joinUserSockets(io, [targetId], room.id);
        const dto = await buildRoomDTO(room);
        io.to(room.id).emit("room_updated", dto);
        io.to(`user:${targetId}`).emit("room_updated", dto); // add to their chat list
        ack?.({ ok: true, room: dto });
      } catch (err) {
        console.error("community_approve error:", err);
        ack?.({ ok: false, error: "Failed to approve" });
      }
    });

    socket.on("community_reject", async ({ roomId, userId: targetId }, ack) => {
      try {
        const { error, room } = await loadAdminCommunity(roomId);
        if (error || !room) return ack?.({ ok: false, error: error ?? "Not found" });
        room.joinRequests = room.joinRequests.filter((r) => r.toString() !== targetId);
        await room.save();
        const dto = await buildRoomDTO(room);
        io.to(room.id).emit("room_updated", dto);
        ack?.({ ok: true, room: dto });
      } catch (err) {
        console.error("community_reject error:", err);
        ack?.({ ok: false, error: "Failed to reject" });
      }
    });

    /* ---------- WebRTC call signaling (relay only) ---------- */
    socket.on("call-user", async ({ toUserId, sdp, callType }) => {
      try {
        if (!isUserOnline(io, toUserId)) {
          socket.emit("call-error", { message: "User is offline" });
          return;
        }
        const caller = await User.findById(userId).select("username avatar");
        io.to(`user:${toUserId}`).emit("incoming-call", {
          from: {
            _id: userId,
            username: caller?.username ?? username,
            avatar: caller?.avatar ?? "",
          },
          sdp,
          callType,
        });
      } catch (err) {
        console.error("call-user error:", err);
        socket.emit("call-error", { message: "Failed to place the call" });
      }
    });

    socket.on("answer-call", ({ toUserId, sdp }) => {
      io.to(`user:${toUserId}`).emit("call-answered", { from: userId, sdp });
    });

    socket.on("ice-candidate", ({ toUserId, candidate }) => {
      io.to(`user:${toUserId}`).emit("ice-candidate", { from: userId, candidate });
    });

    socket.on("end-call", ({ toUserId, reason }) => {
      io.to(`user:${toUserId}`).emit("call-ended", { from: userId, reason });
    });

    socket.on("disconnect", async () => {
      console.log(`Socket disconnected: ${socket.id} (${username})`);
      try {
        if (!hasOtherSockets(io, userId, socket.id)) {
          const lastSeen = new Date();
          const me = await User.findByIdAndUpdate(userId, { onlineStatus: false, lastSeen });
          if (me?.lastSeenVisible !== false) {
            io.emit("user_status_change", { userId, onlineStatus: false, lastSeen });
          }
        }
      } catch (err) {
        console.error("Disconnect handler error:", err);
      }
    });
  });
}
