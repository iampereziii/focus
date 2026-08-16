import type { MetadataRoute } from "next";

/**
 * PWA manifest — served at /manifest.webmanifest.
 *
 * Installable, ONLINE-ONLY (ADR-0002). Being installable is what gives the
 * push-only service worker somewhere to live; it does NOT imply offline. There
 * is no precache, no offline shell, no write queue. Writes fail loudly rather
 * than optimistically.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Focus",
    short_name: "Focus",
    description: "WHAT → WHY → FINISH LINE. One session at a time.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icons/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
