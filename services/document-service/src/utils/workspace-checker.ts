import { Workspace } from "../../../workspace-service/src/models/Workspace";

/** Verify whether a user belongs to a specific workspace. */
export const checkWorkspaceMembership = async (
  workspaceId: string,
  userId: string,
  authHeader?: string
): Promise<boolean> => {
  const workspaceServiceUrl =
    process.env.WORKSPACE_SERVICE_URL || "http://127.0.0.1:5002";

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
      // Fall through to database check if service endpoint is unreachable
    }
  }

  try {
    const workspace = await Workspace.findOne({
      _id: workspaceId,
      members: userId,
    });
    return Boolean(workspace);
  } catch (err) {
    return false;
  }
};
