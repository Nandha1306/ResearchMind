# Workspace Service (`workspace-service`)

Workspace creation, membership verification, and invite code management service for the **ResearchMind** platform.

---

## 1. Purpose
The Workspace Service manages research workspaces, their member lists, invite code generation, and answers workspace membership checks for downstream services (document, task and AI services ask it on every workspace-scoped request). There is no role system: every member has the same access, and invite codes do not expire.

---

## 2. Responsibilities
- Creating research workspace environments with unique invite codes.
- Fetching all workspaces belonging to or joined by the authenticated user.
- Joining an existing workspace via invite code. The code is matched case-insensitively (trimmed and upper-cased); an unknown code answers `404`, and joining a workspace you already belong to answers `409`.
- Answering membership checks via `GET /api/workspaces/:workspaceId/membership`, using the caller's own bearer token (used by `packages/shared/auth/workspace-membership.ts`).
- Listing members with names and emails (`GET /api/workspaces/:workspaceId/members`), fetched from auth-service's internal endpoint when `INTERNAL_SERVICE_TOKEN` is set; otherwise members are listed by user id with a placeholder name.

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

Mounted under `/api/workspaces` (default port 5002, proxied through API Gateway on port 5000):

| Method | Endpoint | Description | Auth Required | Request Body / Path |
|--------|----------|-------------|---------------|---------------------|
| `GET`  | `/health` | Service health check | No | None |
| `POST` | `/api/workspaces` | Create a new workspace | Yes (`Bearer <token>`) | `{ name, description? }` |
| `GET`  | `/api/workspaces` | Get workspaces for current user | Yes (`Bearer <token>`) | None |
| `POST` | `/api/workspaces/join` | Join workspace via invite code | Yes (`Bearer <token>`) | `{ inviteCode }` |
| `GET`  | `/api/workspaces/:workspaceId/membership` | Is the caller a member? (`{ isMember }`) | Yes (`Bearer <token>`) | Path: `workspaceId` |
| `GET`  | `/api/workspaces/:workspaceId` | Workspace detail (members only) | Yes (`Bearer <token>`) | Path: `workspaceId` |
| `GET`  | `/api/workspaces/:workspaceId/members` | Member list with names (members only) | Yes (`Bearer <token>`) | Path: `workspaceId` |

Swagger UI is not served by this service; use the gateway's `http://localhost:5000/api-docs`. Not implemented: updating or deleting a workspace, removing members, member roles, email invites.

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | default `5002` | No |
| `MONGO_URI` | MongoDB connection string (this service reads only `MONGO_URI`) | `mongodb://<user>:<password>@127.0.0.1:27017/researchmind-workspace?authSource=admin` | Yes |
| `JWT_ACCESS_SECRET` | Shared access-token signing key (same value in every service); the service refuses to start without it | _(none — required)_ | Yes |
| `AUTH_SERVICE_URL` | Auth Service URL for member name lookup | default `http://127.0.0.1:5001` | No |
| `INTERNAL_SERVICE_TOKEN` | Shared secret sent to auth-service's `/internal/users/bulk` (same value as auth-service); without it member names are not resolved | _(none)_ | No |

---

## 6. Dependencies
- **`jsonwebtoken`**: Verifies JWT access tokens passed in authorization headers.
- **`mongoose`**: Database ODM for Workspace documents (`researchmind-workspace`).

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Start dev server with nodemon
npm run dev

# Build TypeScript to dist/
npm run build

# Start compiled production server
npm run start
```
