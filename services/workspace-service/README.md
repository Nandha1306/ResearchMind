# Workspace Service (`workspace-service`)

Workspace creation, membership verification, and invite code management service for the **ResearchMind** platform.

---

## 1. Purpose
The Workspace Service manages research workspaces, their member lists, invite code generation, and answers workspace membership checks for downstream services (document, task and AI services ask it on every workspace-scoped request). Roles (SEC-010): the workspace **owner** (`ownerId`) may remove members and is the only one allowed to delete documents, boards and tasks (enforced by those services through the membership check's `isOwner`); every other member has the same access. Invite codes do not expire.

---

## 2. Responsibilities
- Creating research workspace environments with unique invite codes.
- Fetching all workspaces belonging to or joined by the authenticated user.
- Joining an existing workspace via invite code. The code is matched case-insensitively (trimmed and upper-cased); an unknown code answers `404`, and joining a workspace you already belong to answers `409`.
- Answering membership checks via `GET /api/workspaces/:workspaceId/membership`, using the caller's own bearer token (used by `packages/shared/auth/workspace-membership.ts`).
- Listing members with names and emails (`GET /api/workspaces/:workspaceId/members`), fetched from auth-service's internal endpoint (`INTERNAL_SERVICE_TOKEN`); if that call fails, members are listed by user id with a placeholder name. Only the owner sees other members' e-mails (SEC-018).

---

## 3. Folder Structure
```
workspace-service/
├── src/
│   ├── config/               # Database configurations
│   ├── controllers/          # Route handlers (create, getAll, join, checkMembership, getById, getMembers)
│   ├── middlewares/          # JWT authentication middleware
│   ├── models/               # Workspace Mongoose schema (members are an array of user ids)
│   ├── routes/               # Express router (workspace.routes.ts)
│   ├── services/             # Workspace domain logic
│   ├── app.ts                # Express application setup
│   └── server.ts             # Server startup script
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

This table summarises this service's routes. The cross-service reference (request/response shapes, errors) is [docs/reference/api.md](../../docs/reference/api.md); where they differ, that file and the code are correct.

Mounted under `/api/workspaces` (default port 5002, proxied through API Gateway on port 5000):

| Method | Endpoint | Description | Auth Required | Request Body / Path |
|--------|----------|-------------|---------------|---------------------|
| `GET`  | `/health` | Service health check | No | None |
| `POST` | `/api/workspaces` | Create a new workspace | Yes (`Bearer <token>`) | `{ name, description? }` |
| `GET`  | `/api/workspaces` | Get workspaces for current user | Yes (`Bearer <token>`) | None |
| `POST` | `/api/workspaces/join` | Join workspace via invite code | Yes (`Bearer <token>`) | `{ inviteCode }` |
| `GET`  | `/api/workspaces/:workspaceId/membership` | Is the caller a member, and the owner? (`{ isMember, isOwner }`) | Yes (`Bearer <token>`) | Path: `workspaceId` |
| `DELETE` | `/api/workspaces/:workspaceId/members/:userId` | Remove a member (owner only; the owner cannot be removed). Atomically rotates the invite code and blocks the user from rejoining. Their tasks are unassigned via task-service (`TASK_SERVICE_URL`, `INTERNAL_SERVICE_TOKEN`) | Yes (`Bearer <token>`) | Path: `workspaceId`, `userId` |
| `POST` | `/api/workspaces/:workspaceId/members/:userId/readmit` | Lift a removal (owner only): the user may join again with the current invite code | Yes (`Bearer <token>`) | Path: `workspaceId`, `userId` |
| `GET`  | `/api/workspaces/:workspaceId` | Workspace detail (members only) | Yes (`Bearer <token>`) | Path: `workspaceId` |
| `GET`  | `/api/workspaces/:workspaceId/members` | Member list with names (members only) | Yes (`Bearer <token>`) | Path: `workspaceId` |

Swagger UI is not served by this service; use the gateway's `http://localhost:5000/api-docs`. Not implemented: updating or deleting a workspace, leaving a workspace, manual invite-code rotation (the code IS rotated whenever a member is removed), ownership transfer, roles beyond owner/member, email invites.

---

## 5. Environment Variables

Full list, defaults and examples: [docs/reference/environment-variables.md](../../docs/reference/environment-variables.md).

- **Required:** `MONGO_URI` (this service reads only `MONGO_URI`), `JWT_ACCESS_SECRET` (same value in every service; the service refuses to start without a valid one).
- **Required since Wave 5:** `INTERNAL_SERVICE_TOKEN` (same value as auth-service and task-service). The service refuses to start while it is missing, a placeholder or weak (SEC-018; the variable name is printed, never the value).
- **Optional (member names):** `AUTH_SERVICE_URL` (default `http://127.0.0.1:5001`). If auth-service rejects the token or is unreachable, members are listed by user id with a placeholder name.
- **E-mail visibility (SEC-018).** The member list shows every member's e-mail to the workspace owner only; other members see their own e-mail and `""` for everyone else.
- **Legacy data (optional, user-run):** `npx ts-node src/scripts/legacy-data-hygiene.ts` (dry run) reports legacy-format invite codes and the unused `workspacemembers` collection; see `docs/deployment/docker-process.md` (Legacy data hygiene) for the flags.
- **Optional:** `PORT` (default `5002`), `HOST` (default `127.0.0.1`; set `0.0.0.0` for container or multi-host use).

---

## 6. Dependencies
- **`jsonwebtoken`**: Verifies JWT access tokens passed in authorization headers.
- **`mongoose`**: Database ODM for Workspace documents (`researchmind-workspace`).

---

## 7. Local Development Commands

Run from the repository root: one `npm install` there installs every workspace. The service reads `services/workspace-service/.env` (create it from `.env.example` only if it does not exist yet: `cp -n services/workspace-service/.env.example services/workspace-service/.env`, PowerShell `if (-not (Test-Path services/workspace-service/.env)) { Copy-Item services/workspace-service/.env.example services/workspace-service/.env }`; never copy over an existing `.env`). Status: TESTED = run in the Wave 1–4 audits, UNTESTED = not run.

```bash
npm run dev:workspace               # live reload (nodemon + ts-node), same as `npm run dev -w workspace-service`  [UNTESTED]
npm run build -w workspace-service  # compile to services/workspace-service/dist  [TESTED]
npm start -w workspace-service      # run the compiled server  [TESTED]
./node_modules/.bin/tsc --noEmit -p services/workspace-service   # typecheck, as CI does  [TESTED]
curl http://localhost:5002/health             # service health  [UNTESTED]
```

This service has no test script of its own; its tests are in the root `tests/` folder and run with `npm test` (see [Testing](../../docs/testing.md)).

---

## 8. Related Documentation

- [Developer onboarding](../../docs/onboarding.md)
- [Environment variables](../../docs/reference/environment-variables.md)
- [API reference](../../docs/reference/api.md)
- [Testing](../../docs/testing.md)
- [Deployment and operations](../../docs/deployment/docker-process.md)
- [Security model](../../docs/architecture/security.md)
