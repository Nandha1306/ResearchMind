# API Gateway (`api-gateway`)

Central reverse proxy, authentication verification, and API router for the **ResearchMind** microservices ecosystem.

---

## 1. Purpose
The API Gateway serves as the single public HTTP entry point (`http://localhost:5000/api`). It applies rate limiting, security headers via Helmet, CORS policies, validates JWT access tokens, and routes traffic downstream to target microservices.

---

## 2. Responsibilities
- Proxying `/api/auth/*` traffic to Auth Service (port 5001).
- Authenticating and proxying `/api/workspaces/*` traffic to Workspace Service (port 5002).
- Authenticating and proxying `/api/documents/*` traffic to Document Service (port 5003).
- Enforcing global sliding window rate limiting (100 requests per 15 minutes per IP).
- Hosting interactive Swagger UI documentation at `/api-docs/`.
- Standardizing HTTP response headers with Helmet.

---

## 3. Folder Structure
```
api-gateway/
├── src/
│   ├── middlewares/
│   │   ├── auth.middleware.ts        # JWT token verification middleware
│   │   └── rate-limit.middleware.ts  # Express rate limiting configuration
│   ├── app.ts                        # Express application & proxy route definitions
│   ├── server.ts                     # HTTP server startup script
│   └── swagger.json                  # OpenAPI 3.0 static specification
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

### Native Gateway Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/health` | Gateway health check status | No |
| `GET` | `/api-docs` | Interactive Swagger API UI | No |

### Proxied Microservice Routes
| Match Path | Target Service | Auth Middleware | Default Target URL |
|------------|----------------|-----------------|--------------------|
| `/api/auth/*` | Auth Service | Public (Gateway pass-through) | `http://127.0.0.1:5001` |
| `/api/workspaces/*` | Workspace Service | Gateway `authenticate()` (JWT) | `http://127.0.0.1:5002` |
| `/api/documents/*` | Document Service | Gateway `authenticate()` (JWT) | `http://127.0.0.1:5003` |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Gateway listening port | `5000` | Yes |
| `AUTH_SERVICE_URL` | Downstream Auth Service URL | `http://127.0.0.1:5001` | Yes |
| `WORKSPACE_SERVICE_URL` | Downstream Workspace Service URL | `http://127.0.0.1:5002` | Yes |
| `DOCUMENT_SERVICE_URL` | Downstream Document Service URL | `http://127.0.0.1:5003` | Yes |
| `JWT_ACCESS_SECRET` | Secret key for verifying JWT tokens | `researchmind_access_secret` | Yes |

---

## 6. Dependencies
- **`express`**: Base HTTP framework.
- **`http-proxy-middleware`**: Downstream request proxying.
- **`express-rate-limit`**: Rate limiting middleware.
- **`jsonwebtoken`**: JWT signature verification.
- **`swagger-ui-express`**: Renders Swagger UI at `/api-docs`.
- **`helmet`**: Security header management.

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Run dev server with live reload
npm run dev

# Build TypeScript to dist/
npm run build

# Start compiled production server
npm run start
```
