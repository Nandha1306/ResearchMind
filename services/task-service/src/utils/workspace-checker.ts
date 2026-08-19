/** Verify whether a user belongs to a specific workspace. */
export const checkWorkspaceMembership = async (
  workspaceId: string,
  userId: string,
  authHeader?: string
): Promise<boolean> => {
  const workspaceServiceUrl =
    process.env.WORKSPACE_SERVICE_URL ||
    "http://127.0.0.1:5002";

  if (!authHeader) {
    return false;
  }

  try {
    const response = await fetch(
      `${workspaceServiceUrl}/api/workspaces/${workspaceId}/membership`,
      {
        headers: {
          Authorization: authHeader,
        },
      }
    );

    if (!response.ok) {
      return false;
    }

    const result = await response.json();

    return (
      result.success === true &&
      result.data?.isMember === true
    );
  } catch (error) {
    return false;
  }
};