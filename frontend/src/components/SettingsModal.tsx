"use client";

import { useRef, useState } from "react";
import { API_URL, api, getToken } from "@/lib/api";
import { User } from "@/lib/types";
import {
  Theme,
  getStoredTheme,
  setTheme as persistTheme,
} from "@/lib/theme";
import {
  Wallpaper,
  WALLPAPERS,
  getStoredWallpaper,
  setWallpaper as persistWallpaper,
} from "@/lib/wallpaper";
import {
  NotificationPrefs,
  getNotificationPrefs,
  notificationPermission,
  requestNotificationPermission,
  setNotificationPrefs,
} from "@/lib/notifications";
import Avatar from "./Avatar";
import Logo from "./Logo";

type Section =
  | "account"
  | "privacy"
  | "security"
  | "chats"
  | "notifications"
  | "help";

const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  {
    id: "account",
    label: "Account",
    icon: (
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4 0-7 2-7 5v1h14v-1c0-3-3-5-7-5Z"
        fill="currentColor"
      />
    ),
  },
  {
    id: "privacy",
    label: "Privacy",
    icon: (
      <path
        d="M12 3 5 6v5c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Z"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: "security",
    label: "Security",
    icon: (
      <path
        d="M6 10V8a6 6 0 0 1 12 0v2m-13 0h14v10H5V10Z"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: "chats",
    label: "Chats",
    icon: (
      <path
        d="M4 5h16v11H8l-4 4V5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: (
      <path
        d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Zm4 9a2 2 0 0 0 4 0"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="none"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: "help",
    label: "Help",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" fill="none" />
        <path
          d="M9.5 9.5a2.5 2.5 0 0 1 4 2c0 1.5-2 1.7-2 3M12 17h.01"
          stroke="currentColor"
          strokeWidth="1.7"
          fill="none"
          strokeLinecap="round"
        />
      </>
    ),
  },
];

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? "bg-[var(--accent)]" : "bg-gray-300 dark:bg-gray-600"
      }`}
      style={{ backgroundColor: checked ? "var(--accent)" : "var(--border)" }}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Row({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="text-[15px] font-medium">{title}</p>
        {subtitle && (
          <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export default function SettingsModal({
  me,
  onClose,
  onUpdated,
}: {
  me: User;
  onClose: () => void;
  onUpdated: (user: User) => void;
}) {
  const [section, setSection] = useState<Section>("account");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  // Account
  const [username, setUsername] = useState(me.username);
  const [bio, setBio] = useState(me.bio ?? "");
  const [savingAccount, setSavingAccount] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Privacy
  const [lastSeenVisible, setLastSeenVisible] = useState(
    me.lastSeenVisible !== false
  );
  const [readReceipts, setReadReceipts] = useState(me.readReceipts !== false);

  // Security
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  // Chats (theme)
  const [theme, setThemeState] = useState<Theme>(getStoredTheme());
  const [wallpaper, setWallpaperState] = useState<Wallpaper>(getStoredWallpaper());

  // Notifications
  const [notif, setNotif] = useState<NotificationPrefs>(getNotificationPrefs());
  const [perm, setPerm] = useState(notificationPermission());

  function flash(kind: "ok" | "err", text: string) {
    setMsg({ kind, text });
    setTimeout(() => setMsg(null), 2500);
  }

  async function saveAccount() {
    setSavingAccount(true);
    try {
      const data = await api<{ user: User }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify({ username: username.trim(), bio }),
      });
      onUpdated(data.user);
      flash("ok", "Profile saved");
    } catch (err) {
      flash("err", (err as Error).message);
    } finally {
      setSavingAccount(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const res = await fetch(`${API_URL}/api/auth/me/avatar`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Upload failed");
      onUpdated(body.user);
      flash("ok", "Photo updated");
    } catch (err) {
      flash("err", (err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function savePrivacy(patch: Partial<User>) {
    try {
      const data = await api<{ user: User }>("/api/auth/me", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      onUpdated(data.user);
    } catch (err) {
      flash("err", (err as Error).message);
    }
  }

  async function changePassword() {
    if (newPw.length < 6) {
      flash("err", "New password must be at least 6 characters");
      return;
    }
    setSavingPw(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      setCurrentPw("");
      setNewPw("");
      flash("ok", "Password changed");
    } catch (err) {
      flash("err", (err as Error).message);
    } finally {
      setSavingPw(false);
    }
  }

  function changeWallpaper(w: Wallpaper) {
    setWallpaperState(w);
    persistWallpaper(w);
  }

  function changeTheme(t: Theme) {
    setThemeState(t);
    persistTheme(t);
  }

  async function toggleDesktop(v: boolean) {
    if (v) {
      const p = await requestNotificationPermission();
      setPerm(p);
      if (p !== "granted") {
        flash("err", "Enable notifications in your browser settings");
        return;
      }
    }
    const next = { ...notif, desktop: v };
    setNotif(next);
    setNotificationPrefs(next);
  }

  function toggleSound(v: boolean) {
    const next = { ...notif, sound: v };
    setNotif(next);
    setNotificationPrefs(next);
  }

  const field =
    "w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] md:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col overflow-hidden bg-[var(--panel)] text-[var(--text)] md:h-[80vh] md:max-h-[640px] md:max-w-3xl md:flex-row md:rounded-2xl md:shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Section nav */}
        <nav className="flex shrink-0 flex-col border-b border-[var(--border)] md:w-56 md:border-b-0 md:border-r">
          <div className="flex items-center gap-2 px-4 py-4">
            <button
              onClick={onClose}
              className="rounded-full p-1.5 text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
              title="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M6 6l12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <h2 className="text-[17px] font-semibold">Settings</h2>
          </div>
          <div className="flex overflow-x-auto md:flex-col md:overflow-visible">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex shrink-0 items-center gap-3 px-4 py-3 text-left text-[15px] transition-colors ${
                  section === s.id
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] md:border-l-2 md:border-[var(--accent)]"
                    : "text-[var(--text)] hover:bg-[var(--bg-secondary)]"
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
                  {s.icon}
                </svg>
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        {/* Section content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {msg && (
            <div
              className={`mb-4 rounded-lg px-4 py-2.5 text-sm ${
                msg.kind === "ok"
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "bg-red-500/10 text-[var(--danger)]"
              }`}
            >
              {msg.text}
            </div>
          )}

          {section === "account" && (
            <div className="space-y-6">
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <Avatar name={me.username} src={me.avatar} size={100} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={uploading}
                    title="Change photo"
                    className="absolute bottom-0 right-0 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--accent)] text-white shadow ring-2 ring-[var(--panel)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        d="M4 8h3l1.5-2h7L17 8h3v11H4V8Zm8 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadAvatar(f);
                      e.target.value = "";
                    }}
                  />
                </div>
                <p className="text-[13px] text-[var(--text-secondary)]">
                  {uploading ? "Uploading…" : "Tap the camera to change your photo"}
                </p>
              </div>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[var(--text-secondary)]">
                  Username
                </span>
                <input
                  className={field}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  minLength={3}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[var(--text-secondary)]">
                  Email
                </span>
                <input
                  className={`${field} cursor-not-allowed opacity-60`}
                  value={me.email ?? ""}
                  disabled
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-[var(--text-secondary)]">
                  Bio
                </span>
                <textarea
                  className={`${field} h-24 resize-none`}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={300}
                  placeholder="Tell people a little about yourself…"
                />
                <span className="mt-1 block text-right text-xs text-[var(--text-secondary)]">
                  {bio.length}/300
                </span>
              </label>

              <button
                onClick={saveAccount}
                disabled={savingAccount}
                className="w-full rounded-xl bg-[var(--accent)] py-2.5 text-[15px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {savingAccount ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}

          {section === "privacy" && (
            <div className="divide-y divide-[var(--border)]">
              <Row
                title="Last seen & online"
                subtitle="If turned off, you won't see other people's last seen either."
              >
                <Toggle
                  checked={lastSeenVisible}
                  onChange={(v) => {
                    setLastSeenVisible(v);
                    savePrivacy({ lastSeenVisible: v });
                  }}
                />
              </Row>
              <Row
                title="Read receipts"
                subtitle="If turned off, others won't see the blue read ticks from you."
              >
                <Toggle
                  checked={readReceipts}
                  onChange={(v) => {
                    setReadReceipts(v);
                    savePrivacy({ readReceipts: v });
                  }}
                />
              </Row>
            </div>
          )}

          {section === "security" && (
            <div className="space-y-4">
              <p className="text-[13px] text-[var(--text-secondary)]">
                Change your password. You&apos;ll stay signed in on this device.
              </p>
              <input
                type="password"
                className={field}
                placeholder="Current password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
              />
              <input
                type="password"
                className={field}
                placeholder="New password (min. 6 characters)"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
              <button
                onClick={changePassword}
                disabled={savingPw || !currentPw || !newPw}
                className="w-full rounded-xl bg-[var(--accent)] py-2.5 text-[15px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {savingPw ? "Updating…" : "Change password"}
              </button>
            </div>
          )}

          {section === "chats" && (
            <div className="space-y-4">
              <p className="text-[13px] font-medium text-[var(--text-secondary)]">
                Theme
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(["light", "dark"] as Theme[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => changeTheme(t)}
                    className={`flex flex-col items-center gap-3 rounded-2xl border-2 p-4 transition-colors ${
                      theme === t
                        ? "border-[var(--accent)]"
                        : "border-[var(--border)] hover:border-[var(--text-secondary)]"
                    }`}
                  >
                    <div
                      className="h-16 w-full rounded-lg border border-[var(--border)]"
                      style={{
                        background:
                          t === "light"
                            ? "linear-gradient(135deg,#ffffff 55%,#ebecf4 55%)"
                            : "linear-gradient(135deg,#17181c 55%,#0c0d11 55%)",
                      }}
                    />
                    <span className="text-[15px] font-medium capitalize">
                      {t}
                      {theme === t && (
                        <span className="ml-1.5 text-[var(--accent)]">✓</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>

              <p className="pt-3 text-[13px] font-medium text-[var(--text-secondary)]">
                Chat wallpaper
              </p>
              <div className="grid grid-cols-2 gap-3">
                {WALLPAPERS.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => changeWallpaper(w.id)}
                    className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-3 transition-colors ${
                      wallpaper === w.id
                        ? "border-[var(--accent)]"
                        : "border-[var(--border)] hover:border-[var(--text-secondary)]"
                    }`}
                  >
                    <div
                      className="flex h-14 w-full items-center justify-center rounded-lg border border-[var(--border)] text-xl"
                      style={
                        w.id === "dots"
                          ? {
                              backgroundColor: "var(--chat-bg)",
                              backgroundImage:
                                "radial-gradient(rgba(122,129,153,0.35) 1.5px, transparent 1.5px)",
                              backgroundSize: "10px 10px",
                            }
                          : w.id === "geometric"
                            ? {
                                backgroundColor: "var(--chat-bg)",
                                backgroundImage:
                                  "repeating-linear-gradient(45deg, rgba(122,129,153,0.25) 0 1px, transparent 1px 10px)",
                              }
                            : { backgroundColor: "var(--chat-bg)" }
                      }
                    >
                      {w.id === "doodles" ? "🪶" : ""}
                    </div>
                    <span className="text-[14px] font-medium">
                      {w.label}
                      {wallpaper === w.id && (
                        <span className="ml-1.5 text-[var(--accent)]">✓</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {section === "notifications" && (
            <div className="divide-y divide-[var(--border)]">
              <Row
                title="Desktop notifications"
                subtitle={
                  perm === "denied"
                    ? "Blocked in your browser — enable it in site settings."
                    : "Show a notification when a message arrives and the tab is hidden."
                }
              >
                <Toggle
                  checked={notif.desktop && perm === "granted"}
                  onChange={toggleDesktop}
                />
              </Row>
              <Row
                title="Notification sound"
                subtitle="Play a sound for new messages while the tab is in the background."
              >
                <Toggle checked={notif.sound} onChange={toggleSound} />
              </Row>
            </div>
          )}

          {section === "help" && (
            <div className="space-y-3 text-[15px]">
              <div className="flex items-center gap-3">
                <Logo size={44} />
                <h3 className="text-lg font-semibold">Plume</h3>
              </div>
              <p className="text-[var(--text-secondary)]">
                A real-time messaging app built with Next.js, Express, Socket.io
                and MongoDB.
              </p>
              <p className="text-[var(--text-secondary)]">
                Messages are delivered instantly, show sent / delivered / read
                ticks, and everything syncs live across your devices.
              </p>
              <p className="pt-2 text-[13px] text-[var(--text-secondary)]">
                Version 1.0.0 · NexSoft Solutions
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
