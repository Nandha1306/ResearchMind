import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { applySafeConnectionDefaults } from "./infra-guard";

/*
 * Wave 6 (A-5, R10): every test file that imports this helper gets REDIS_URL
 * and MONGO_URI set to dead ports unless they already name a disposable
 * loopback target. A service module imported afterwards can then never fall
 * back to a developer's real Redis (6379) or MongoDB (27017); a REDIS_URL or
 * MONGO_URI that points there stops the test process (variable name only).
 */
applySafeConnectionDefaults();

/**
 * Set the secrets every service validates at import time. Must run BEFORE the
 * module under test is imported (use dynamic `await import()` in `before`).
 * Values are random per test process and satisfy requireSecret's rules.
 */
export const setTestSecrets = () => {
  process.env.JWT_ACCESS_SECRET ||= crypto.randomBytes(32).toString("hex");
  process.env.JWT_REFRESH_SECRET ||= crypto.randomBytes(32).toString("hex");
  process.env.INTERNAL_SERVICE_TOKEN ||= crypto.randomBytes(32).toString("hex");
};

/** Start a server on an ephemeral port; returns its base URL and a closer. */
export const listen = async (
  handler: http.RequestListener
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
};
