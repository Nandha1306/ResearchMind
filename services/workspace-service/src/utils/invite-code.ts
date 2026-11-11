import crypto from "crypto";

const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** Generate an 8-character cryptographic workspace invite code. */
export const generateInviteCode = (): string => {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return code;
};