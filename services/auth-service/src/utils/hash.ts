import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

/** Hash a password before storing it in the database. */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * A fixed bcrypt hash with the SAME cost as real password hashes, of a random
 * string nobody knows (generated once and discarded). Comparing against it
 * makes a sign-in for an unknown e-mail take as long as a wrong password for
 * a real account, so response time does not reveal whether an account exists
 * (SEC-025 / SEC-009). If SALT_ROUNDS changes, regenerate it with that cost.
 */
const DUMMY_PASSWORD_HASH = "$2b$10$MvmxjoqD2UpFBZGG/PxzmeINpuKjdT1ZyY6U2H6JA9jE9A.mgfli6";

/** Spend the cost of one password check without a real hash; always false. */
export const comparePasswordForUnknownUser = async (password: string): Promise<false> => {
  await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
  return false;
};

/** Compare a plain password with a hashed password. */
export const comparePassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};