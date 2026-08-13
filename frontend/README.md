# Frontend Application (`frontend`)

React + Vite single-page web application for the **ResearchMind** platform.

---

## 1. Purpose
The frontend client provides a modern, responsive user interface for researchers to log in, register, create and manage workspaces, manage research documents, and collaborate.

---

## 2. Responsibilities
- User authentication UI (Register, Login, Token storage via Zustand).
- Workspace management dashboard (Create workspace, Join via invite code, Workspace switcher).
- Document list view and detailed view.
- Global state management using Zustand and server-state caching with React Query (`@tanstack/react-query`).
- API requests dispatched to the API Gateway via `axios`.

---

## 3. Folder Structure
```
frontend/
├── src/
│   ├── api/                  # Axios HTTP client instances & API methods
│   ├── components/           # Reusable UI components (Shadcn UI, Radix primitives)
│   ├── pages/                # Page route components (Login, Register, Dashboard, Workspace)
│   ├── store/                # Zustand global state management
│   ├── App.tsx               # Root component & router setup
│   └── main.tsx              # React DOM entry point
├── public/                   # Static assets
├── index.html                # HTML template
├── package.json
└── vite.config.ts            # Vite configuration
```

---

## 4. API Integration (Backend Gateway)
*The frontend does not expose backend HTTP endpoints. It consumes APIs proxied through the API Gateway (port 5000):*

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `POST /api/workspaces`
- `GET /api/workspaces`
- `POST /api/workspaces/join`
- `GET /api/documents/workspace/:workspaceId`

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `VITE_API_URL` | Base URL for API Gateway | `http://localhost:5000` | Yes |

---

## 6. Dependencies
- **`react` & `react-dom`**: UI rendering library (React 19).
- **`vite`**: Lightning-fast build tool and dev server.
- **`react-router-dom`**: Client-side routing.
- **`@tanstack/react-query`**: Async data fetching and caching.
- **`zustand`**: Lightweight global state management.
- **`axios`**: HTTP request client.
- **`tailwindcss`**: Utility-first CSS styling.
- **`lucide-react` / `@hugeicons/react`**: Modern icon sets.

---

## 7. Local Development Commands
```bash
# Install dependencies
npm install

# Start Vite local development server (port 5173 by default)
npm run dev

# Run TypeScript type check and build production bundle
npm run build

# Preview production build locally
npm run preview

# Lint source files
npm run lint
```
