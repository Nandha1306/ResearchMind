/*
 * Create or update one MongoDB user per ResearchMind service, each with
 * readWrite on ITS OWN database only (least privilege, SEC-014).
 *
 * Runs in mongosh, authenticated as a user that can manage users (the root
 * user). Two ways it runs:
 *
 *  1. Fresh data volume: docker-compose.yml mounts this file into
 *     /docker-entrypoint-initdb.d/, so the mongo image runs it once, as root,
 *     when the volume is first initialised.
 *  2. Existing data volume (init scripts never run again): the OPERATOR runs
 *     the same file inside the running container, where compose has already
 *     set the variables below, e.g.
 *       docker exec -it researchmind-mongodb mongosh -u <root-user> -p --authenticationDatabase admin /docker-entrypoint-initdb.d/10-provision-service-users.js
 *     (-p with no value prompts for the password.) See
 *     docs/deployment/docker-process.md, "Securing an existing installation".
 *
 * Input, all REQUIRED (no defaults), for SERVICE in AUTH, WORKSPACE, DOCUMENT,
 * TASK, AI:
 *   MONGO_<SERVICE>_USERNAME   user name, created in the admin database
 *                              (so connection strings keep ?authSource=admin)
 *   MONGO_<SERVICE>_PASSWORD   at least 16 characters, URL-safe characters only
 *                              (A-Z a-z 0-9 . _ ~ -) so it can be used in a
 *                              connection string without percent-encoding
 *   MONGO_<SERVICE>_DATABASE   the database that service's MONGO_URI names
 *                              (A-Z a-z 0-9 _ -, no ".")
 *
 * On a fresh volume a validation failure makes the container exit 1; the
 * next start skips init (the data directory is no longer empty) and MongoDB
 * runs with the root user only. Recovery: fix the root .env, run
 * `docker compose up -d`, then run this script by hand as in (2) above.
 *
 * Behaviour:
 *  - Validates everything first; on any problem it changes nothing and exits
 *    non-zero naming the VARIABLE (never a value).
 *  - Idempotent: an existing user gets its password and roles reset to exactly
 *    [readWrite on its database]; a missing user is created.
 *  - Refuses to touch an existing user that holds any other role (for example
 *    the root user), so a typo can never downgrade an administrator.
 *  - Never prints a password.
 */

(function provisionServiceUsers() {
  const SERVICES = ["AUTH", "WORKSPACE", "DOCUMENT", "TASK", "AI"];
  const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;
  // MongoDB database names cannot contain "." (or / \ " $ space), so the
  // database pattern is stricter than the user-name pattern.
  const DATABASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/;
  const PASSWORD_PATTERN = /^[A-Za-z0-9._~-]{16,256}$/;
  const RESERVED_DATABASES = ["admin", "local", "config"];

  const fail = (message) => {
    throw new Error(`provision-service-users: ${message}`);
  };

  const readVar = (name) => {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") fail(`${name} is not set`);
    return value;
  };

  // ---- 1. Read and validate every input before changing anything ----------
  const specs = SERVICES.map((service) => {
    const userVar = `MONGO_${service}_USERNAME`;
    const passwordVar = `MONGO_${service}_PASSWORD`;
    const databaseVar = `MONGO_${service}_DATABASE`;

    const user = readVar(userVar);
    const password = readVar(passwordVar);
    const database = readVar(databaseVar);

    if (!NAME_PATTERN.test(user)) fail(`${userVar} must match ${NAME_PATTERN}`);
    if (!DATABASE_PATTERN.test(database)) {
      fail(`${databaseVar} must match ${DATABASE_PATTERN} (letters, digits, _ and -; no ".")`);
    }
    if (RESERVED_DATABASES.includes(database.toLowerCase())) {
      fail(`${databaseVar} must not be a system database (admin, local, config)`);
    }
    if (!PASSWORD_PATTERN.test(password)) {
      fail(
        `${passwordVar} must be 16-256 characters of A-Z a-z 0-9 . _ ~ - ` +
          "(for example: openssl rand -hex 24)"
      );
    }
    return { service, user, password, database, userVar };
  });

  const distinct = (key, label) => {
    const seen = new Map();
    for (const spec of specs) {
      const value = spec[key].toLowerCase();
      if (seen.has(value)) {
        fail(`MONGO_${seen.get(value)}_${label} and MONGO_${spec.service}_${label} must differ`);
      }
      seen.set(value, spec.service);
    }
  };
  distinct("user", "USERNAME");
  distinct("database", "DATABASE");

  const admin = db.getSiblingDB("admin");

  const status = admin.runCommand({ connectionStatus: 1 });
  const operators = ((status.authInfo && status.authInfo.authenticatedUsers) || []).map((u) => u.user);
  for (const spec of specs) {
    if (operators.includes(spec.user)) {
      fail(`${spec.userVar} names the user running this script; choose a dedicated service user`);
    }
  }

  // An existing user may only be updated if it is already a plain service user.
  const plan = specs.map((spec) => {
    const existing = admin.getUser(spec.user);
    if (existing) {
      const roles = existing.roles || [];
      const onlyOwnReadWrite = roles.every(
        (role) => role.role === "readWrite" && role.db === spec.database
      );
      if (!onlyOwnReadWrite) {
        fail(
          `user named by ${spec.userVar} already exists with other roles; ` +
            "refusing to change it (pick another name or fix it by hand)"
        );
      }
    }
    return { ...spec, exists: Boolean(existing) };
  });

  // ---- 2. Apply ------------------------------------------------------------
  for (const item of plan) {
    const roles = [{ role: "readWrite", db: item.database }];
    if (item.exists) {
      admin.updateUser(item.user, { pwd: item.password, roles });
      print(`provision-service-users: updated ${item.user} (readWrite on ${item.database})`);
    } else {
      admin.createUser({ user: item.user, pwd: item.password, roles });
      print(`provision-service-users: created ${item.user} (readWrite on ${item.database})`);
    }
  }
  print(`provision-service-users: done (${plan.length} service users)`);
})();
