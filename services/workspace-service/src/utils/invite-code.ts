/** Generate a workspace invite code. */
export const generateInviteCode = (): string => {
  return Math.random()
    .toString(36)
    .substring(2, 10)
    .toUpperCase();
};