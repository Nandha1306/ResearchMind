import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

/** Hash a password before storing it in the database. */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/** Compare a plain password with a hashed password. */
export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};