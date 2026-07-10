"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import Logo from "@/components/Logo";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("token");
    setToken(t);
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword: password }),
      });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-[var(--border)] bg-[var(--field)] px-4 py-3 text-[15px] text-[var(--text)] placeholder:text-[var(--text-secondary)] outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <main className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-5 rounded-[1.75rem] shadow-lg shadow-indigo-200">
            <Logo size={80} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text)]">
            {done ? "Password updated" : "Set a new password"}
          </h1>
        </div>

        {done ? (
          <div className="space-y-4 text-center">
            <p className="text-[15px] text-[var(--text-secondary)]">
              Your password has been reset. You can sign in with it now.
            </p>
            <button
              onClick={() => router.push("/")}
              className="w-full rounded-xl bg-[var(--accent)] py-3 text-[15px] font-semibold text-white hover:bg-[var(--accent-hover)]"
            >
              Go to sign in
            </button>
          </div>
        ) : token === null ? (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-[var(--danger)]">
            This reset link is missing its token. Please use the link from your email.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5">
            <input
              type="password"
              className={inputClass}
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <input
              type="password"
              className={inputClass}
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              minLength={6}
              required
            />
            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-[var(--danger)]">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[var(--accent)] py-3 text-[15px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {busy ? "Please wait…" : "Reset password"}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
