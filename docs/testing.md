# Testing — ResearchMind

How the automated checks work today, how to run them, and what they do **not** cover.

Command status: **TESTED** means the command was run successfully during the Wave 1–4 audits; **UNTESTED** means it matches `package.json` / CI but was not run in the audit.

---

## 1. What exists

| Check | Tool | Location | Gate in CI? |
|-------|------|----------|-------------|
| Unit tests | Node's built-in test runner (`node:test`, `node:assert`) run through `tsx` | `tests/*.test.ts` | Yes |
| Integration tests (real MongoDB) | Same runner; files named `*.integration.test.ts` | `tests/*.integration.test.ts` | Yes (CI provides MongoDB) |
| Test helpers | — | `tests/helpers/test-env.ts` (random secrets, ephemeral HTTP servers), `tests/helpers/test-mongo.ts` (disposable databases) | — |
| Backend typecheck | `tsc --noEmit` per service | `services/<service>/tsconfig.json` | Yes |
| Frontend typecheck + build | `tsc -b && vite build` | `frontend/` | Yes |
| Frontend lint | ESLint (`frontend/eslint.config.js`) | `frontend/` | **No** (and not clean, see §6) |

There is **no** Jest, Supertest, Vitest, Playwright/Cypress or k6 in the repository. The Jest/Supertest/k6 snippets in `ResearchMind_readme.md` §21 are design sketches.

