import { SessionSkeleton } from "@/components/session/SessionSkeleton";

/**
 * Shown the moment a tap navigates here, while `page.tsx` reads the session on the
 * server. Without it the screen would sit on the previous page until the whole
 * server render finished — the 100 ms tap-feedback budget needs something on
 * screen straight away.
 */
export default function Loading() {
  return <SessionSkeleton />;
}
