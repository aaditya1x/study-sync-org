export function readAuthCallback(href) {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  const isCallback = url.pathname === "/auth/callback";
  return {
    isCallback,
    code: isCallback ? url.searchParams.get("code") : null,
    isRecovery: isCallback && (url.searchParams.get("type") === "recovery" || hash.get("type") === "recovery"),
    error: url.searchParams.get("error_description") || hash.get("error_description") || "",
  };
}

export async function exchangeAuthCallbackCode(auth, code) {
  if (!auth || typeof auth.exchangeCodeForSession !== "function" || !code) {
    throw new Error("This verification link is invalid or has expired.");
  }
  const { data, error } = await auth.exchangeCodeForSession(code);
  if (error) throw error;
  if (!data?.session || !data?.user) throw new Error("This verification link is invalid or has expired.");
  return data;
}
