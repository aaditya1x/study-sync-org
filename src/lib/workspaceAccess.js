export async function fetchPlatformRole(client, userId) {
  if (!client || !userId) throw new Error("A signed-in user is required to verify account access.");
  const { data, error } = await client
    .from("academic_staff")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.role || "student";
}

export function getWorkspaceAccess({
  authenticated,
  authLoading,
  roleLoading,
  roleError,
  role,
  profileLoading,
  profileError,
  profile,
}) {
  if (authLoading) return "auth-loading";
  if (!authenticated) return "login";
  if (roleLoading) return "role-loading";
  if (roleError) return "role-error";
  if (role === "super_admin") return "workspace";
  if (profileLoading) return "profile-loading";
  if (profileError) return "profile-error";
  if (!profile?.degree_id || !profile?.branch_id) return "onboarding";
  return "workspace";
}
