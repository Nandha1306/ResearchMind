# API Gateway (`api-gateway`)

Central reverse proxy and entry point for client requests in the **ResearchMind** microservices ecosystem.

---

## 1. Purpose
The API Gateway handles incoming HTTP requests, applies global rate limiting, security headers, CORS policies, validates JWT access tokens for protected endpoints, and routes traffic downstream to individual microservices.

---

## 2. Responsibilities
- Proxying `/api/auth/*` to Auth Service.
- Authenticating and proxying `/api/workspaces/*` to Workspace Service.
- Enforcing global rate limiting (100 requests per 15 minutes per IP).
- Hosting interactive Swagger UI documentation at `/api-docs`.
- Standardizing HTTP response headers with Helmet.

---

## 3. Folder Structure
```
api-gateway/
├── src/
│   ├── middlewares/
│   │   ├── auth.middleware.ts        # JWT token verification middleware
│   │   └── rate-limit.middleware.ts  # Express rate limiting configuration
│   ├── app.ts                        # Express application & proxy definitions
│   ├── server.ts                     # HTTP server startup script
│   └── swagger.json                  # OpenAPI 3.0 static specification
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints

### Gateway Native Endpoints
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| `GET` | `/health` | Gateway health check status | No |
| `GET` | `/api-docs` | Interactive Swagger API UI | No |

### Proxied Routes
| Match Path | Target Service | Auth Middleware | Target URL Variable |
|------------|----------------|-----------------|---------------------|
| `/api/auth/*` | Auth Service | Public (No Gateway Check) | `AUTH_SERVICE_URL` |
| `/api/workspaces/*` | Workspace Service | Gateway `authenticate()` (JWT) | `WORKSPACE_SERVICE_URL` |

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `PORT` | Gateway listening port | `5000` | Yes |
| `AUTH_SERVICE_URL` | Downstream Auth Service URL | `http://127.0.0.1:5001` | Yes |
| `WORKSPACE_SERVICE_URL` | Downstream Workspace Service URL | `http://127.0.0.1:5002` | Yes |
| `JWT_ACCESS_SECRET` | Secret key for JWT verification | `supersecretkey` | Yes |

---

## 6. Dependencies
- **`express`**: Base web framework.
- **`http-proxy-middleware`**: Downstream request proxying.
- **`express-rate-limit`**: Rate limiting middleware.
- **`swagger-ui-express`**: Renders Swagger UI at `/api-docs`.
- **`helmet`**: Security headers management.
- **`cors`**: Enables cross-origin requests.
- **`morgan`**: Development request logging.

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Run dev server with live reload
npm run dev

# Build TypeScript to JavaScript
npm run build

# Start production server
npm run start
```
