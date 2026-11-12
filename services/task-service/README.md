# Task Service (`task-service`)

Kanban boards, tasks, subtasks and task activity for the **ResearchMind** platform.

---

## 1. Purpose
The Task Service stores the boards and tasks of each research workspace, records an activity log per task, and creates tasks in bulk (used by the Meeting Summarizer's "create tasks from action items" flow).

---

## 2. Responsibilities
- Board CRUD per workspace.
- Task CRUD per workspace: title, description, status (`todo` / `in_progress` / `done`), priority (`low` / `medium` / `high`), assignee, due date and an optional parent task (subtasks).
- Task activity log (`GET .../tasks/:id/activities`).
- Bulk task creation (`POST .../tasks/bulk`):
  - at most 50 tasks per request;
  - all-or-nothing: the whole batch is validated first, and if a write fails the tasks already written are deleted again (a compensating rollback, not a database transaction; if that rollback itself fails, a partial import remains and is only logged);
  - idempotent when the optional `importKey` is sent: repeating the same import returns the tasks created the first time instead of duplicating them.
- Every route checks that the caller is a member of the workspace in the URL by asking workspace-service (shared helper `packages/shared/auth/workspace-membership.ts`): malformed workspace id → `400`, not a member → `403`, membership check could not run → `503`.
- An assignee must be the user id of a member of the workspace; otherwise the request is rejected with `400`.
- Hosting Swagger UI at `/api-docs/`.

---

## 3. Folder Structure
```
task-service/
├── src/
│   ├── config/               # MongoDB connection (db.ts)
│   ├── controllers/          # board.controller.ts, task.controller.ts
│   ├── middlewares/          # workspace.middleware.ts (membership check)
│   ├── models/               # Board, Task, TaskActivity Mongoose schemas
│   ├── routes/               # board.routes.ts, task.routes.ts
│   ├── services/             # board, task and task-activity logic
│   ├── utils/                # workspace-checker.ts (re-exports the shared helper)
│   ├── app.ts                # Express application setup
│   ├── server.ts             # Server entry point
│   └── swagger.json          # OpenAPI specification
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

This table summarises this service's routes. The cross-service reference (request/response shapes, errors) is [docs/reference/api.md](../../docs/reference/api.md); where they differ, that file and the code are correct.

Mounted under `/api/tasks` (default port 5004, proxied through API Gateway on port 5000). All routes except `/health` and `/api-docs/` require `Authorization: Bearer <accessToken>` and workspace membership.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/health` | Service health check (503 while MongoDB is unavailable) |
| `GET`  | `/api-docs/` | Swagger UI |
| `POST` | `/api/tasks/workspaces/:workspaceId/boards` | Create a board |
| `GET`  | `/api/tasks/workspaces/:workspaceId/boards` | List boards |
| `GET`  | `/api/tasks/workspaces/:workspaceId/boards/:id` | Get a board |
| `PATCH` | `/api/tasks/workspaces/:workspaceId/boards/:id` | Update a board |
| `DELETE` | `/api/tasks/workspaces/:workspaceId/boards/:id` | Delete a board |
| `POST` | `/api/tasks/workspaces/:workspaceId/tasks` | Create a task |
| `POST` | `/api/tasks/workspaces/:workspaceId/tasks/bulk` | Create up to 50 tasks at once (optional `importKey`) |
| `GET`  | `/api/tasks/workspaces/:workspaceId/tasks` | List tasks |
| `GET`  | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Get a task |
| `GET`  | `/api/tasks/workspaces/:workspaceId/tasks/:id/activities` | Task activity log |
| `PATCH` | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Update a task |
| `DELETE` | `/api/tasks/workspaces/:workspaceId/tasks/:id` | Delete a task |

---

## 5. Environment Variables

Full list, defaults and examples: [docs/reference/environment-variables.md](../../docs/reference/environment-variables.md).

- **Required:** `MONGODB_URI` or `MONGO_URI` (`MONGODB_URI` is read first), `JWT_ACCESS_SECRET` (same value in every service; the service refuses to start without a valid one).
- **Optional:** `PORT` (default `5004`), `WORKSPACE_SERVICE_URL` (membership checks and assignee validation, default `http://127.0.0.1:5002`; set it when not running locally), `CORS_ORIGIN` (comma-separated; unset allows any origin).

---

## 6. Dependencies
- **`express`**, **`cors`**, **`helmet`**, **`morgan`**: HTTP framework and middleware.
- **`mongoose`**: MongoDB ODM for boards, tasks and task activity.
- **`swagger-ui-express`**: Serves Swagger UI at `/api-docs`.
- **`zod`** (via `packages/validation`): Request body validation.

---

## 7. Local Development Commands

Run from the repository root: one `npm install` there installs every workspace. The service reads `services/task-service/.env` (copy `.env.example`). Status: TESTED = run in the Wave 1–4 audits, UNTESTED = not run.

```bash
npm run dev:task                    # live reload (nodemon + ts-node), same as `npm run dev -w task-service`  [UNTESTED]
npm run build -w task-service       # compile to services/task-service/dist  [TESTED]
npm start -w task-service           # run the compiled server  [TESTED]
./node_modules/.bin/tsc --noEmit -p services/task-service   # typecheck, as CI does  [TESTED]
curl http://localhost:5004/health             # service health  [UNTESTED]
```

This service has no test script of its own; its tests are in the root `tests/` folder and run with `npm test` (see [Testing](../../docs/testing.md)).

---

## 8. Related Documentation

- [Developer onboarding](../../docs/onboarding.md)
- [Environment variables](../../docs/reference/environment-variables.md)
- [API reference](../../docs/reference/api.md)
- [Testing](../../docs/testing.md)
- [Deployment and operations](../../docs/deployment/docker-process.md)
