import { createClient } from "@supabase/supabase-js";

export async function checkActiveAccount({ url, publishableKey, token }) {
  const userClient = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await userClient.rpc("is_current_user_active");
  if (error) {
    const failure = new Error("Could not verify the account status.");
    failure.status = 503;
    throw failure;
  }
  if (data !== true) {
    const failure = new Error("This account is suspended. Contact a platform administrator.");
    failure.status = 403;
    throw failure;
  }
  return true;
}
