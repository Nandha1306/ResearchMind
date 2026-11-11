/**
 * Centralised validation for security-critical environment variables.
 *
 * Security secrets must never fall back to a literal. A service that boots with
 * a default signing key is silently unauthenticated: anyone who knows the
 * default -- and defaults end up in READMEs, onboarding docs and git history --
 * can mint tokens for any user.
 *
 * Every accessor here fails closed and, critically, never includes the VALUE of
 * a secret in an error message or log line. Only the variable NAME is reported.
 */

/** Minimum length for an HMAC signing secret. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Values that must never be accepted as a secret.
 *
 * Includes the literals this repository previously used as fallbacks: they were
 * published in four service READMEs and in docs/onboarding.md, so they must be
 * treated as permanently compromised.
 */
const KNOWN_INSECURE_SECRETS = new Set(
  [
    "researchmind_access_secret",
    "researchmind_refresh_secret",
    "secret",
    "secretkey",
    "secret_key",
    "jwt-secret",
    "jwtsecret",
    "jwt_secret",
    "password",
    "passw0rd",
    "123456",
    "12345678",
    "changeme",
    "change-me",
    "changethis",
    "development",
    "dev",
    "test",
    "testing",
    "default",
    "example",
    "placeholder",
    "mysecret",
    "topsecret",
    "admin",
    "root",
  ].map((v) => v.toLowerCase())
);

/** True when the value is a placeholder of the `<...>` form used in .env.example. */
const isPlaceholder = (value: string): boolean =>
  /^<.*>$/.test(value.trim());

export class SecretConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretConfigurationError";
  }
}

interface RequireSecretOptions {
  /**
   * Minimum accepted length. Defaults to MIN_SECRET_LENGTH.
   * Lower it only for values that are not signing keys.
   */
  minLength?: number;
}

/**
 * Read a required secret from the environment, or throw.
 *
 * The thrown message names the variable so an operator can fix it, and never
 * contains the value, so it is safe to log or surface in a crash trace.
 */
export const requireSecret = (
  name: string,
  options: RequireSecretOptions = {}
): string => {
  const minLength =
    options.minLength ?? MIN_SECRET_LENGTH;

  const raw = process.env[name];

  if (raw === undefined || raw.trim().length === 0) {
    throw new SecretConfigurationError(
      `${name} is not configured. Set it to a high-entropy random value ` +
        `(for example: openssl rand -hex 32).`
    );
  }

  const value = raw.trim();

  if (isPlaceholder(value)) {
    throw new SecretConfigurationError(
      `${name} is still set to a placeholder from .env.example. ` +
        `Replace it with a real high-entropy value.`
    );
  }

  if (KNOWN_INSECURE_SECRETS.has(value.toLowerCase())) {
    throw new SecretConfigurationError(
      `${name} is set to a known-insecure value. Replace it with a ` +
        `high-entropy random value (for example: openssl rand -hex 32).`
    );
  }

  if (value.length < minLength) {
    throw new SecretConfigurationError(
      `${name} must be at least ${minLength} characters (got ${value.length}).`
    );
  }

  return value;
};

/**
 * Validate a set of required secrets at startup and exit if any is unusable.
 *
 * Intended for a service entrypoint: it is better to refuse to boot than to
 * serve traffic with a weak or missing signing key.
 */
export const assertRequiredSecrets = (
  serviceName: string,
  names: string[]
): void => {
  const problems: string[] = [];

  for (const name of names) {
    try {
      requireSecret(name);
    } catch (error) {
      problems.push(
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  if (problems.length > 0) {
    // Variable names only -- never values.
    console.error(
      `[${serviceName}] refusing to start due to insecure secret configuration:`
    );
    for (const problem of problems) {
      console.error(`  - ${problem}`);
    }
    process.exit(1);
  }
};
