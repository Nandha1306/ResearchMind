# Document Service (`document-service`)

Document management, file extraction, Cloudinary storage, and embedding queue producer service for the **ResearchMind** platform.

---

## 1. Purpose
The Document Service handles document uploads (PDF and DOCX), text extraction, Cloudinary asset storage, document metadata persistence, workspace membership verification, and Redis embedding queue job generation.

---

## 2. Responsibilities
- Handling file uploads via Multer (`POST /api/documents/upload`).
- Extracting raw text from PDF files using `pdf-parse` and DOCX files using `mammoth`.
- Uploading original document files to Cloudinary (`image` asset type for PDFs to enable in-app viewing; `raw` for DOCX files).
- Persisting document metadata (`originalName`, `fileType`, `fileSize`, `cloudinaryUrl`, `cloudinaryPublicId`, `extractedText`, `embeddingStatus`) in MongoDB.
- Deriving `uploadedBy` strictly from verified JWT claims (`req.user.userId`), completely ignoring client-supplied uploader IDs.
- Validating workspace membership before allowing upload or document retrieval.
- Enqueuing job payloads into Redis list `researchmind:embedding:jobs` (producer side).
- Hosting interactive Swagger API documentation at `/api-docs/`.

---

## 3. Folder Structure
```
document-service/
├── src/
│   ├── config/               # Database, Cloudinary, and Redis configurations
│   ├── controllers/          # Route handlers (uploadDocument, getDocuments, getDocument)
│   ├── middlewares/          # Upload (Multer) & Authentication middlewares
│   ├── models/               # Document Mongoose schema
│   ├── queues/               # Redis embedding queue producer (addEmbeddingJob)
│   ├── routes/               # Express routes (document.routes.ts, health.routes.ts)
│   ├── services/             # Core business logic (uploadToCloudinary, getWorkspaceDocuments, getDocumentById)
│   ├── types/                # TypeScript interface definitions (CreateDocumentDto, DocumentItem)
│   ├── utils/                # Text extractors (pdf-extractor.ts, docx-extractor.ts) & workspace checker
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

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Service listening port | `5003` | Yes |
| `MONGODB_URI` | MongoDB connection string | `mongodb://127.0.0.1:27017/researchmind-documents` | Yes |
| `REDIS_URL` | Redis server connection URL | `redis://127.0.0.1:6379` | Yes |
| `JWT_ACCESS_SECRET` | Secret key for verifying JWT tokens | `researchmind_access_secret` | Yes |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account cloud name | `qje2tu3s` | Yes |
| `CLOUDINARY_API_KEY` | Cloudinary API key | `812348284878871` | Yes |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | `<secret>` | Yes |
| `WORKSPACE_SERVICE_URL` | URL of Workspace Service for membership checks | `http://127.0.0.1:5002` | Yes |

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
