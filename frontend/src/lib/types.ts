export interface User {
  id?: string;
  _id?: string;
  username: string;
  email?: string;
  avatar: string;
  bio?: string;
  onlineStatus: boolean;
  lastSeen?: string | null;
  lastSeenVisible?: boolean;
  readReceipts?: boolean;
  emailVerified?: boolean;
  blocked?: string[];
}

export interface Room {
  _id: string;
  name: string;
  isGroup: boolean;
  isCommunity: boolean;
  participants: User[];
  admins: string[];
  joinRequests?: User[];
  pinnedMessages?: Message[];
  description: string;
  avatar?: string;
  updatedAt?: string;
  lastMessage?: Message | null;
  unreadCount?: number;
}

export interface CommunitySummary {
  _id: string;
  name: string;
  description: string;
  avatar?: string;
  memberCount: number;
  isMember: boolean;
  isPending: boolean;
  isAdmin: boolean;
}

export interface Attachment {
  type: "image" | "audio" | "file";
  url: string;
  name: string;
  size: number;
  mime: string;
  duration?: number;
}

export interface Reaction {
  user: string;
  emoji: string;
}

export interface ReplySnapshot {
  _id: string;
  sender: { _id: string; username: string };
  content: string;
  attachment?: Attachment | null;
  deleted?: boolean;
}

export interface Message {
  _id: string;
  sender: User;
  room: string;
  content: string;
  attachment?: Attachment | null;
  replyTo?: ReplySnapshot | null;
  reactions: Reaction[];
  mentions?: string[];
  starredBy?: string[];
  timestamp: string;
  readBy: string[];
  deliveredTo: string[];
  edited: boolean;
  deleted: boolean;
}

export function userId(u: User): string {
  return (u.id ?? u._id ?? "") as string;
}

export function isAdmin(room: Room, uid: string): boolean {
  return room.admins?.includes(uid) ?? false;
}
