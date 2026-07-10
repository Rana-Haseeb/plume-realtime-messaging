/**
 * Desktop notifications + a synthesized "ping" sound for incoming messages.
 * Preferences are stored in localStorage and toggled from Settings.
 */

const SETTINGS_KEY = "nexchat_notifications";

export interface NotificationPrefs {
  desktop: boolean;
  sound: boolean;
}

export function getNotificationPrefs(): NotificationPrefs {
  if (typeof window === "undefined") return { desktop: true, sound: true };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { desktop: true, sound: true, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { desktop: true, sound: true };
}

export function setNotificationPrefs(prefs: NotificationPrefs) {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
}

export function notificationPermission(): NotificationPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

export function showDesktopNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!getNotificationPrefs().desktop) return;
  try {
    const n = new Notification(title, { body, tag: "nexchat-message" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* some browsers require a service worker; fail silently */
  }
}

let audioCtx: AudioContext | null = null;

/** A short two-note "ping" via the Web Audio API — no asset file needed. */
export function playPing() {
  if (typeof window === "undefined") return;
  if (!getNotificationPrefs().sound) return;
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    audioCtx = audioCtx ?? new Ctx();
    const ctx = audioCtx;
    const now = ctx.currentTime;

    const play = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.18, now + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur);
    };

    play(660, 0, 0.14);
    play(880, 0.12, 0.16);
  } catch {
    /* audio not available */
  }
}
