import mongoose, { Document, Schema } from "mongoose";

/**
 * Represents a User document inside MongoDB.
 *
 * Extending Document gives us access to
 * MongoDB document methods and properties.
 */
export interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Defines the structure of the User collection.
 *
 * Each field contains validation rules
 * that MongoDB will enforce.
 */
const userSchema = new Schema<IUser>(
  {
    /**
     * User's display name.
     */
    name: {
      type: String,
      required: true,
      trim: true,
    },

    /**
     * User's email.
     *
     * Must be unique across the system.
     */
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },

    /**
     * Stores the hashed password.
     *
     * Never store plain text passwords.
     */
    password: {
      type: String,
      required: true,
    },

    /**
     * Optional profile image URL.
     *
     * Can be added later through profile settings.
     */
    avatar: {
      type: String,
      default: "",
    },
  },

  /**
   * Automatically adds:
   *
   * createdAt
   * updatedAt
   */
  {
    timestamps: true,
  }
);

/**
 * Creates the MongoDB model.
 *
 * Collection Name:
 * users
 */
export const User = mongoose.model<IUser>("User", userSchema);