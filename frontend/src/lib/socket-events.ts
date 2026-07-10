/**
 * Mirror of the backend's typed Socket.io event contracts
 * (backend/src/socket/events.ts). Keep the two files in sync.
 */
import { Attachment, Message, Reaction, Room, User } from "./types";

export type CallType = "audio" | "video";

export interface UserStatusPayload {
  userId: string;
  onlineStatus: boolean;
  lastSeen?: string;
}

export interface TypingPayload {
  roomId: string;
  userId: string;
  username: string;
}

export interface ReceiptPayload {
  roomId: string;
  userId: string;
}

export interface ProfilePayload {
  userId: string;
  avatar: string;
  bio: string;
  username: string;
}

export interface SendMessagePayload {
  roomId: string;
  content?: string;
  replyTo?: string | null;
  attachment?: Attachment | null;
}

export interface SendMessageAck {
  ok: boolean;
  message?: Message;
  error?: string;
}

export interface RoomAck {
  ok: boolean;
  room?: Room;
  error?: string;
}

export interface ClientToServerEvents {
  join_room: (roomId: string) => void;
  join_private_room: (recipientId: string, ack: (res: RoomAck) => void) => void;
  send_message: (
    payload: SendMessagePayload,
    ack: (res: SendMessageAck) => void
  ) => void;
  typing: (payload: { roomId: string }) => void;
  mark_read: (roomId: string) => void;
  edit_message: (
    payload: { messageId: string; content: string },
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => void;
  delete_message: (
    messageId: string,
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => void;
  announce_profile: (payload: {
    avatar: string;
    bio: string;
    username: string;
  }) => void;
  react_message: (payload: { messageId: string; emoji: string }) => void;
  group_update: (
    payload: { roomId: string; name?: string; description?: string; avatar?: string },
    ack?: (res: RoomAck) => void
  ) => void;
  group_add_members: (
    payload: { roomId: string; userIds: string[] },
    ack?: (res: RoomAck) => void
  ) => void;
  group_remove_member: (
    payload: { roomId: string; userId: string },
    ack?: (res: RoomAck) => void
  ) => void;
  group_set_admin: (
    payload: { roomId: string; userId: string; isAdmin: boolean },
    ack?: (res: RoomAck) => void
  ) => void;
  group_leave: (
    roomId: string,
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => void;

  // Communities
  community_request: (
    roomId: string,
    ack?: (res: { ok: boolean; error?: string }) => void
  ) => void;
  community_approve: (
    payload: { roomId: string; userId: string },
    ack?: (res: RoomAck) => void
  ) => void;
  community_reject: (
    payload: { roomId: string; userId: string },
    ack?: (res: RoomAck) => void
  ) => void;

  // WebRTC signaling
  "call-user": (payload: {
    toUserId: string;
    sdp: RTCSessionDescriptionInit;
    callType: CallType;
  }) => void;
  "answer-call": (payload: { toUserId: string; sdp: RTCSessionDescriptionInit }) => void;
  "ice-candidate": (payload: { toUserId: string; candidate: RTCIceCandidateInit }) => void;
  "end-call": (payload: { toUserId: string; reason?: string }) => void;
}

export interface ServerToClientEvents {
  receive_message: (message: Message) => void;
  user_status_change: (payload: UserStatusPayload) => void;
  user_typing: (payload: TypingPayload) => void;
  private_room_created: (room: Room) => void;
  messages_delivered: (payload: ReceiptPayload) => void;
  messages_read: (payload: ReceiptPayload) => void;
  message_edited: (message: Message) => void;
  message_deleted: (payload: { messageId: string; roomId: string }) => void;
  user_updated: (payload: ProfilePayload) => void;
  message_reaction: (payload: {
    messageId: string;
    roomId: string;
    reactions: Reaction[];
  }) => void;
  room_updated: (room: Room) => void;
  removed_from_room: (payload: { roomId: string }) => void;

  // WebRTC signaling
  "incoming-call": (payload: { from: User; sdp: RTCSessionDescriptionInit; callType: CallType }) => void;
  "call-answered": (payload: { from: string; sdp: RTCSessionDescriptionInit }) => void;
  "ice-candidate": (payload: { from: string; candidate: RTCIceCandidateInit }) => void;
  "call-ended": (payload: { from: string; reason?: string }) => void;
  "call-error": (payload: { message: string }) => void;
}
