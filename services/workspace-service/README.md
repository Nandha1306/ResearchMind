# Workspace Service (`workspace-service`)

Workspace creation, membership, and invite management service for the **ResearchMind** platform.

---

## 1. Purpose
The Workspace Service manages research workspace environments, member roles, invite code generation, and allows authenticated users to join existing workspaces.

---

## 2. Responsibilities
- Creating new workspace environments with unique invite codes.
- Fetching all workspaces accessible by the authenticated user.
- Joining a workspace via an invite code.
- Enforcing workspace-level access control.

---

## 3. Folder Structure
```
workspace-service/
├── src/
│   ├── config/               # Database configurations
│   ├── controllers/          # Route handlers (create, getAll, join)
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

All endpoints are mounted under `/api/workspaces` (proxied through API Gateway on port 5000 or directly on port 5002):

| Method | Endpoint | Description | Auth Required | Request Body |
|--------|----------|-------------|---------------|--------------|
| `POST` | `/api/workspaces` | Create a new workspace | Yes (`Bearer <token>`) | `{ name, description? }` |
| `GET`  | `/api/workspaces` | Get all workspaces for current user | Yes (`Bearer <token>`) | None |
| `POST` | `/api/workspaces/join` | Join workspace via invite code | Yes (`Bearer <token>`) | `{ inviteCode }` |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | `5002` | Yes |
| `MONGO_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/researchmind_workspace` | Yes |
| `JWT_ACCESS_SECRET` | Secret key for verifying JWT tokens | `supersecretkey` | Yes |

---

## 6. Dependencies
- **`jsonwebtoken`**: Verifies JWT access tokens passed in authorization headers.
- **`mongoose`**: Database ORM for Workspace documents.

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Start dev server with nodemon
npm run dev

# Build TypeScript to dist/
npm run build

# Start compiled server
npm run start
```