All tests live in the root `tests/` folder and import service code directly by relative path (for example `../services/auth-service/src/services/auth.service`). No workspace has its own test script (`notification-service` and `shared-config` have npm's placeholder `test` script that only exits with an error).

### Test files

| File | Covers |
|------|--------|
| `auth-flow.test.ts` | JWT utilities, refresh rotation and reuse detection (mocked model), `/api/auth/refresh` router, shared `authenticate` middleware |
| `refresh-rotation.integration.test.ts` | Refresh-token rotation, concurrency, reuse after grace window, expiry, logout (real MongoDB) |
| `internal-auth.test.ts` | `X-Internal-Token` middleware, weak/placeholder tokens never authenticate |
| `workspace-membership.test.ts`, `workspace-isolation.test.ts` | Shared membership check; task-service membership gate; subtask cycle protection |
| `workspace-join.integration.test.ts` | Invite-code join, `409` / `404` / `400`, concurrent joins, non-member reads (real MongoDB) |
| `document-extraction-errors.test.ts`, `upload-and-model-validation.test.ts` | Corrupt/empty files → `422`, file-signature checks, embedding model/dimension configuration, ai-service internal vector-delete guards |
| `document-lifecycle.integration.test.ts` | Delete removes vectors first (`503` on failure), server-owned fields, worker claim/fencing/retry limit, recovery sweep, upload route validation (real MongoDB; Cloudinary and the ai-service are stubbed) |
| `embedding-job-processing.test.ts`, `embedding-worker-lifecycle.test.ts` | Embedding job flow with stubbed providers, claim client, worker start/stop |
| `ai-validation-and-stream.test.ts` | AI query/search/summary validation and membership refusal, meeting-summary normalisation from fixture LLM output, gateway ending the SSE stream when ai-service dies |
| `task-workflows.integration.test.ts` | Assignee must be a member, bulk creation (all-or-nothing, idempotent `importKey`), membership outcomes (real MongoDB) |
| `error-middleware.test.ts`, `request-body-guards.test.ts`, `lifecycle.test.ts` | Error → status mapping, missing bodies, Redis reconnect/close, graceful shutdown, health handler |
| `client-auth-refresh.test.ts`, `client-ai-stream.test.ts`, `client-helpers.test.ts`, `document-url-guard.test.ts` | Framework-free frontend modules only: token refresh coordinator and axios interceptors, SSE reader, navigation/polling/assignee helpers, external-URL guard |

---

## 2. Running the tests

All commands run from the repository root after `npm install`.

```bash
# Everything that can run without a database (integration suites are skipped)   [TESTED]
npm test
```

`npm test` is `tsx --test tests/*.test.ts`. Without `TEST_MONGO_URI`, **170 tests** run and the **11 MongoDB-backed suites are reported as SKIP** (never silently passed); the runner also prints `[tests] TEST_MONGO_URI not set`.

```bash
# Full suite, including integration tests, against a DISPOSABLE MongoDB          [TESTED]
TEST_MONGO_URI=mongodb://localhost:27018 npm test
```

With `TEST_MONGO_URI` set, **239 tests** run (unit + integration). PowerShell equivalent: `$env:TEST_MONGO_URI = "mongodb://localhost:27018"; npm test`. Point it at a disposable MongoDB (see below), never at your development database. (This audit ran it against throwaway `mongo:7` containers on other ports.)

```bash
# One file, or tests matching a name (standard node:test options)              [UNTESTED]
npx tsx --test tests/auth-flow.test.ts
npx tsx --test --test-name-pattern="bulk" tests/task-workflows.integration.test.ts
```

### Integration test requirements

- `TEST_MONGO_URI` must point at a MongoDB server **whose data does not matter**. Each test file creates its own database named `rmtest_<label>_<random>` and drops only that database when it finishes. A run that is killed before its cleanup can leave an `rmtest_*` database behind; drop it by hand.
- If the environment variable `CI` is set but `TEST_MONGO_URI` is not, the helper throws, so a misconfigured pipeline fails instead of reporting skipped suites.
- An unauthenticated throwaway MongoDB is the simplest option, for example `docker run --rm -d -p 27018:27017 --name rm-test-mongo mongo:7` and `TEST_MONGO_URI=mongodb://localhost:27018` **[TESTED form: this audit used the same recipe with other host ports]**. The `docker-compose.yml` MongoDB has authentication enabled, so a URI for it needs credentials and `?authSource=admin`; prefer a separate container over your development database.
- No Redis is needed: tests that touch Redis-using code replace the client or point it at an address where nothing is listening.

### External services

No test contacts Cloudinary, Voyage AI, Pinecone or Groq/xAI. Tests set random secrets (`tests/helpers/test-env.ts`) and dummy provider keys when they are not already set, and replace provider clients and peer services with in-process stubs or ephemeral local HTTP servers. You do not need any `.env` file or provider account to run the suite.

---

## 3. Typecheck, build and lint

```bash
# Typecheck each backend service (same as CI, which uses `npx tsc`)              [TESTED]
./node_modules/.bin/tsc --noEmit -p services/api-gateway
./node_modules/.bin/tsc --noEmit -p services/auth-service
./node_modules/.bin/tsc --noEmit -p services/workspace-service
./node_modules/.bin/tsc --noEmit -p services/document-service
./node_modules/.bin/tsc --noEmit -p services/task-service
./node_modules/.bin/tsc --noEmit -p services/ai-service

# Frontend typecheck + production build (tsc -b && vite build)                  [TESTED]
npm run build -w frontend

# Frontend lint                                                                 [TESTED - fails]
npm run lint -w frontend

# Compile one service to dist/ (then `npm start -w <service>`)                 [TESTED]
npm run build -w <service>
```

`npm run lint -w frontend` currently reports **42 pre-existing ESLint problems**, so lint is **not** a passing gate and is not run in CI. `notification-service` has no source and no build; it is not typechecked.

---

## 4. Continuous integration

Workflow: `.github/workflows/ci.yml`, one job (`typecheck-and-test`) on `ubuntu-latest`.

- **Triggers:** push and pull request to `develop` or `main`. Other branches only run CI when a pull request targets one of these.
- **Environment:** Node `22` (`actions/setup-node`, npm cache), `npm ci`, and a `mongo:7` service container on port `27017` with a `mongosh` ping health check. `TEST_MONGO_URI=mongodb://localhost:27017` is set for the test step, and GitHub sets `CI`, so integration tests must run.
- **Steps:** typecheck the six backend services → `npm run build --workspace=frontend` → `npm test`.
- **Not in CI:** lint, per-service `build`, Redis, any live provider, browser tests, coverage, deployment.

---

## 5. Manual verification

The end-to-end flow (register → workspace → upload → indexed → Q&A → meeting notes → tasks) is only checked by hand; see the verification workflow in [onboarding.md](onboarding.md). It needs real Cloudinary, Voyage, Pinecone and Groq/xAI accounts.

---

## 6. Known gaps

- **No browser end-to-end tests** (no Playwright/Cypress).
- **No component tests:** React pages and components are not tested; only framework-free frontend helpers are (`tests/client-*.test.ts`, `tests/document-url-guard.test.ts`).
- **No live-provider tests:** behaviour against real Cloudinary, Voyage, Pinecone and Groq/xAI (including answer quality, citations and retrieval relevance) is unverified by automation.
- **Limited route coverage:** register/login, workspace create/list, board CRUD, AI session listing and gateway rate limits have no route-level tests.
- **Lint is not clean** (42 problems) and not enforced.
- **No coverage reporting**, no load tests, and no tests for `npm run dev` / the `concurrently` startup scripts.

---

## Related documentation

- [Developer onboarding](onboarding.md)
- [Deployment and operations](deployment/docker-process.md)
- [Environment variables](reference/environment-variables.md)
- [Background jobs](operations/background-jobs.md)
