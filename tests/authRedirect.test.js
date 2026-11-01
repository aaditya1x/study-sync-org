import test from "node:test";
import assert from "node:assert/strict";
import { getAuthCallbackUrl } from "../src/lib/authRedirect.js";
import { exchangeAuthCallbackCode, readAuthCallback } from "../src/lib/authCallback.js";

test("development signup and recovery redirects use the origin actually serving the app", () => {
  assert.equal(getAuthCallbackUrl({
    configuredSiteUrl: "http://127.0.0.1:3000",
    currentOrigin: "http://localhost:5173",
  }), "http://localhost:5173/auth/callback");
  assert.equal(getAuthCallbackUrl({
    configuredSiteUrl: "https://study-sync.example.com",
    currentOrigin: "http://127.0.0.1:4173",
  }), "http://127.0.0.1:4173/auth/callback");
});

test("production redirects use a valid configured HTTPS app URL", () => {
  assert.equal(getAuthCallbackUrl({
    configuredSiteUrl: "https://study-sync.vercel.app/some/path/",
    currentOrigin: "https://study-sync-preview.vercel.app",
    production: true,
  }), "https://study-sync.vercel.app/auth/callback");
});

test("production ignores a localhost configuration and uses the deployed HTTPS origin", () => {
  assert.equal(getAuthCallbackUrl({
    configuredSiteUrl: "http://127.0.0.1:3000",
    currentOrigin: "https://study-sync-preview.vercel.app",
    production: true,
  }), "https://study-sync-preview.vercel.app/auth/callback");
});

test("production refuses to create a localhost or invalid redirect when no deployed origin exists", () => {
  assert.throws(() => getAuthCallbackUrl({
    configuredSiteUrl: "http://127.0.0.1:3000",
    currentOrigin: "http://localhost:5173",
    production: true,
  }), /deployed HTTPS app URL/);
  assert.throws(() => getAuthCallbackUrl({ currentOrigin: "", production: true }), /deployed HTTPS app URL/);
});

test("confirmation callback recognizes the PKCE code route and recovery links", () => {
  assert.deepEqual(readAuthCallback("https://study-sync.vercel.app/auth/callback?code=one-time-code"), {
    isCallback: true, code: "one-time-code", isRecovery: false, error: "",
  });
  assert.equal(readAuthCallback("https://study-sync.vercel.app/auth/callback#type=recovery").isRecovery, true);
  assert.equal(readAuthCallback("https://study-sync.vercel.app/").code, null);
});

test("callback exchanges the PKCE code and requires a created session", async () => {
  let exchangedCode = "";
  const session = { access_token: "test-session-token" };
  const user = { id: "verified-user" };
  const result = await exchangeAuthCallbackCode({
    exchangeCodeForSession: async (code) => {
      exchangedCode = code;
      return { data: { session, user }, error: null };
    },
  }, "one-time-code");
  assert.equal(exchangedCode, "one-time-code");
  assert.deepEqual(result, { session, user });
  await assert.rejects(exchangeAuthCallbackCode({ exchangeCodeForSession: async () => ({ data: {}, error: null }) }, "expired-code"), /invalid or has expired/);
  await assert.rejects(exchangeAuthCallbackCode({ exchangeCodeForSession: async () => ({ data: null, error: new Error("exchange failed") }) }, "bad-code"), /exchange failed/);
});
