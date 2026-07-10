/**
 * Strongly typed Socket.io event contracts.
 *
 * These interfaces are plugged into `Server<...>` / `Socket<...>` generics so
 * every `emit` and `on` — on both server and client — is compile-time checked.
 * The frontend mirrors these in `frontend/src/lib/socket-events.ts`.
 */

export interface UserDTO {
  _id: string;
  username: string;
  avatar: string;
  bio?: string;
  onlineStatus?: boolean;
  lastSeen?: string;
}

export interface AttachmentDTO {
  type: "image" | "file";
  url: string;
  name: string;
  size: number;
  mime: string;
}

export interface ReactionDTO {
  user: string;
  emoji: string;
}

/** Compact snapshot of the message being replied to. */
export interface ReplyDTO {
  _id: string;
  sender: { _id: string; username: string };
  content: string;
  attachment?: AttachmentDTO | null;
  deleted?: boolean;
}

export interface MessageDTO {
  _id: string;
  sender: UserDTO;
  room: string;
  content: string;
  attachment?: AttachmentDTO | null;
  replyTo?: ReplyDTO | null;
  reactions: ReactionDTO[];
  timestamp: string | Date;
  readBy: string[];
  deliveredTo: string[];
  edited: boolean;
  deleted: boolean;
}

export interface RoomDTO {
  _id: string;
  name: string;
  isGroup: boolean;
  isCommunity: boolean;
  participants: UserDTO[];
  admins: string[];
  joinRequests?: UserDTO[];
  description: string;
  avatar?: string;
  updatedAt?: string | Date;
}

export interface UserStatusPayload {
  userId: string;
  onlineStatus: boolean;
  lastSeen?: string | Date;
}

export interface TypingPayload {
  roomId: string;
  userId: string;
  username: string;
}

export interface SendMessagePayload {
  roomId: string;
  content?: string;
  replyTo?: string | null;
  attachment?: AttachmentDTO | null;
}

export interface SendMessageAck {
  ok: boolean;
  message?: MessageDTO;
  error?: string;
}

export interface PrivateRoomAck {
  ok: boolean;
  room?: RoomDTO;
  error?: string;
}

export interface RoomAck {
  ok: boolean;
  room?: RoomDTO;
  error?: string;
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

/* ---------- WebRTC call signaling (opaque SDP/ICE blobs are relayed as-is) ---------- */
export type CallType = "audio" | "video";

export interface CallUserPayload {
  toUserId: string;
  sdp: unknown;
  callType: CallType;
}
export interface AnswerCallPayload {
  toUserId: string;
  sdp: unknown;
}
export interface IceCandidatePayload {
  toUserId: string;
  candidate: unknown;
}
export interface EndCallPayload {
  toUserId: string;
  reason?: string;
}

/** Events the client sends to the server. */
export interface ClientToServerEvents {
  join_room: (roomId: string) => void;
  join_private_room: (
    recipientId: string,
    ack: (res: PrivateRoomAck) => void
  ) => void;
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

  // Reactions
  react_message: (payload: { messageId: string; emoji: string }) => void;

  // Group admin controls
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
  group_leave: (roomId: string, ack?: (res: { ok: boolean; error?: string }) => void) => void;

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
  "call-user": (payload: CallUserPayload) => void;
  "answer-call": (payload: AnswerCallPayload) => void;
  "ice-candidate": (payload: IceCandidatePayload) => void;
  "end-call": (payload: EndCallPayload) => void;
}

/** Events the server sends to clients. */
export interface ServerToClientEvents {
  receive_message: (message: MessageDTO) => void;
  user_status_change: (payload: UserStatusPayload) => void;
  user_typing: (payload: TypingPayload) => void;
  private_room_created: (room: RoomDTO) => void;
  messages_delivered: (payload: ReceiptPayload) => void;
  messages_read: (payload: ReceiptPayload) => void;
  message_edited: (message: MessageDTO) => void;
  message_deleted: (payload: { messageId: string; roomId: string }) => void;
  user_updated: (payload: ProfilePayload) => void;

  // Reactions
  message_reaction: (payload: {
    messageId: string;
    roomId: string;
    reactions: ReactionDTO[];
  }) => void;

  // Group admin
  room_updated: (room: RoomDTO) => void;
  removed_from_room: (payload: { roomId: string }) => void;

  // WebRTC signaling
  "incoming-call": (payload: { from: UserDTO; sdp: unknown; callType: CallType }) => void;
  "call-answered": (payload: { from: string; sdp: unknown }) => void;
  "ice-candidate": (payload: { from: string; candidate: unknown }) => void;
  "call-ended": (payload: { from: string; reason?: string }) => void;
  "call-error": (payload: { message: string }) => void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface InterServerEvents {}

export interface SocketData {
  userId: string;
  username: string;
}
