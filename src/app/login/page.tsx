"use client";

/**
 * `/login` — the only unauthenticated route.
 *
 * Magic link, single user, no roles, no sign-up. This app is explicitly NOT
 * multi-tenant: RLS uses `auth.uid() IS NOT NULL` and no table has an owner
 * column, so a second user would read the first user's rows. Adding one is a
 * migration and an ADR, not a setting.
 */

import { useState } from "react";
import { sendMagicLink } from "@/lib/store/auth";
import { Button, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      await sendMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the link.");
    }
  }

  return (
    <main className="mx-auto max-w-sm space-y-4 p-8">
      <h1 className="text-2xl font-semibold">Focus</h1>
      <p className="text-sm opacity-70">WHAT → WHY → FINISH LINE. One session at a time.</p>

      {sent ? (
        <p className="text-sm">Check your email for the link.</p>
      ) : (
        <>
          <Field label="Email">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submit();
              }}
            />
          </Field>
          {error !== null && <p className="text-xs text-red-600">{error}</p>}
          <Button className="w-full" onClick={() => void submit()} disabled={email.trim() === ""}>
            Send magic link
          </Button>
        </>
      )}
    </main>
  );
}
