# Document Service (`document-service`)

Document management, file extraction, Cloudinary storage, and embedding queue producer service for the **ResearchMind** platform.

---

## 1. Purpose
The Document Service handles document uploads (PDF and DOCX), text extraction, Cloudinary asset storage, document metadata persistence, workspace membership verification, and Redis embedding queue job generation.

---

## 2. Responsibilities
- Handling file uploads via Multer (`POST /api/documents/upload`). Only `.pdf` and `.docx` are accepted (Markdown, TXT and legacy `.doc` are not), one file per request, at most 10 MB:
  - wrong extension, or file bytes that do not match the extension → `415`;
  - empty file, or a PDF/DOCX whose text cannot be read → `422`;
  - file larger than 10 MB → `413`;
  - Cloudinary unavailable → `502`.
- Extracting raw text from PDF files using `pdf-parse` and DOCX files using `mammoth`.
- Uploading original document files to Cloudinary (`image` asset type for PDFs to enable in-app viewing; `raw` for DOCX files).
- Persisting document metadata (`originalName`, `fileType`, `fileSize`, `cloudinaryUrl`, `cloudinaryPublicId`, `extractedText`, `embeddingStatus`) in MongoDB.
- Deriving `uploadedBy` strictly from verified JWT claims (`req.user.userId`), completely ignoring client-supplied uploader IDs.
- Validating workspace membership (against workspace-service) before upload, listing, retrieval, deletion and re-indexing: malformed workspace id → `400`, not a member → `403`, check could not run → `503`.
- Enqueuing job payloads into Redis list `researchmind:embedding:jobs` (producer side); the ai-service worker consumes them.
- Tracking embedding status `pending` → `indexing` → `indexed` / `failed` (with the failure reason in `embeddingError`). A worker must claim a document before processing it; a document is tried at most 3 times. A recovery sweep (every 5 minutes) re-queues documents left `pending`, stuck in `indexing`, or `failed` with attempts remaining. `POST /api/documents/:id/reindex` starts a fresh retry budget (`409` while a worker is indexing it).
- Deleting a document removes its vectors first (via ai-service `DELETE /internal/vectors/...`). If that fails the deletion is rolled back and the request answers `503`; otherwise the Cloudinary asset and the record are removed.
- Internal routes for the ai-service worker under `/internal` (claim a job, report embedding status), protected by the `X-Internal-Token` header (`INTERNAL_SERVICE_TOKEN`).
- Hosting interactive Swagger API documentation at `/api-docs/`.

---

## 3. Folder Structure
```
document-service/
├── src/
│   ├── config/               # Database, Cloudinary, and Redis configurations
│   ├── controllers/          # Route handlers (upload, list, get, create, delete, reindex, internal status)
│   ├── middlewares/          # Upload (Multer) & internal-token middlewares (JWT auth comes from packages/shared)
│   ├── models/               # Document Mongoose schema
│   ├── queues/               # Redis embedding queue producer (addEmbeddingJob)
│   ├── routes/               # Express routes (document.routes.ts, health.routes.ts, internal.routes.ts)
│   ├── services/             # Core business logic (uploadToCloudinary, getWorkspaceDocuments, getDocumentById)
│   ├── types/                # TypeScript interface definitions (CreateDocumentDto, DocumentItem)
│   ├── utils/                # Text extractors, file-signature check, logger & workspace checker
│   ├── app.ts                # Express application definition
│   └── server.ts             # Server entry point
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

All document endpoints are mounted under `/api/documents` (default port 5003, proxied through API Gateway on port 5000):

| Method | Endpoint | Description | Auth Required | Request Body / Form-Data |
|--------|----------|-------------|---------------|--------------------------|
| `GET`  | `/health` | Service health status | No | None |
| `GET`  | `/api-docs/` | Interactive Swagger API UI | No | None |
| `POST` | `/api/documents/upload` | Upload PDF or DOCX file | Yes (`Bearer <token>`) | `multipart/form-data` (`file`, `workspaceId`) |
| `POST` | `/api/documents` | Create document metadata | Yes (`Bearer <token>`) | `{ workspaceId, originalName, fileType, fileSize }` |
| `GET`  | `/api/documents/workspace/:workspaceId` | Fetch documents for a workspace | Yes (`Bearer <token>`) | Path: `workspaceId` |
| `GET`  | `/api/documents/:id` | Fetch single document by ID | Yes (`Bearer <token>`) | Path: `id` |
| `DELETE` | `/api/documents/:id` | Delete document, its vectors and its stored file (`503` if vector removal fails) | Yes (`Bearer <token>`) | Path: `id` |
| `POST` | `/api/documents/:id/reindex` | Re-queue a document for embedding | Yes (`Bearer <token>`) | Path: `id` |
| `PATCH` | `/internal/documents/:id/embedding-status` | Internal: worker reports `indexed` / `failed` | `X-Internal-Token` | JSON |
| `POST` | `/internal/documents/:id/embedding/claim` | Internal: worker claims a document before processing | `X-Internal-Token` | JSON |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | default `5003` | No |
| `MONGODB_URI` or `MONGO_URI` | MongoDB connection string (`MONGODB_URI` is read first) | `mongodb://<user>:<password>@127.0.0.1:27017/researchmind-documents?authSource=admin` | Yes |
| `REDIS_URL` | Redis server connection URL (embedding queue) | default `redis://127.0.0.1:6379` | No |
| `JWT_ACCESS_SECRET` | Shared access-token signing key (same value in every service) | _(none — required)_ | Yes |
| `INTERNAL_SERVICE_TOKEN` | Shared secret for `/internal` routes and for calling ai-service's vector cleanup (same value as ai-service) | _(none — required)_ | Yes |
| `AI_SERVICE_URL` | AI Service URL, used to remove vectors on delete | default `http://127.0.0.1:5006` | No |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account cloud name | `<cloudinary-cloud-name>` | Yes |
| `CLOUDINARY_API_KEY` | Cloudinary API key | `<cloudinary-api-key>` | Yes |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | `<secret>` | Yes |
| `WORKSPACE_SERVICE_URL` | URL of Workspace Service for membership checks | default `http://127.0.0.1:5002` | No |
| `CORS_ORIGIN` | Comma-separated allowed origins | _(unset: any origin)_ | No |

The service refuses to start if `JWT_ACCESS_SECRET` or `INTERNAL_SERVICE_TOKEN` is missing, a placeholder, or shorter than 32 characters.

---

## 6. Dependencies
- **`express`**: Framework for HTTP routing and middleware.
- **`multer`**: Multipart form data handling for file uploads.
- **`pdf-parse`**: PDF text extraction library.
- **`mammoth`**: DOCX text extraction library.
- **`cloudinary`**: Cloud asset storage SDK.
- **`mongoose`**: MongoDB ODM for document metadata.
- **`ioredis`**: Redis client for queue producer operations.
- **`jsonwebtoken`**: JWT authentication token verification.

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Start dev server with nodemon & ts-node
npm run dev

# Compile TypeScript to dist/
npm run build

# Start production server
npm run start
```
