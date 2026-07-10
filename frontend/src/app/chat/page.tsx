"use client";

import { useEffect, useMemo, useRef, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  API_URL,
  api,
  clearSession,
  getStoredUser,
  getToken,
  saveSession,
} from "@/lib/api";
import { useSocket } from "@/context/SocketContext";
import {
  Attachment,
  CommunitySummary,
  Message,
  Room,
  User,
  isAdmin,
  userId,
} from "@/lib/types";
import { playPing, showDesktopNotification } from "@/lib/notifications";
import Avatar from "@/components/Avatar";
import SettingsModal from "@/components/SettingsModal";
import CallOverlay from "@/components/CallOverlay";
import { useCall } from "@/hooks/useCall";
import GroupManageModal from "@/components/GroupManageModal";
import AttachmentView from "@/components/AttachmentView";

interface TypingEntry {
  username: string;
  until: number;
}

const PAGE_SIZE = 50;
const REACTION_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/* ---------- Time helpers ---------- */
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function fmtMsgTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function fmtListTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return fmtMsgTime(iso);
  const diffDays = (now.getTime() - d.getTime()) / 86400000;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function dateLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return "Yesterday";
  return d.toLocaleDateString([], {
    month: "long",
    day: "numeric",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}
function lastSeenLabel(iso?: string | null) {
  if (!iso) return "offline";
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return "last seen just now";
  if (mins < 60) return `last seen ${Math.floor(mins)} min ago`;
  if (sameDay(d, new Date())) return `last seen at ${fmtMsgTime(iso)}`;
  return `last seen ${fmtListTime(iso)}`;
}
function displayName(room: Room, meId: string) {
  if (room.isGroup) return room.name;
  return room.participants.find((p) => userId(p) !== meId)?.username ?? room.name;
}
function roomAvatar(room: Room, meId: string): string | undefined {
  if (room.isGroup) return room.avatar || undefined;
  return room.participants.find((p) => userId(p) !== meId)?.avatar;
}
function attachmentLabel(m: { content: string; attachment?: Attachment | null }) {
  if (m.content) return m.content;
  if (m.attachment) return m.attachment.type === "image" ? "📷 Photo" : `📎 ${m.attachment.name}`;
  return "";
}

/* ---------- Ticks ---------- */
function Ticks({ msg, room, meId }: { msg: Message; room: Room; meId: string }) {
  const others = room.participants.filter((p) => userId(p) !== meId).map(userId);
  const delivered = others.length > 0 && others.some((id) => msg.deliveredTo?.includes(id));
  const read = others.length > 0 && others.every((id) => msg.readBy?.includes(id));
  const color = read ? "var(--out-check)" : "var(--text-secondary)";
  if (read || delivered) {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label={read ? "Read" : "Delivered"} style={{ color }}>
        <path d="m2 12.5 4 4L14 8m-3 8 1.5 1.5L21 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-label="Sent" style={{ color }}>
      <path d="m5 12.5 4 4L19 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const { socket, connected, disconnect } = useSocket();
  const call = useCall(socket);

  const [me, setMe] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tab, setTab] = useState<"chats" | "discover">("chats");
  const [communities, setCommunities] = useState<CommunitySummary[]>([]);
  const [search, setSearch] = useState("");
  const [globalSearch, setGlobalSearch] = useState<{ rooms: Room[]; messages: Message[] } | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<Attachment | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [typing, setTyping] = useState<Record<string, TypingEntry>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [fabOpen, setFabOpen] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatUsername, setNewChatUsername] = useState("");
  const [newChatError, setNewChatError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<"group" | "community">("group");
  const [createName, setCreateName] = useState("");
  const [createDesc, setCreateDesc] = useState("");
  const [createMembers, setCreateMembers] = useState<User[]>([]);
  const [createMemberInput, setCreateMemberInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGroupManage, setShowGroupManage] = useState(false);
  const [verifyBanner, setVerifyBanner] = useState<"idle" | "sent" | "hidden">("idle");
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState("");
  const [chatSearchResults, setChatSearchResults] = useState<Message[]>([]);
  const [chatSearchIdx, setChatSearchIdx] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRoomRef = useRef<string | null>(null);
  const meIdRef = useRef("");
  const messagesRef = useRef<Message[]>([]);
  const lastTypingEmit = useRef(0);
  const prependRestore = useRef<{ height: number; top: number } | null>(null);
  const stickToBottom = useRef(true);
  const hadConnected = useRef(false);
  const jumpTargetRef = useRef<string | null>(null);
  const loadBeforeRef = useRef<{ roomId: string; before: string; target: string } | null>(null);

  activeRoomRef.current = activeRoomId;
  messagesRef.current = messages;
  const meId = me ? userId(me) : "";
  meIdRef.current = meId;

  function flashHighlight(id: string) {
    setHighlightId(id);
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 2200);
  }

  /* ---------- Session guard + initial data ---------- */
  useEffect(() => {
    const token = getToken();
    const stored = getStoredUser();
    if (!token || !stored) {
      router.replace("/");
      return;
    }
    setMe(stored);
    api<{ user: User }>("/api/auth/me")
      .then((d) => {
        setMe(d.user);
        const t = getToken();
        if (t) saveSession(t, d.user);
      })
      .catch(() => {});
    api<{ rooms: Room[] }>("/api/rooms")
      .then((r) => setRooms(r.rooms))
      .catch((err) => {
        if (/token|401/i.test((err as Error).message)) {
          clearSession();
          router.replace("/");
        }
      });
  }, [router]);

  /* ---------- Socket listeners ---------- */
  useEffect(() => {
    if (!socket) return;

    const onMessage = (msg: Message) => {
      const mine = userId(msg.sender) === meIdRef.current;
      const active = msg.room === activeRoomRef.current;
      if (active) {
        setMessages((prev) => (prev.some((m) => m._id === msg._id) ? prev : [...prev, msg]));
        if (!mine && !document.hidden) socket.emit("mark_read", msg.room);
      } else if (!mine) {
        setUnread((prev) => ({ ...prev, [msg.room]: (prev[msg.room] ?? 0) + 1 }));
      }
      if (!mine && (document.hidden || !active)) {
        showDesktopNotification(msg.sender.username, attachmentLabel(msg));
        playPing();
      }
      setRooms((prev) => {
        const idx = prev.findIndex((r) => r._id === msg.room);
        if (idx < 0) return prev;
        const next = [...prev];
        const [room] = next.splice(idx, 1);
        return [{ ...room, lastMessage: msg }, ...next];
      });
    };

    const onStatus = (p: { userId: string; onlineStatus: boolean; lastSeen?: string }) => {
      const patch = (u: User) =>
        userId(u) === p.userId ? { ...u, onlineStatus: p.onlineStatus, lastSeen: p.lastSeen ?? u.lastSeen } : u;
      setRooms((prev) => prev.map((r) => ({ ...r, participants: r.participants.map(patch) })));
    };

    const onTyping = (t: { roomId: string; userId: string; username: string }) => {
      if (t.roomId !== activeRoomRef.current) return;
      setTyping((prev) => ({ ...prev, [t.userId]: { username: t.username, until: Date.now() + 2500 } }));
    };

    const onPrivateRoom = (room: Room) => {
      setRooms((prev) => (prev.some((r) => r._id === room._id) ? prev : [room, ...prev]));
    };

    const onDelivered = (p: { roomId: string; userId: string }) => {
      if (p.roomId !== activeRoomRef.current) return;
      setMessages((prev) => prev.map((m) => (m.deliveredTo?.includes(p.userId) ? m : { ...m, deliveredTo: [...(m.deliveredTo ?? []), p.userId] })));
    };
    const onRead = (p: { roomId: string; userId: string }) => {
      if (p.roomId !== activeRoomRef.current) return;
      setMessages((prev) =>
        prev.map((m) => ({
          ...m,
          readBy: m.readBy?.includes(p.userId) ? m.readBy : [...(m.readBy ?? []), p.userId],
          deliveredTo: m.deliveredTo?.includes(p.userId) ? m.deliveredTo : [...(m.deliveredTo ?? []), p.userId],
        }))
      );
    };
    const onEdited = (msg: Message) => {
      if (msg.room !== activeRoomRef.current) return;
      setMessages((prev) => prev.map((m) => (m._id === msg._id ? msg : m)));
    };
    const onDeleted = (p: { messageId: string; roomId: string }) => {
      if (p.roomId !== activeRoomRef.current) return;
      setMessages((prev) => prev.map((m) => (m._id === p.messageId ? { ...m, deleted: true, content: "", attachment: null, reactions: [] } : m)));
    };
    const onReaction = (p: { messageId: string; roomId: string; reactions: Message["reactions"] }) => {
      if (p.roomId !== activeRoomRef.current) return;
      setMessages((prev) => prev.map((m) => (m._id === p.messageId ? { ...m, reactions: p.reactions } : m)));
    };
    const onUserUpdated = (p: { userId: string; avatar: string; bio: string; username: string }) => {
      const patch = (u: User) => (userId(u) === p.userId ? { ...u, avatar: p.avatar, bio: p.bio, username: p.username } : u);
      setRooms((prev) => prev.map((r) => ({ ...r, participants: r.participants.map(patch) })));
      setMessages((prev) => prev.map((m) => (userId(m.sender) === p.userId ? { ...m, sender: { ...m.sender, avatar: p.avatar, username: p.username } } : m)));
    };
    const onRoomUpdated = (room: Room) => {
      setRooms((prev) => {
        const idx = prev.findIndex((r) => r._id === room._id);
        if (idx < 0) return [room, ...prev];
        const next = [...prev];
        next[idx] = { ...next[idx], ...room };
        return next;
      });
    };
    const onRemoved = (p: { roomId: string }) => {
      setRooms((prev) => prev.filter((r) => r._id !== p.roomId));
      if (activeRoomRef.current === p.roomId) {
        setActiveRoomId(null);
        setShowInfo(false);
        setShowGroupManage(false);
      }
    };

    const onConnect = () => {
      if (!hadConnected.current) {
        hadConnected.current = true;
        return;
      }
      api<{ rooms: Room[] }>("/api/rooms").then((r) => setRooms(r.rooms)).catch(() => {});
      const roomId = activeRoomRef.current;
      if (roomId) {
        api<{ messages: Message[]; hasMore: boolean }>(`/api/rooms/${roomId}/messages?limit=${PAGE_SIZE}`)
          .then((data) => {
            if (activeRoomRef.current !== roomId) return;
            setMessages(data.messages);
            setHasMore(data.hasMore);
          })
          .catch(() => {});
      }
    };

    socket.on("receive_message", onMessage);
    socket.on("user_status_change", onStatus);
    socket.on("user_typing", onTyping);
    socket.on("private_room_created", onPrivateRoom);
    socket.on("messages_delivered", onDelivered);
    socket.on("messages_read", onRead);
    socket.on("message_edited", onEdited);
    socket.on("message_deleted", onDeleted);
    socket.on("message_reaction", onReaction);
    socket.on("user_updated", onUserUpdated);
    socket.on("room_updated", onRoomUpdated);
    socket.on("removed_from_room", onRemoved);
    socket.on("connect", onConnect);
    return () => {
      socket.off("receive_message", onMessage);
      socket.off("user_status_change", onStatus);
      socket.off("user_typing", onTyping);
      socket.off("private_room_created", onPrivateRoom);
      socket.off("messages_delivered", onDelivered);
      socket.off("messages_read", onRead);
      socket.off("message_edited", onEdited);
      socket.off("message_deleted", onDeleted);
      socket.off("message_reaction", onReaction);
      socket.off("user_updated", onUserUpdated);
      socket.off("room_updated", onRoomUpdated);
      socket.off("removed_from_room", onRemoved);
      socket.off("connect", onConnect);
    };
  }, [socket]);

  /* ---------- Focus → mark read ---------- */
  useEffect(() => {
    const onFocus = () => {
      const roomId = activeRoomRef.current;
      if (roomId && socket) socket.emit("mark_read", roomId);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [socket]);

  /* ---------- Typing expiry ---------- */
  useEffect(() => {
    const id = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 800);
    return () => clearInterval(id);
  }, []);

  /* ---------- Global search (debounced) ---------- */
  useEffect(() => {
    if (tab !== "chats" || !search.trim()) {
      setGlobalSearch(null);
      return;
    }
    const q = search.trim();
    const t = setTimeout(() => {
      api<{ rooms: Room[]; messages: Message[] }>(`/api/rooms/search?q=${encodeURIComponent(q)}`)
        .then((d) => setGlobalSearch(d))
        .catch(() => setGlobalSearch({ rooms: [], messages: [] }));
    }, 250);
    return () => clearTimeout(t);
  }, [search, tab]);

  /* ---------- Load public communities on the Discover tab ---------- */
  useEffect(() => {
    if (tab !== "discover") return;
    api<{ communities: CommunitySummary[] }>("/api/rooms/communities")
      .then((d) => setCommunities(d.communities))
      .catch(() => {});
  }, [tab]);

  /* ---------- In-conversation search (debounced) ---------- */
  useEffect(() => {
    if (!chatSearchOpen || !activeRoomId || !chatSearchQuery.trim()) {
      setChatSearchResults([]);
      return;
    }
    const roomId = activeRoomId;
    const q = chatSearchQuery.trim();
    const t = setTimeout(() => {
      api<{ messages: Message[] }>(`/api/rooms/${roomId}/messages/search?q=${encodeURIComponent(q)}`)
        .then((d) => {
          setChatSearchResults(d.messages);
          setChatSearchIdx(0);
          if (d.messages[0]) jumpToMessage(d.messages[0]);
        })
        .catch(() => setChatSearchResults([]));
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatSearchQuery, chatSearchOpen, activeRoomId]);

  /* ---------- History on room open ---------- */
  useEffect(() => {
    if (!activeRoomId) return;
    const roomId = activeRoomId;
    const jump = loadBeforeRef.current;
    const useBefore = jump && jump.roomId === roomId ? jump.before : null;
    setLoadingMessages(true);
    setMessages([]);
    setHasMore(false);
    setTyping({});
    setEditing(null);
    stickToBottom.current = true;
    setUnread((prev) => ({ ...prev, [roomId]: 0 }));
    const url = `/api/rooms/${roomId}/messages?limit=${PAGE_SIZE}${useBefore ? `&before=${encodeURIComponent(useBefore)}` : ""}`;
    api<{ messages: Message[]; hasMore: boolean }>(url)
      .then((data) => {
        if (activeRoomRef.current !== roomId) return;
        setMessages(data.messages);
        setHasMore(data.hasMore);
        socket?.emit("mark_read", roomId);
        if (jump && jump.roomId === roomId) {
          jumpTargetRef.current = jump.target;
          flashHighlight(jump.target);
          loadBeforeRef.current = null;
        }
      })
      .catch(() => {
        if (activeRoomRef.current === roomId) setMessages([]);
      })
      .finally(() => {
        if (activeRoomRef.current === roomId) setLoadingMessages(false);
      });
  }, [activeRoomId, socket]);

  /* ---------- Auto-scroll / jump ---------- */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    if (jumpTargetRef.current) {
      const target = el.querySelector(`[data-mid="${jumpTargetRef.current}"]`);
      jumpTargetRef.current = null;
      if (target) {
        (target as HTMLElement).scrollIntoView({ block: "center" });
        return;
      }
    }
    if (prependRestore.current) {
      el.scrollTop = el.scrollHeight - prependRestore.current.height + prependRestore.current.top;
      prependRestore.current = null;
      return;
    }
    if (stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, loadingMessages]);

  function handleViewportScroll() {
    const el = viewportRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }

  const activeRoom = useMemo(() => rooms.find((r) => r._id === activeRoomId) ?? null, [rooms, activeRoomId]);

  /* ---------- Jump to a message (loading a page if needed) ---------- */
  function jumpToMessage(msg: { _id: string; timestamp: string }) {
    flashHighlight(msg._id);
    if (messagesRef.current.some((m) => m._id === msg._id)) {
      jumpTargetRef.current = msg._id;
      // nudge the scroll effect for the already-loaded case
      const el = viewportRef.current?.querySelector(`[data-mid="${msg._id}"]`);
      if (el) {
        jumpTargetRef.current = null;
        (el as HTMLElement).scrollIntoView({ block: "center" });
      }
      return;
    }
    if (!activeRoomId) return;
    const before = new Date(new Date(msg.timestamp).getTime() + 1).toISOString();
    api<{ messages: Message[]; hasMore: boolean }>(`/api/rooms/${activeRoomId}/messages?limit=${PAGE_SIZE}&before=${encodeURIComponent(before)}`)
      .then((data) => {
        stickToBottom.current = false;
        setMessages(data.messages);
        setHasMore(data.hasMore);
        jumpTargetRef.current = msg._id;
      })
      .catch(() => {});
  }

  function openGlobalMessage(msg: Message) {
    setSearch("");
    setGlobalSearch(null);
    if (msg.room === activeRoomId) {
      jumpToMessage(msg);
      return;
    }
    loadBeforeRef.current = {
      roomId: msg.room,
      before: new Date(new Date(msg.timestamp).getTime() + 1).toISOString(),
      target: msg._id,
    };
    setActiveRoomId(msg.room);
  }

  /* ---------- Actions ---------- */
  function handleLogout() {
    disconnect();
    clearSession();
    router.replace("/");
  }

  function handleSend(e: FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!socket) return;
    if (editing) {
      socket.emit("edit_message", { messageId: editing.id, content }, (res) => {
        if (!res?.ok) console.error("Edit failed:", res?.error);
      });
      setEditing(null);
      setDraft("");
      return;
    }
    if ((!content && !pendingAttachment) || !activeRoomId) return;
    stickToBottom.current = true;
    socket.emit(
      "send_message",
      { roomId: activeRoomId, content, attachment: pendingAttachment ?? null, replyTo: replyingTo?._id ?? null },
      (res) => {
        if (!res?.ok) console.error("Send failed:", res?.error);
      }
    );
    setDraft("");
    setPendingAttachment(null);
    setReplyingTo(null);
  }

  async function uploadFile(file: File) {
    setUploadingFile(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API_URL}/api/rooms/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Upload failed");
      setPendingAttachment(body.attachment);
    } catch (err) {
      console.error("Attachment upload failed:", err);
    } finally {
      setUploadingFile(false);
    }
  }

  function startEdit(msg: Message) {
    setEditing({ id: msg._id, content: msg.content });
    setDraft(msg.content);
    setReplyingTo(null);
    setMenuFor(null);
  }
  function startReply(msg: Message) {
    setReplyingTo(msg);
    setEditing(null);
    setMenuFor(null);
  }
  function deleteMessage(id: string) {
    setMenuFor(null);
    socket?.emit("delete_message", id, (res) => {
      if (!res?.ok) console.error("Delete failed:", res?.error);
    });
  }
  function react(messageId: string, emoji: string) {
    setMenuFor(null);
    socket?.emit("react_message", { messageId, emoji });
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    if (!socket || !activeRoomId || editing) return;
    const now = Date.now();
    if (now - lastTypingEmit.current > 1200) {
      lastTypingEmit.current = now;
      socket.emit("typing", { roomId: activeRoomId });
    }
  }

  function loadEarlier() {
    if (!activeRoomId || loadingEarlier || messages.length === 0) return;
    const roomId = activeRoomId;
    const before = messages[0].timestamp;
    setLoadingEarlier(true);
    api<{ messages: Message[]; hasMore: boolean }>(`/api/rooms/${roomId}/messages?limit=${PAGE_SIZE}&before=${encodeURIComponent(before)}`)
      .then((data) => {
        if (activeRoomRef.current !== roomId) return;
        const el = viewportRef.current;
        if (el) prependRestore.current = { height: el.scrollHeight, top: el.scrollTop };
        setMessages((prev) => [...data.messages, ...prev]);
        setHasMore(data.hasMore);
      })
      .catch(() => {})
      .finally(() => setLoadingEarlier(false));
  }

  function openChatWith(contact: User) {
    const otherId = userId(contact);
    const existing = rooms.find((r) => !r.isGroup && r.participants.length === 2 && r.participants.some((p) => userId(p) === otherId));
    if (existing) {
      setActiveRoomId(existing._id);
      setShowInfo(false);
      setTab("chats");
      return;
    }
    socket?.emit("join_private_room", otherId, (res) => {
      if (res.ok && res.room) {
        const room = res.room;
        setRooms((prev) => [room, ...prev.filter((r) => r._id !== room._id)]);
        setActiveRoomId(room._id);
        setShowInfo(false);
        setTab("chats");
      }
    });
  }

  async function startChatByUsername(e: FormEvent) {
    e.preventDefault();
    setNewChatError(null);
    const uname = newChatUsername.trim();
    if (!uname) return;
    try {
      const { user } = await api<{ user: User }>(
        `/api/rooms/users/lookup?username=${encodeURIComponent(uname)}`
      );
      setShowNewChat(false);
      setNewChatUsername("");
      openChatWith(user);
    } catch (err) {
      setNewChatError((err as Error).message);
    }
  }

  async function addMemberByUsername() {
    setCreateError(null);
    const uname = createMemberInput.trim();
    if (!uname) return;
    try {
      const { user } = await api<{ user: User }>(
        `/api/rooms/users/lookup?username=${encodeURIComponent(uname)}`
      );
      setCreateMembers((prev) =>
        prev.some((m) => userId(m) === userId(user)) ? prev : [...prev, user]
      );
      setCreateMemberInput("");
    } catch (err) {
      setCreateError((err as Error).message);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreateError(null);
    if (!createName.trim()) return;
    try {
      const data = await api<{ room: Room }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          name: createName.trim(),
          isGroup: createType === "group",
          isCommunity: createType === "community",
          description: createDesc.trim(),
          participantIds: createMembers.map(userId),
        }),
      });
      setRooms((prev) => [data.room, ...prev]);
      setActiveRoomId(data.room._id);
      socket?.emit("join_room", data.room._id);
      setShowCreate(false);
      setCreateName("");
      setCreateDesc("");
      setCreateMembers([]);
      setCreateMemberInput("");
    } catch (err) {
      setCreateError((err as Error).message);
    }
  }

  function loadCommunities() {
    api<{ communities: CommunitySummary[] }>("/api/rooms/communities")
      .then((d) => setCommunities(d.communities))
      .catch(() => {});
  }

  function requestCommunity(id: string) {
    socket?.emit("community_request", id, (res) => {
      if (res?.ok) {
        setCommunities((prev) =>
          prev.map((c) => (c._id === id ? { ...c, isPending: true } : c))
        );
      } else {
        loadCommunities();
      }
    });
  }

  function resendVerification() {
    api("/api/auth/resend-verification", { method: "POST" })
      .then(() => setVerifyBanner("sent"))
      .catch(() => setVerifyBanner("sent"));
  }

  function handleProfileUpdated(user: User) {
    setMe(user);
    const t = getToken();
    if (t) saveSession(t, user);
    socket?.emit("announce_profile", { avatar: user.avatar, bio: user.bio ?? "", username: user.username });
  }

  function stepSearch(dir: 1 | -1) {
    if (chatSearchResults.length === 0) return;
    const n = chatSearchResults.length;
    const next = (chatSearchIdx + dir + n) % n;
    setChatSearchIdx(next);
    jumpToMessage(chatSearchResults[next]);
  }

  /* ---------- Derived ---------- */
  const typingNames = Object.values(typing).map((t) => t.username).filter((n) => n !== me?.username);
  const otherInDm = activeRoom?.isGroup ? null : (activeRoom?.participants.find((p) => userId(p) !== meId) ?? null);
  const headerStatus = activeRoom
    ? typingNames.length > 0
      ? activeRoom.isGroup ? `${typingNames.join(", ")} is typing` : "typing"
      : activeRoom.isGroup
        ? `${activeRoom.participants.length} members`
        : otherInDm?.onlineStatus ? "online" : lastSeenLabel(otherInDm?.lastSeen)
    : "";

  if (!me) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--panel)]">
        <p className="text-[var(--text-secondary)]">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--panel)]">
      {/* ================= Sidebar ================= */}
      <aside className={`w-full flex-col border-r border-[var(--border)] bg-[var(--panel)] md:flex md:w-80 lg:w-96 ${activeRoomId ? "hidden" : "flex"}`}>
        <div className="flex items-center gap-3 px-4 pb-2 pt-3">
          <button className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left transition-colors hover:bg-[var(--bg-secondary)]" onClick={() => setShowSettings(true)} title="Settings">
            <Avatar name={me.username} src={me.avatar} size={40} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{me.username}</p>
              <p className="truncate text-xs text-[var(--text-secondary)]">{connected ? (me.bio ? me.bio : "online") : "connecting…"}</p>
            </div>
          </button>
          <button onClick={() => setShowSettings(true)} title="Settings" className="rounded-full p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
              <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7 6.3 6.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
          <button onClick={handleLogout} title="Log out" className="rounded-full p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--danger)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M15 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8m1-5 4-4m0 0-4-4m4 4H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {me.emailVerified === false && verifyBanner !== "hidden" && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-[13px] text-[var(--accent)]">
            <span className="min-w-0 flex-1">
              {verifyBanner === "sent" ? (
                "Verification email sent — check your inbox."
              ) : (
                <>
                  Verify your email.{" "}
                  <button onClick={resendVerification} className="font-semibold underline">
                    Resend link
                  </button>
                </>
              )}
            </span>
            <button onClick={() => setVerifyBanner("hidden")} title="Dismiss" className="shrink-0 rounded-full p-0.5 hover:bg-[var(--accent)]/10">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}

        <div className="px-4 pb-2">
          <div className="flex items-center gap-2 rounded-full bg-[var(--bg-secondary)] px-4 py-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="7" stroke="var(--text-secondary)" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="var(--text-secondary)" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--text-secondary)]" placeholder="Search messages and chats" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="flex border-b border-[var(--border)] px-4">
          {(["chats", "discover"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`relative px-4 py-2.5 text-sm font-medium capitalize transition-colors ${tab === t ? "text-[var(--accent)]" : "text-[var(--text-secondary)] hover:text-[var(--text)]"}`}>
              {t}
              {tab === t && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" />}
            </button>
          ))}
        </div>

        <div className="relative min-h-0 flex-1 overflow-y-auto">
          {tab === "chats" ? (
            search.trim() && globalSearch ? (
              /* -------- Global search results -------- */
              <div>
                {globalSearch.rooms.length > 0 && (
                  <>
                    <p className="px-4 pb-1 pt-3 text-[12px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Chats</p>
                    {globalSearch.rooms.map((room) => (
                      <button key={room._id} onClick={() => { setActiveRoomId(room._id); setSearch(""); }} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-secondary)]">
                        <Avatar name={displayName(room, meId)} src={roomAvatar(room, meId)} size={44} />
                        <p className="truncate font-medium">{displayName(room, meId)}</p>
                      </button>
                    ))}
                  </>
                )}
                {globalSearch.messages.length > 0 && (
                  <>
                    <p className="px-4 pb-1 pt-3 text-[12px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Messages</p>
                    {globalSearch.messages.map((msg) => {
                      const room = rooms.find((r) => r._id === msg.room);
                      return (
                        <button key={msg._id} onClick={() => openGlobalMessage(msg)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-[var(--bg-secondary)]">
                          <Avatar name={msg.sender.username} src={msg.sender.avatar} size={44} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="truncate text-sm font-medium">{room ? displayName(room, meId) : msg.sender.username}</p>
                              <span className="shrink-0 text-xs text-[var(--text-secondary)]">{fmtListTime(msg.timestamp)}</span>
                            </div>
                            <p className="truncate text-sm text-[var(--text-secondary)]"><span className="text-[var(--text)]">{msg.sender.username}: </span>{msg.content}</p>
                          </div>
                        </button>
                      );
                    })}
                  </>
                )}
                {globalSearch.rooms.length === 0 && globalSearch.messages.length === 0 && (
                  <p className="px-6 py-8 text-center text-sm text-[var(--text-secondary)]">No results for “{search}”.</p>
                )}
              </div>
            ) : rooms.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-[var(--text-secondary)]">No chats yet. Tap + to start a chat by username or create a group.</p>
            ) : (
              rooms.map((room) => {
                const name = displayName(room, meId);
                const other = room.isGroup ? null : room.participants.find((p) => userId(p) !== meId);
                const last = room.lastMessage;
                const active = room._id === activeRoomId;
                return (
                  <button key={room._id} onClick={() => setActiveRoomId(room._id)} className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors ${active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg-secondary)]"}`}>
                    <Avatar name={name} src={roomAvatar(room, meId)} size={52} online={other ? other.onlineStatus : undefined} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate font-medium">{name}</p>
                        {last && <span className={`shrink-0 text-xs ${active ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>{fmtListTime(last.timestamp)}</span>}
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm text-[var(--text-secondary)]">
                          {last ? (last.deleted ? "🚫 message deleted" : `${userId(last.sender) === meId ? "You: " : room.isGroup ? `${last.sender.username}: ` : ""}${attachmentLabel(last)}`) : room.isGroup ? "Group created" : "No messages yet"}
                        </p>
                        {(unread[room._id] ?? 0) > 0 && <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--unread)] px-1.5 text-xs font-medium text-white">{unread[room._id]}</span>}
                      </div>
                    </div>
                  </button>
                );
              })
            )
          ) : communities.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-[var(--text-secondary)]">No communities yet. Create one with the + button.</p>
          ) : (
            communities.map((c) => (
              <div key={c._id} className="flex w-full items-center gap-3 px-3 py-2.5">
                <Avatar name={c.name} src={c.avatar} size={52} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="truncate text-sm text-[var(--text-secondary)]">
                    {c.memberCount} member{c.memberCount === 1 ? "" : "s"}
                    {c.description ? ` · ${c.description}` : ""}
                  </p>
                </div>
                {c.isMember ? (
                  <button onClick={() => { setActiveRoomId(c._id); setTab("chats"); }} className="shrink-0 rounded-full border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]">
                    Open
                  </button>
                ) : c.isPending ? (
                  <span className="shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium text-[var(--text-secondary)]">Requested</span>
                ) : (
                  <button onClick={() => requestCommunity(c._id)} className="shrink-0 rounded-full bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:bg-[var(--accent-hover)]">
                    Request
                  </button>
                )}
              </div>
            ))
          )}

          {/* + FAB with a small action menu */}
          <div className="fixed bottom-6 z-20 md:absolute md:bottom-5" style={{ right: "1.25rem" }}>
            {fabOpen && (
              <>
                <div className="fixed inset-0 -z-0" onClick={() => setFabOpen(false)} />
                <div className="absolute bottom-16 right-0 z-10 w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-lg">
                  <button onClick={() => { setFabOpen(false); setNewChatError(null); setShowNewChat(true); }} className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--bg-secondary)]">💬 New chat</button>
                  <button onClick={() => { setFabOpen(false); setCreateType("group"); setCreateError(null); setShowCreate(true); }} className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--bg-secondary)]">👥 New group</button>
                  <button onClick={() => { setFabOpen(false); setCreateType("community"); setCreateError(null); setShowCreate(true); }} className="block w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--bg-secondary)]">🌐 New community</button>
                </div>
              </>
            )}
            <button onClick={() => setFabOpen((v) => !v)} title="New" className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-lg transition-transform hover:scale-105">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden style={{ transform: fabOpen ? "rotate(45deg)" : "none", transition: "transform 0.2s" }}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* ================= Chat window ================= */}
      <main className={`chat-wallpaper min-w-0 w-full flex-1 flex-col md:flex ${activeRoomId ? "flex" : "hidden"}`}>
        {activeRoom ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-1 border-b border-[var(--border)] bg-[var(--panel)] px-2 py-2 md:px-3">
              <button onClick={() => setActiveRoomId(null)} className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] md:hidden" title="Back">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {chatSearchOpen ? (
                <div className="flex flex-1 items-center gap-2 px-1">
                  <input autoFocus className="min-w-0 flex-1 rounded-full bg-[var(--bg-secondary)] px-4 py-2 text-sm outline-none" placeholder="Search in conversation" value={chatSearchQuery} onChange={(e) => setChatSearchQuery(e.target.value)} />
                  <span className="shrink-0 text-xs text-[var(--text-secondary)]">{chatSearchResults.length ? `${chatSearchIdx + 1}/${chatSearchResults.length}` : chatSearchQuery ? "0" : ""}</span>
                  <button onClick={() => stepSearch(-1)} disabled={!chatSearchResults.length} title="Previous" className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button onClick={() => stepSearch(1)} disabled={!chatSearchResults.length} title="Next" className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] disabled:opacity-40">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </button>
                  <button onClick={() => { setChatSearchOpen(false); setChatSearchQuery(""); setChatSearchResults([]); }} title="Close search" className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                </div>
              ) : (
                <>
                  <button onClick={() => setShowInfo((v) => !v)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1 text-left transition-colors hover:bg-[var(--bg-secondary)]" title={activeRoom.isGroup ? "Group info" : "User info"}>
                    <Avatar name={displayName(activeRoom, meId)} src={roomAvatar(activeRoom, meId)} size={42} online={otherInDm ? otherInDm.onlineStatus : undefined} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-tight">{displayName(activeRoom, meId)}</p>
                      <p className={`truncate text-[13px] leading-tight ${typingNames.length > 0 || (otherInDm?.onlineStatus && !activeRoom.isGroup) ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
                        {headerStatus}
                        {typingNames.length > 0 && (
                          <span className="ml-1 inline-flex gap-0.5">
                            <span className="typing-dot" style={{ animationDelay: "0s" }} />
                            <span className="typing-dot" style={{ animationDelay: "0.15s" }} />
                            <span className="typing-dot" style={{ animationDelay: "0.3s" }} />
                          </span>
                        )}
                      </p>
                    </div>
                  </button>
                  {otherInDm && (
                    <>
                      <button
                        onClick={() =>
                          call.startCall(
                            { userId: userId(otherInDm), username: otherInDm.username, avatar: otherInDm.avatar },
                            "audio"
                          )
                        }
                        title="Voice call"
                        className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <path d="M4 5c0-1 1-2 2-2h2l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5V19c0 1-1 2-2 2A16 16 0 0 1 4 5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        onClick={() =>
                          call.startCall(
                            { userId: userId(otherInDm), username: otherInDm.username, avatar: otherInDm.avatar },
                            "video"
                          )
                        }
                        title="Video call"
                        className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                          <rect x="3" y="6" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
                          <path d="M15 10l6-3v10l-6-3" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </>
                  )}
                  <button onClick={() => setChatSearchOpen(true)} title="Search in conversation" className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                      <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </>
              )}
            </div>

            {/* Messages */}
            <div ref={viewportRef} onScroll={handleViewportScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-4 md:px-5">
              <div className="flex w-full flex-col gap-1">
                {hasMore && !loadingMessages && (
                  <div className="flex justify-center pb-2">
                    <button onClick={loadEarlier} disabled={loadingEarlier} className="rounded-full bg-[var(--panel)] px-4 py-1.5 text-[13px] font-medium text-[var(--accent)] shadow-sm transition-colors hover:bg-[var(--accent-soft)] disabled:opacity-60">
                      {loadingEarlier ? "Loading…" : "Load earlier messages"}
                    </button>
                  </div>
                )}
                {loadingMessages ? (
                  <p className="py-8 text-center text-sm text-[var(--text-secondary)]">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center py-16">
                    <span className="rounded-full px-4 py-1.5 text-sm text-white" style={{ background: "var(--pill)" }}>No messages here yet…</span>
                  </div>
                ) : (
                  messages.map((msg, i) => {
                    const mine = userId(msg.sender) === meId;
                    const prev = messages[i - 1];
                    const next = messages[i + 1];
                    const newDay = !prev || !sameDay(new Date(prev.timestamp), new Date(msg.timestamp));
                    const lastOfGroup = !next || userId(next.sender) !== userId(msg.sender) || !sameDay(new Date(next.timestamp), new Date(msg.timestamp));
                    const firstOfGroup = newDay || !prev || userId(prev.sender) !== userId(msg.sender);
                    const highlighted = highlightId === msg._id;

                    // Group reactions by emoji
                    const grouped: Record<string, { count: number; mine: boolean }> = {};
                    for (const r of msg.reactions ?? []) {
                      grouped[r.emoji] = grouped[r.emoji] ?? { count: 0, mine: false };
                      grouped[r.emoji].count++;
                      if (r.user === meId) grouped[r.emoji].mine = true;
                    }
                    const reactionChips = Object.entries(grouped);

                    return (
                      <div key={msg._id} data-mid={msg._id}>
                        {newDay && (
                          <div className="flex justify-center py-3">
                            <span className="rounded-full px-3 py-1 text-[13px] font-medium text-white" style={{ background: "var(--pill)" }}>{dateLabel(msg.timestamp)}</span>
                          </div>
                        )}
                        <div className={`group msg-in flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                          {!mine && (lastOfGroup ? <Avatar name={msg.sender.username} src={msg.sender.avatar} size={34} /> : <span className="w-[34px] shrink-0" />)}

                          {/* Options (all non-deleted messages) */}
                          {!msg.deleted && (
                            <div className={`relative self-center ${mine ? "order-first" : ""}`}>
                              <button onClick={() => setMenuFor(menuFor === msg._id ? null : msg._id)} className="rounded-full p-1 text-[var(--text-secondary)] opacity-0 transition-opacity hover:bg-[var(--bg-secondary)] group-hover:opacity-100" title="Message options">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
                              </button>
                              {menuFor === msg._id && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                                  <div className={`absolute z-20 mt-1 w-40 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-lg ${mine ? "right-0" : "left-0"}`}>
                                    <div className="flex justify-around border-b border-[var(--border)] px-1 py-1.5">
                                      {REACTION_EMOJIS.map((emoji) => (
                                        <button key={emoji} onClick={() => react(msg._id, emoji)} className="rounded-lg px-1 text-lg transition-transform hover:scale-125" title={`React ${emoji}`}>{emoji}</button>
                                      ))}
                                    </div>
                                    <button onClick={() => startReply(msg)} className="block w-full px-4 py-2 text-left text-sm hover:bg-[var(--bg-secondary)]">Reply</button>
                                    {mine && (
                                      <>
                                        <button onClick={() => startEdit(msg)} className="block w-full px-4 py-2 text-left text-sm hover:bg-[var(--bg-secondary)]">Edit</button>
                                        <button onClick={() => deleteMessage(msg._id)} className="block w-full px-4 py-2 text-left text-sm text-[var(--danger)] hover:bg-[var(--bg-secondary)]">Delete</button>
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          )}

                          <div className="flex flex-col" style={{ alignItems: mine ? "flex-end" : "flex-start" }}>
                            <div className={`relative max-w-[85%] px-2.5 py-1.5 shadow-sm transition-shadow sm:max-w-[70%] lg:max-w-[55%] ${mine ? "rounded-2xl bg-[var(--out-bubble)]" : "rounded-2xl bg-[var(--in-bubble)]"} ${lastOfGroup ? (mine ? "rounded-br-md" : "rounded-bl-md") : ""} ${highlighted ? "ring-2 ring-[var(--accent)]" : ""}`}>
                              {!mine && activeRoom.isGroup && firstOfGroup && !msg.deleted && (
                                <p className="px-1 text-[13px] font-medium text-[var(--accent)]">{msg.sender.username}</p>
                              )}

                              {/* Reply quote */}
                              {msg.replyTo && !msg.deleted && (
                                <button onClick={() => msg.replyTo && jumpToMessage({ _id: msg.replyTo._id, timestamp: msg.timestamp })} className="mb-1 flex w-full flex-col rounded-lg border-l-2 border-[var(--accent)] bg-black/5 px-2 py-1 text-left dark:bg-white/5">
                                  <span className="text-[12px] font-medium text-[var(--accent)]">{msg.replyTo.sender?.username ?? "Unknown"}</span>
                                  <span className="truncate text-[13px] text-[var(--text-secondary)]">{msg.replyTo.deleted ? "deleted message" : attachmentLabel(msg.replyTo)}</span>
                                </button>
                              )}

                              {/* Attachment */}
                              {msg.attachment && !msg.deleted && (
                                <div className="mb-1"><AttachmentView attachment={msg.attachment} /></div>
                              )}

                              {msg.deleted ? (
                                <p className="px-1 text-[15px] italic leading-snug text-[var(--text-secondary)]">🚫 This message was deleted<span className="inline-block w-12" /></p>
                              ) : msg.content ? (
                                <p className="whitespace-pre-wrap break-words px-1 text-[15px] leading-snug">{msg.content}<span className="inline-block w-16" /></p>
                              ) : null}

                              <span className="absolute bottom-1 right-2 flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                                {msg.edited && !msg.deleted && <span>edited</span>}
                                <span>{fmtMsgTime(msg.timestamp)}</span>
                                {mine && !msg.deleted && <Ticks msg={msg} room={activeRoom} meId={meId} />}
                              </span>
                            </div>

                            {/* Reaction chips */}
                            {reactionChips.length > 0 && (
                              <div className="mt-0.5 flex flex-wrap gap-1 px-1">
                                {reactionChips.map(([emoji, info]) => (
                                  <button key={emoji} onClick={() => react(msg._id, emoji)} className={`flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[12px] ${info.mine ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--border)] bg-[var(--panel)]"}`}>
                                    <span>{emoji}</span><span className="text-[var(--text-secondary)]">{info.count}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Composer */}
            <form onSubmit={handleSend} className="px-2 pb-3 md:px-5 md:pb-4">
              {replyingTo && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-[var(--accent)] bg-[var(--bg-secondary)] px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--accent)]">Replying to {userId(replyingTo.sender) === meId ? "yourself" : replyingTo.sender.username}</p>
                    <p className="truncate text-[13px] text-[var(--text-secondary)]">{attachmentLabel(replyingTo)}</p>
                  </div>
                  <button type="button" onClick={() => setReplyingTo(null)} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--border)]" title="Cancel reply">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                </div>
              )}
              {editing && (
                <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-[var(--accent)] bg-[var(--bg-secondary)] px-3 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-[var(--accent)]">Editing message</p>
                    <p className="truncate text-[13px] text-[var(--text-secondary)]">{editing.content}</p>
                  </div>
                  <button type="button" onClick={() => { setEditing(null); setDraft(""); }} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--border)]" title="Cancel">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                </div>
              )}
              {pendingAttachment && (
                <div className="mb-2 flex items-center gap-3 rounded-xl bg-[var(--bg-secondary)] px-3 py-2">
                  {pendingAttachment.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pendingAttachment.url} alt="" className="h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--accent)] text-white">📎</span>
                  )}
                  <p className="min-w-0 flex-1 truncate text-sm">{pendingAttachment.name}</p>
                  <button type="button" onClick={() => setPendingAttachment(null)} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--border)]" title="Remove attachment">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                  </button>
                </div>
              )}
              <div className="flex w-full items-center gap-2">
                {!editing && (
                  <>
                    <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingFile} title="Attach file" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] disabled:opacity-50">
                      {uploadingFile ? (
                        <span className="text-xs">…</span>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.5 3.5 0 1 1 5 5l-8 8a2 2 0 1 1-3-3l7.5-7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                    </button>
                  </>
                )}
                <input className="min-w-0 flex-1 rounded-2xl bg-[var(--field)] px-4 py-3 text-[15px] text-[var(--text)] shadow-sm outline-none placeholder:text-[var(--text-secondary)]" placeholder={editing ? "Edit your message" : "Message"} value={draft} onChange={(e) => handleDraftChange(e.target.value)} maxLength={2000} autoFocus={!!editing} />
                <button type="submit" disabled={!draft.trim() && !pendingAttachment} title={editing ? "Save" : "Send"} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow-sm transition-all hover:bg-[var(--accent-hover)] disabled:opacity-50">
                  {editing ? (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M5 12.5l4 4L19 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  ) : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="hidden flex-1 items-center justify-center md:flex">
            <span className="rounded-full px-4 py-1.5 text-sm text-white" style={{ background: "var(--pill)" }}>Select a chat to start messaging</span>
          </div>
        )}
      </main>

      {/* ================= Info panel ================= */}
      {activeRoom && showInfo && (
        <section className="fixed inset-0 z-40 flex w-full flex-col bg-[var(--panel)] md:static md:z-auto md:w-80 md:shrink-0 md:border-l md:border-[var(--border)] lg:w-96">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
            <h2 className="flex-1 text-[17px] font-semibold">{activeRoom.isGroup ? "Group info" : "User info"}</h2>
            <button onClick={() => setShowInfo(false)} title="Close" className="rounded-full p-2 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex flex-col items-center border-b border-[var(--border)] px-6 py-8">
              <Avatar name={displayName(activeRoom, meId)} src={roomAvatar(activeRoom, meId)} size={96} online={otherInDm ? otherInDm.onlineStatus : undefined} />
              <p className="mt-4 text-lg font-semibold">{displayName(activeRoom, meId)}</p>
              <p className={`mt-1 text-sm ${otherInDm?.onlineStatus ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
                {activeRoom.isGroup ? `${activeRoom.participants.length} members` : otherInDm?.onlineStatus ? "online" : lastSeenLabel(otherInDm?.lastSeen)}
              </p>
              {activeRoom.isGroup && (
                <button onClick={() => setShowGroupManage(true)} className="mt-4 rounded-xl bg-[var(--accent)] px-5 py-2 text-sm font-semibold text-white hover:bg-[var(--accent-hover)]">
                  {isAdmin(activeRoom, meId) ? "Manage group" : "Group settings"}
                </button>
              )}
            </div>
            {activeRoom.isGroup ? (
              <>
                <div className="border-b border-[var(--border)] px-6 py-4">
                  <p className="text-[13px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Description</p>
                  <p className="mt-1.5 text-[15px]">{activeRoom.description || "No description"}</p>
                </div>
                <div className="px-3 py-3">
                  <p className="px-3 pb-2 text-[13px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Members</p>
                  {activeRoom.participants.map((p) => {
                    const pid = userId(p);
                    const isMe = pid === meId;
                    return (
                      <button key={pid} disabled={isMe} onClick={() => openChatWith(p)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--bg-secondary)] disabled:cursor-default disabled:hover:bg-transparent" title={isMe ? undefined : `Message ${p.username}`}>
                        <Avatar name={p.username} src={p.avatar} size={40} online={p.onlineStatus} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[15px] font-medium">{p.username}{isMe && <span className="ml-1.5 text-xs font-normal text-[var(--text-secondary)]">(you)</span>}</p>
                          <p className="truncate text-[13px] text-[var(--text-secondary)]">{isAdmin(activeRoom, pid) ? "Admin" : p.bio || (p.onlineStatus ? "online" : lastSeenLabel(p.lastSeen))}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="border-b border-[var(--border)] px-6 py-4">
                <p className="text-[13px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">Bio</p>
                <p className="mt-1.5 whitespace-pre-wrap text-[15px]">{otherInDm?.bio || "No bio yet."}</p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ================= Settings ================= */}
      {showSettings && <SettingsModal me={me} onClose={() => setShowSettings(false)} onUpdated={handleProfileUpdated} />}

      {/* ================= Voice / video call ================= */}
      <CallOverlay call={call} />
      {call.error && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-3 rounded-xl bg-[var(--panel)] px-4 py-2.5 text-sm shadow-lg ring-1 ring-[var(--border)]">
          <span className="text-[var(--danger)]">{call.error}</span>
          <button onClick={call.clearError} className="text-[var(--text-secondary)] hover:text-[var(--text)]">
            Dismiss
          </button>
        </div>
      )}

      {/* ================= Group manage ================= */}
      {showGroupManage && activeRoom && activeRoom.isGroup && (
        <GroupManageModal
          room={activeRoom}
          me={me}
          socket={socket}
          onClose={() => setShowGroupManage(false)}
          onLeft={() => {
            setShowGroupManage(false);
            setShowInfo(false);
            setRooms((prev) => prev.filter((r) => r._id !== activeRoom._id));
            setActiveRoomId(null);
          }}
        />
      )}

      {/* ================= New chat by username ================= */}
      {showNewChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4" onClick={() => setShowNewChat(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-[var(--panel)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 text-lg font-semibold">New chat</h2>
            <p className="mb-4 text-sm text-[var(--text-secondary)]">Enter the username of the person you want to message.</p>
            <form onSubmit={startChatByUsername} className="space-y-3">
              <input className="w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20" placeholder="Username" value={newChatUsername} onChange={(e) => setNewChatUsername(e.target.value)} autoFocus />
              {newChatError && <p className="rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-[var(--danger)]">{newChatError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowNewChat(false)} className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">Cancel</button>
                <button type="submit" className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">Start chat</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= New group / community ================= */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-[var(--panel)] p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-4 text-lg font-semibold">
              New {createType === "community" ? "community" : "group"}
            </h2>
            <form onSubmit={handleCreate} className="space-y-3">
              {/* Type selector */}
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-[var(--bg-secondary)] p-1">
                {(["group", "community"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => setCreateType(t)} className={`rounded-lg py-1.5 text-sm font-medium capitalize transition-colors ${createType === t ? "bg-[var(--panel)] text-[var(--accent)] shadow-sm" : "text-[var(--text-secondary)]"}`}>
                    {t === "group" ? "👥 Group" : "🌐 Community"}
                  </button>
                ))}
              </div>
              <p className="text-[13px] text-[var(--text-secondary)]">
                {createType === "community"
                  ? "A community is public — anyone can find it and request to join, and you approve members."
                  : "A private group. Add members by their username."}
              </p>

              <input className="w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20" placeholder={createType === "community" ? "Community name" : "Group name"} value={createName} onChange={(e) => setCreateName(e.target.value)} required autoFocus />
              <textarea className="h-16 w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20" placeholder="Description (optional)" value={createDesc} onChange={(e) => setCreateDesc(e.target.value)} maxLength={200} />

              {/* Add members by username */}
              <div>
                <div className="flex gap-2">
                  <input className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]" placeholder="Add member by username" value={createMemberInput} onChange={(e) => setCreateMemberInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMemberByUsername(); } }} />
                  <button type="button" onClick={addMemberByUsername} className="shrink-0 rounded-xl border border-[var(--border)] px-3 text-sm font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]">Add</button>
                </div>
                {createMembers.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {createMembers.map((m) => (
                      <span key={userId(m)} className="flex items-center gap-1 rounded-full bg-[var(--accent-soft)] py-1 pl-1 pr-2 text-[13px] text-[var(--accent)]">
                        <Avatar name={m.username} src={m.avatar} size={20} />
                        {m.username}
                        <button type="button" onClick={() => setCreateMembers((prev) => prev.filter((x) => userId(x) !== userId(m)))} className="ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {createError && <p className="rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-[var(--danger)]">{createError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-xl px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]">Cancel</button>
                <button type="submit" className="rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
