"use client";

import { useState } from "react";

/**
 * Type the password and press Enter. There's no form, the field is read-only until touched and is
 * marked for password managers to skip, so browsers don't offer to save or fill it.
 */
export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      cache: "no-store",
    });
    setPassword("");
    if (res.ok) {
      window.location.replace("/");
      return;
    }
    setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't sign in");
    setBusy(false);
  };

  return (
    <main className="login">
      <div className="login-form">
        <span className="wordmark">Operations</span>
        <input
          type="password"
          className="login-input"
          placeholder="Password, then Enter"
          name="op-unlock"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          data-1p-ignore=""
          data-lpignore="true"
          data-form-type="other"
          readOnly={!armed}
          onFocus={() => setArmed(true)}
          onPointerDown={() => setArmed(true)}
          autoFocus
          disabled={busy}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          aria-label="Password"
        />
        {error && <p className="login-error">{error}</p>}
        <p className="hint">Locks after 10 minutes without use.</p>
      </div>
    </main>
  );
}
