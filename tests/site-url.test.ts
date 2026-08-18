/**
 * The magic link has to come back to an origin the mail client can reach.
 *
 * `emailRedirectTo` used to be built from `window.location.origin`, so a link
 * requested from a dev server pointed at `http://localhost:3000/auth/callback` —
 * dead on a phone, dead once the dev server stops. The default is now the
 * deployed app, with `NEXT_PUBLIC_SITE_URL` as the deliberate override.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const DEPLOYED = "https://focus-blue-psi.vercel.app";

/** The module reads `process.env` at call time, but import it fresh anyway. */
async function load(siteUrl: string | undefined) {
  vi.resetModules();
  if (siteUrl === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
  else process.env.NEXT_PUBLIC_SITE_URL = siteUrl;
  return import("@/lib/site-url");
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL;
});

describe("siteOrigin", () => {
  it("defaults to the deployed app, not localhost", async () => {
    const { siteOrigin } = await load(undefined);
    expect(siteOrigin()).toBe(DEPLOYED);
  });

  it("treats an empty or blank value as unset", async () => {
    expect((await load("")).siteOrigin()).toBe(DEPLOYED);
    expect((await load("   ")).siteOrigin()).toBe(DEPLOYED);
  });

  it("honours an explicit override, e.g. a local server", async () => {
    const { siteOrigin } = await load("http://localhost:3000");
    expect(siteOrigin()).toBe("http://localhost:3000");
  });

  it("strips trailing slashes so callers can append a path", async () => {
    const { siteOrigin } = await load(`${DEPLOYED}/`);
    expect(siteOrigin()).toBe(DEPLOYED);
  });
});

describe("authCallbackUrl", () => {
  it("is the deployed origin plus the one callback path", async () => {
    const { authCallbackUrl } = await load(undefined);
    expect(authCallbackUrl()).toBe(`${DEPLOYED}/auth/callback`);
  });

  it("never double-slashes when the override ends in one", async () => {
    const { authCallbackUrl } = await load("https://example.test/");
    expect(authCallbackUrl()).toBe("https://example.test/auth/callback");
  });
});
