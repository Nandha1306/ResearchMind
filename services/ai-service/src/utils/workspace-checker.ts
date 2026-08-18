const workspaceServiceUrl =
  process.env.WORKSPACE_SERVICE_URL || "http://127.0.0.1:5002";

/** Verify whether an authenticated user belongs to a specific workspace. */
export const checkWorkspaceMembership = async (
  workspaceId: string,
  userId: string,
  authHeader?: string
): Promise<boolean> => {
  if (authHeader) {
    try {
      const res = await fetch(
        `${workspaceServiceUrl}/api/workspaces/${workspaceId}/membership`,
        {
          headers: {
            Authorization: authHeader,
          },
        }
      );

      if (res.ok) {
        const result = await res.json();
        if (result.success && typeof result.data?.isMember === "boolean") {
          return result.data.isMember;
        }
      }
    } catch (err) {
      console.warn("Workspace service HTTP membership check failed:", err);
    }
  }

  return false;
};
