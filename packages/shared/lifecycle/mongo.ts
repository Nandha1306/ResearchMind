import mongoose from "mongoose";

/**
 * Shared MongoDB connection for every service.
 *
 * - Fails loudly when the URI is missing (variable NAME only, never the value).
 * - Is idempotent: a second call while connected/connecting reuses the
 *   existing connection instead of opening another one.
 * - Attaches lifecycle listeners exactly once, so disconnects and reconnects
 *   after startup are visible in the logs.
 *
 * Retry policy: a single bounded attempt. The driver keeps trying to select a
 * server for `serverSelectionTimeoutMS` (Mongoose default 30 s); if it still
 * cannot connect, the returned promise rejects and the caller decides what to
 * do (services exit non-zero). After a successful start the driver reconnects
 * on its own; health checks report the live state meanwhile.
 */
let listenersAttached = false;

const attachListeners = (serviceName: string) => {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on("disconnected", () => {
    console.warn(`[${serviceName}] MongoDB disconnected`);
  });
  mongoose.connection.on("reconnected", () => {
    console.log(`[${serviceName}] MongoDB reconnected`);
  });
  mongoose.connection.on("error", (error: Error) => {
    console.error(`[${serviceName}] MongoDB error: ${error?.message}`);
  });
};

/** Return the first configured env var among `names`, or undefined. */
export const resolveMongoUri = (
  ...names: string[]
): { name: string; uri: string } | undefined => {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) {
      return { name, uri: value };
    }
  }
  return undefined;
};

export const connectMongo = async (
  serviceName: string,
  uri: string | undefined,
  uriVarNames: string[] = ["MONGO_URI"]
): Promise<typeof mongoose> => {
  if (!uri || !uri.trim()) {
    throw new Error(
      `[${serviceName}] MongoDB is not configured: set ${uriVarNames.join(" or ")}`
    );
  }

  // 1 = connected, 2 = connecting: never open a second connection.
  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
  } else {
    await mongoose.connect(uri);
  }

  // Attached after the first successful connect so a failed initial attempt
  // is reported once (by the caller) rather than also as "disconnected".
  attachListeners(serviceName);
  return mongoose;
};

/** Close the shared connection (used by graceful shutdown). */
export const disconnectMongo = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};
