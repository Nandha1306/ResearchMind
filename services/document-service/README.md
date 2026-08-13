# Document Service (`document-service`)

Document management and metadata storage service for the **ResearchMind** platform.

---

## 1. Purpose
The Document Service provides RESTful APIs to create, fetch, and organize research documents associated with specific workspaces in ResearchMind.

---

## 2. Responsibilities
- Creating document metadata records linked to workspaces.
- Fetching lists of documents for a given workspace (`workspaceId`).
- Retrieving single document details by ID.
- Health monitoring via `/health`.

---

## 3. Folder Structure
```
document-service/
├── src/
│   ├── config/               # Database and environment configurations
│   ├── controllers/          # Route handlers (createDocumentHandler, getDocuments, getDocument)
│   ├── models/               # Document Mongoose schema
│   ├── routes/               # Express routes (document.routes.ts, health.routes.ts)
│   ├── app.ts                # Express application definition
│   └── server.ts             # Server entry point
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

All document endpoints are mounted under `/api/documents` (default port 5003):

| Method | Endpoint | Description | Auth Required | Request Parameters / Body |
|--------|----------|-------------|---------------|---------------------------|
| `GET`  | `/health` | Service health status | No | None |
| `POST` | `/api/documents` | Create document metadata | Yes | `{ title, content?, workspaceId }` |
| `GET`  | `/api/documents/workspace/:workspaceId` | Fetch all documents for a workspace | Yes | Path: `workspaceId` |
| `GET`  | `/api/documents/:id` | Fetch single document by ID | Yes | Path: `id` |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | `5003` | Yes |
| `MONGO_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/researchmind_document` | Yes |

---

## 6. Dependencies
- **`express`**: Framework for handling HTTP requests.
- **`mongoose`**: MongoDB ODM for document metadata storage.
- **`winston`**: Structured logging library.
- **`cors`**: CORS middleware.
- **`morgan`**: HTTP logger middleware.

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Start dev server with live reloading
npm run dev

# Compile TypeScript
npm run build

# Start compiled server
npm run start
```
