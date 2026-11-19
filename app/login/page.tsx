"use client";

import { useState } from "react";

/**
 * Laid out like Theatres. The field is a plain text box drawn as dots, not a password field, and
 * there's no form, so browsers have no password to offer to save or fill.
 */
export default function Login() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      <div className="login-form" role="group" aria-label="Unlock">
        <span className="wordmark">Operations</span>
        <input
          type="text"
          inputMode="text"
          className="login-input login-secret"
          placeholder="Password"
          name="op-unlock"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          data-1p-ignore=""
          data-lpignore="true"
          data-bwignore=""
          data-form-type="other"
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
        <button type="button" className="create" disabled={!password || busy} onClick={submit}>
          Sign in
        </button>
      </div>
    </main>
  );
}
