import mongoose, { Schema } from "mongoose";

/**
 * Failed sign-in attempts per account (SEC-025).
 *
 * Keyed by a SHA-256 hash of the normalised e-mail, so the collection holds no
 * address, and a record exists for unknown e-mails exactly as for real ones
 * (no account enumeration). Records remove themselves through the TTL index
 * once neither the counting window nor a lock is active.
 */
export interface ILoginThrottle {
  key: string;
  failures: number;
  windowStart: Date;
  lockedUntil: Date | null;
  expiresAt: Date;
}

const loginThrottleSchema = new Schema<ILoginThrottle>(
  {
    key: { type: String, required: true, unique: true },
    failures: { type: Number, required: true, default: 0 },
    windowStart: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

loginThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginThrottle = mongoose.model<ILoginThrottle>("LoginThrottle", loginThrottleSchema);
