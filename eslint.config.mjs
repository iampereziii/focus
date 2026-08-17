import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * ADR-0002 GUARDRAILS — these are not style rules.
 *
 * Two constraints carry the whole "we can add offline later, cheaply" argument
 * (project spec, Stack + Conventions #5; repo CLAUDE.md, How to Engage #3):
 *
 *   (a) The Supabase client cannot be imported outside `src/lib/store/`.
 *       `lib/store/` is the SINGLE write path. It is the seam a local write
 *       queue would be added behind, without touching a single component.
 *
 *   (b) `public/sw.js` cannot register a `fetch` handler.
 *       The service worker is PUSH-ONLY — `push` + `notificationclick`, and
 *       nothing else. A `fetch` handler is not a caching win; it is a reversal
 *       of ADR-0002.
 *
 * Both fail the build. NEVER `eslint-disable` either one to unblock a task.
 * The likeliest way they break is an obviously-trivial one-liner added under
 * time pressure. If a task appears to require breaking one, stop and raise it
 * as an ADR question in the `ais` repo.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  {
    // `const { field: _omitted, ...rest } = obj` is the idiomatic way to build a
    // "missing that field" fixture in the validator tests.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },

  // ── Guardrail (a): the Supabase client is reachable from `lib/store/` only ──
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              message:
                "ADR-0002: create the Supabase client only in src/lib/supabase/. Everything else goes through src/lib/store/.",
            },
          ],
          patterns: [
            {
              group: ["@/lib/supabase", "@/lib/supabase/*", "**/lib/supabase/*"],
              message:
                "ADR-0002: all DB access goes through src/lib/store/ — the single write path. Do not reach for the Supabase client directly. This is the seam offline sync would be added behind; bypassing it voids the deferral.",
            },
          ],
        },
      ],
    },
  },
  {
    // The client factories themselves, the one module allowed to consume them,
    // and `src/proxy.ts` (Next.js 16's replacement for `middleware.ts`) — the
    // sole exception (feature-brief-cookie-session-ssr-swap.md): a Route Handler
    // / Server Component can't refresh a session cookie itself, only the proxy,
    // running ahead of every request, can. This is a deliberate, reviewed
    // widening of guardrail (a), not a bypass — it still only reads who is
    // signed in; `lib/store/` stays the only data-access path.
    files: ["src/lib/supabase/**/*.ts", "src/lib/store/**/*.ts", "src/proxy.ts"],
    rules: { "no-restricted-imports": "off" },
  },

  // ── Guardrail (b): the service worker never gains a `fetch` handler ──
  {
    files: ["public/sw.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        self: "readonly",
        clients: "readonly",
        registration: "readonly",
        caches: "readonly",
        fetch: "readonly",
        Notification: "readonly",
      },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='addEventListener'][arguments.0.value='fetch']",
          message:
            "ADR-0002: public/sw.js is PUSH-ONLY. A `fetch` handler reverses the online-only decision — that needs a new ADR, not a commit.",
        },
        {
          selector:
            "CallExpression[callee.name='addEventListener'][arguments.0.value='fetch']",
          message:
            "ADR-0002: public/sw.js is PUSH-ONLY. A `fetch` handler reverses the online-only decision — that needs a new ADR, not a commit.",
        },
        {
          selector: "AssignmentExpression[left.property.name='onfetch']",
          message:
            "ADR-0002: public/sw.js is PUSH-ONLY. `onfetch` is a `fetch` handler by another name — same reversal, same ADR requirement.",
        },
        {
          selector: "MemberExpression[property.name='caches']",
          message:
            "ADR-0002: no precache, no offline shell, no read cache in v1. The service worker exists to fire Rules 18 and 26 and nothing else.",
        },
      ],
    },
  },
]);

export default eslintConfig;
