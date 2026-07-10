"use client";

import { useRef, useState } from "react";
import { API_URL, api, getToken } from "@/lib/api";
import { ChatSocket } from "@/lib/socket";
import { Room, User, isAdmin, userId } from "@/lib/types";
import Avatar from "./Avatar";

export default function GroupManageModal({
  room,
  me,
  socket,
  onClose,
  onLeft,
}: {
  room: Room;
  me: User;
  socket: ChatSocket | null;
  onClose: () => void;
  onLeft: () => void;
}) {
  const meId = userId(me);
  const iAmAdmin = isAdmin(room, meId);
  const kind = room.isCommunity ? "community" : "group";

  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [addOpen, setAddOpen] = useState(false);
  const [addUsername, setAddUsername] = useState("");
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function flashErr(res?: { ok: boolean; error?: string }) {
    if (!res?.ok) {
      setErr(res?.error || "Something went wrong");
      setTimeout(() => setErr(null), 2500);
    }
  }
  function showErr(msg: string) {
    setErr(msg);
    setTimeout(() => setErr(null), 2500);
  }

  function saveDetails() {
    socket?.emit(
      "group_update",
      { roomId: room._id, name: name.trim(), description: description.trim() },
      flashErr
    );
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const res = await fetch(`${API_URL}/api/rooms/${room._id}/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Upload failed");
    } catch (e) {
      showErr((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function addMemberByUsername() {
    const uname = addUsername.trim();
    if (!uname) return;
    try {
      const { user } = await api<{ user: User }>(
        `/api/rooms/users/lookup?username=${encodeURIComponent(uname)}`
      );
      socket?.emit(
        "group_add_members",
        { roomId: room._id, userIds: [userId(user)] },
        (res) => {
          flashErr(res);
          if (res.ok) {
            setAddUsername("");
            setAddOpen(false);
          }
        }
      );
    } catch (e) {
      showErr((e as Error).message);
    }
  }

  function removeMember(uid: string) {
    socket?.emit("group_remove_member", { roomId: room._id, userId: uid }, flashErr);
  }
  function setAdmin(uid: string, makeAdmin: boolean) {
    socket?.emit("group_set_admin", { roomId: room._id, userId: uid, isAdmin: makeAdmin }, flashErr);
  }
  function approveRequest(uid: string) {
    socket?.emit("community_approve", { roomId: room._id, userId: uid }, flashErr);
  }
  function rejectRequest(uid: string) {
    socket?.emit("community_reject", { roomId: room._id, userId: uid }, flashErr);
  }
  function leave() {
    socket?.emit("group_leave", room._id, (res) => {
      flashErr(res);
      if (res.ok) onLeft();
    });
  }

  const field =
    "w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";
  const requests = room.joinRequests ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] md:p-4" onClick={onClose}>
      <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--panel)] text-[var(--text)] md:h-auto md:max-h-[85vh] md:max-w-md md:rounded-2xl md:shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <button onClick={onClose} className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]" title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <h2 className="text-[17px] font-semibold capitalize">{kind} settings</h2>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {err && (
            <div className="mb-4 rounded-lg bg-red-500/10 px-4 py-2.5 text-sm text-[var(--danger)]">{err}</div>
          )}

          {/* Identity */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              <Avatar name={room.name} src={room.avatar} size={88} />
              {iAmAdmin && (
                <>
                  <button onClick={() => fileRef.current?.click()} disabled={uploading} title={`Change ${kind} photo`} className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow ring-2 ring-[var(--panel)] hover:bg-[var(--accent-hover)] disabled:opacity-60">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M4 8h3l1.5-2h7L17 8h3v11H4V8Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                    </svg>
                  </button>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAvatar(f); e.target.value = ""; }} />
                </>
              )}
            </div>
            {room.isCommunity && <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--accent)]">🌐 Public community</span>}
          </div>

          {/* Name & description */}
          <div className="mt-5 space-y-3">
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} disabled={!iAmAdmin} placeholder={`${kind} name`} />
            <textarea className={`${field} h-20 resize-none`} value={description} onChange={(e) => setDescription(e.target.value)} disabled={!iAmAdmin} placeholder={`${kind} description`} maxLength={200} />
            {iAmAdmin && (
              <button onClick={saveDetails} className="w-full rounded-xl bg-[var(--accent)] py-2.5 text-[15px] font-semibold text-white hover:bg-[var(--accent-hover)]">Save details</button>
            )}
          </div>

          {/* Join requests (communities) */}
          {room.isCommunity && iAmAdmin && requests.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 text-[13px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">
                {requests.length} join request{requests.length === 1 ? "" : "s"}
              </p>
              <div className="space-y-1">
                {requests.map((u) => (
                  <div key={userId(u)} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--bg-secondary)]">
                    <Avatar name={u.username} src={u.avatar} size={38} />
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{u.username}</span>
                    <button onClick={() => approveRequest(userId(u))} className="rounded-lg bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-white hover:bg-[var(--accent-hover)]">Approve</button>
                    <button onClick={() => rejectRequest(userId(u))} className="rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--danger)] hover:bg-red-500/10">Reject</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Members */}
          <div className="mt-6">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[13px] font-medium uppercase tracking-wide text-[var(--text-secondary)]">{room.participants.length} members</p>
              {iAmAdmin && (
                <button onClick={() => setAddOpen((v) => !v)} className="text-[13px] font-medium text-[var(--accent)]">{addOpen ? "Cancel" : "+ Add by username"}</button>
              )}
            </div>

            {addOpen && (
              <div className="mb-3 flex gap-2">
                <input className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)]" placeholder="Username" value={addUsername} onChange={(e) => setAddUsername(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addMemberByUsername(); } }} autoFocus />
                <button onClick={addMemberByUsername} className="shrink-0 rounded-xl bg-[var(--accent)] px-4 text-sm font-medium text-white hover:bg-[var(--accent-hover)]">Add</button>
              </div>
            )}

            <div className="space-y-1">
              {room.participants.map((p) => {
                const pid = userId(p);
                const pAdmin = isAdmin(room, pid);
                const isMe = pid === meId;
                return (
                  <div key={pid} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[var(--bg-secondary)]">
                    <Avatar name={p.username} src={p.avatar} size={40} online={p.onlineStatus} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium">
                        {p.username}
                        {isMe && <span className="ml-1.5 text-xs font-normal text-[var(--text-secondary)]">(you)</span>}
                      </p>
                      <p className="text-[13px] text-[var(--text-secondary)]">{pAdmin ? "Admin" : "Member"}</p>
                    </div>
                    {iAmAdmin && !isMe && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => setAdmin(pid, !pAdmin)} title={pAdmin ? "Dismiss as admin" : "Make admin"} className="rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--accent)] hover:bg-[var(--accent-soft)]">{pAdmin ? "Demote" : "Promote"}</button>
                        <button onClick={() => removeMember(pid)} title={`Remove from ${kind}`} className="rounded-lg px-2 py-1 text-[12px] font-medium text-[var(--danger)] hover:bg-red-500/10">Remove</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <button onClick={leave} className="mt-6 w-full rounded-xl border border-[var(--danger)] py-2.5 text-[15px] font-semibold capitalize text-[var(--danger)] hover:bg-red-500/10">Leave {kind}</button>
        </div>
      </div>
    </div>
  );
}
