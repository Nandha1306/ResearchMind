# Workspace Service (`workspace-service`)

Workspace creation, membership verification, and invite code management service for the **ResearchMind** platform.

---

## 1. Purpose
The Workspace Service manages research workspaces, membership roles, invite code generation, workspace switching, and workspace authorization verification for downstream services.

---

## 2. Responsibilities
- Creating research workspace environments with unique invite codes.
- Fetching all workspaces belonging to or joined by the authenticated user.
- Joining an existing workspace via invite code.
- Verifying user workspace membership via internal endpoint (`GET /api/workspaces/:id/members/:userId`).
- Hosting interactive Swagger API documentation at `/api-docs/`.

---

## 3. Folder Structure
```
workspace-service/
├── src/
│   ├── config/               # Database configurations
│   ├── controllers/          # Route handlers (createWorkspace, getUserWorkspaces, joinWorkspace, checkMembership)
│   ├── middlewares/          # JWT authentication middleware
│   ├── models/               # Workspace and Member Mongoose schemas
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
| `GET`  | `/api-docs/` | Interactive Swagger API UI | No | None |
| `POST` | `/api/workspaces` | Create a new workspace | Yes (`Bearer <token>`) | `{ name, description? }` |
| `GET`  | `/api/workspaces` | Get workspaces for current user | Yes (`Bearer <token>`) | None |
| `POST` | `/api/workspaces/join` | Join workspace via invite code | Yes (`Bearer <token>`) | `{ inviteCode }` |
| `GET`  | `/api/workspaces/:id/members/:userId` | Internal membership verification | Internal / Auth | Path: `id`, `userId` |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | `5002` | Yes |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/researchmind-workspace` | Yes |
| `JWT_ACCESS_SECRET` | Secret key for verifying JWT tokens | `researchmind_access_secret` | Yes |

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
