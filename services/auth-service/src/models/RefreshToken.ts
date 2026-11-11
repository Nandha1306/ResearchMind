import mongoose, { Document, Schema } from "mongoose";

/**
 * Represents a refresh token document.
 *
 * Each login session gets its own refresh token.
 * Stores SHA-256 hash of the refresh token string for security.
 */
export interface IRefreshToken extends Document {
  userId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  rotatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Schema definition for refresh tokens.
 */
const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    /**
     * Reference to the user that owns this token.
     */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /**
     * SHA-256 hash of the refresh token string.
     */
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    /**
     * Expiration date of the refresh token.
     */
    expiresAt: {
      type: Date,
      required: true,
    },

    /**
     * Set atomically when this token is exchanged for a new pair. A rotated
     * token is kept only for a short grace window (its expiresAt is shortened)
     * so a concurrent refresh of the same token can be told apart from theft.
     * Documents created before this field existed have no value, which
     * matches `rotatedAt: null` queries, so they rotate normally.
     */
    rotatedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * Automatically remove expired refresh tokens via MongoDB TTL Index.
 */
refreshTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

export const RefreshToken = mongoose.model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema
);