import mongoose, { Document, Schema } from "mongoose";

/**
 * Represents a refresh token document.
 *
 * Each login session gets its own refresh token.
 * This allows:
 * - Logout
 * - Session management
 * - Token revocation
 */
export interface IRefreshToken extends Document {
  userId: mongoose.Types.ObjectId;
  token: string;
  expiresAt: Date;
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
    },

    /**
     * The actual refresh token string.
     *
     * Later we can store a hashed version
     * for additional security.
     */
    token: {
      type: String,
      required: true,
    },

    /**
     * Expiration date of the refresh token.
     */
    expiresAt: {
      type: Date,
      required: true,
    },
  },

  {
    timestamps: true,
  }
);

/**
 * Automatically remove expired refresh tokens.
 *
 * MongoDB TTL Index:
 * When expiresAt passes, MongoDB deletes
 * the document automatically.
 */
refreshTokenSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0 }
);

/**
 * MongoDB collection:
 * refreshtokens
 */
export const RefreshToken = mongoose.model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema
);