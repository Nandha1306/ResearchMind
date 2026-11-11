import crypto from "node:crypto";
import mongoose from "mongoose";

/**
 * Integration tests need a real, DISPOSABLE MongoDB, given as TEST_MONGO_URI
 * (CI provides one as a service container). Each test file uses its own
 * randomly named database and drops only that database afterwards; nothing
 * else on the server is touched. Never point this at a database whose data
 * matters.
 *
 * Without TEST_MONGO_URI the integration tests are SKIPPED with this reason
 * (reported by the test runner), never silently passed.
 */
export const TEST_MONGO_URI = process.env.TEST_MONGO_URI;

// In CI the integration tests must run: a missing database is a pipeline
// misconfiguration, so fail loudly instead of reporting skipped suites.
if (process.env.CI && !TEST_MONGO_URI) {
  throw new Error("CI is set but TEST_MONGO_URI is not: integration tests would be skipped");
}
if (!TEST_MONGO_URI) {
  console.warn("[tests] TEST_MONGO_URI not set: MongoDB integration suites are SKIPPED");
}

export const mongoSkip: string | false = TEST_MONGO_URI
  ? false
  : "TEST_MONGO_URI is not set (integration test needs a disposable MongoDB)";

export const connectTestDatabase = async (label: string) => {
  if (!TEST_MONGO_URI) {
    throw new Error("TEST_MONGO_URI is not set");
  }
  const dbName = `rmtest_${label}_${crypto.randomBytes(4).toString("hex")}`;
  await mongoose.connect(TEST_MONGO_URI, { dbName, serverSelectionTimeoutMS: 5000 });

  return {
    dbName,
    cleanup: async () => {
      await mongoose.disconnect();
      // Drop through a dedicated connection: a test may have disconnected or
      // reconfigured the shared one deliberately (outage simulation).
      const admin = await mongoose
        .createConnection(TEST_MONGO_URI, { dbName, serverSelectionTimeoutMS: 5000 })
        .asPromise();
      try {
        await admin.dropDatabase();
      } finally {
        await admin.close();
      }
    },
  };
};
