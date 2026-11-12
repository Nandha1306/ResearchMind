# Frontend Application (`frontend`)

React + Vite single-page web application for the **ResearchMind** platform.

---

## 1. Purpose
The frontend client provides the user interface for researchers to log in, register, create and join workspaces, upload and view documents, ask questions over them (AI Q&A), summarize meeting notes, and manage tasks on a Kanban board.

---

## 2. Responsibilities
- User authentication UI (Register, Login). Access and refresh tokens are kept in a Zustand store persisted to `localStorage`; the axios interceptor refreshes them on `401` (`POST /api/auth/refresh` with the refresh token in the body).
- Workspace management (Create workspace, Join via invite code, Workspace switcher).
- Documents page: upload (PDF/DOCX only; the server rejects files over 10 MB), embedding status, in-app PDF viewer (`react-pdf`), delete and re-index.
- AI Q&A page (`/dashboard/ai-researcher`): streams answers from `POST /api/ai/query` with `fetch` and reads the SSE events.
- Meeting Notes page (`/dashboard/meeting-notes`): structured summary and "create tasks from action items" (bulk task creation).
- Kanban board (`/dashboard/tasks`) with drag and drop (`@dnd-kit`), task detail modal with subtasks and activity.
- Placeholder pages only (not yet implemented): Sources, Analytics, Literature Review, Report Drafter, Settings. "Forgot password" and "Continue with Google" are shown as "coming soon" and do nothing.
- Global state management using Zustand and server-state caching with React Query (`@tanstack/react-query`).
- API requests dispatched to the API Gateway via `axios`.

---

## 3. Folder Structure
```
frontend/
├── src/
│   ├── api/                  # Axios client, auth interceptors & API methods
│   ├── components/           # UI components (auth, dashboard, documents, kanban, layout, ui, workspace)
│   ├── hooks/                # React Query hooks (documents, AI query, ...)
│   ├── layouts/              # Layout components
│   ├── lib/                  # Query client, session and token-refresh helpers
│   ├── pages/                # Login, Register, Overview, Documents, Kanban, Semantic Search, Meeting Summarizer, Create Workspace
│   ├── routes/               # AppRouter.tsx (routes), ProtectedRoute.tsx
│   ├── store/                # Zustand stores (auth.store.ts, workspace.store.ts)
│   ├── types/                # TypeScript types
│   ├── utils/                # Helpers
│   ├── App.tsx               # Root component (React Query provider + router)
│   └── main.tsx              # React DOM entry point
├── public/                   # Static assets
├── index.html                # HTML template
├── package.json
└── vite.config.ts            # Vite configuration
```

---

## 4. API Integration (Backend Gateway)
*The frontend does not expose backend HTTP endpoints. It consumes APIs proxied through the API Gateway (port 5000):*

- Auth: `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/refresh`, `POST /api/auth/logout`, `GET /api/auth/me`
- Workspaces: `POST /api/workspaces`, `GET /api/workspaces`, `POST /api/workspaces/join`, `GET /api/workspaces/:workspaceId/members`
- Documents: `GET /api/documents/workspace/:workspaceId`, `POST /api/documents/upload`, `DELETE /api/documents/:id`, `POST /api/documents/:id/reindex`
- AI: `POST /api/ai/query` (SSE), `POST /api/ai/search`, `GET /api/ai/sessions/workspace/:workspaceId`, `POST /api/ai/summarize-meeting`
- Tasks: boards and tasks under `/api/tasks/workspaces/:workspaceId/...`, including `POST .../tasks/bulk`

---

## 5. Environment Variables

| Variable | Description | Example / Default | Required |
|----------|-------------|-------------------|----------|
| `VITE_API_URL` | Base URL of the API Gateway **including the `/api` suffix** | default `http://localhost:5000/api` | No |

---

## 6. Dependencies
- **`react` & `react-dom`**: UI rendering library (React 19).
- **`react-pdf`**: In-app PDF viewer.
- **`@dnd-kit/core` / `@dnd-kit/sortable`**: Kanban drag and drop.
- **`vite`**: Lightning-fast build tool and dev server.
- **`react-router-dom`**: Client-side routing.
- **`@tanstack/react-query`**: Async data fetching and caching.
- **`zustand`**: Lightweight global state management.
- **`axios`**: HTTP request client.
- **`tailwindcss`**: Utility-first CSS styling.
- **`lucide-react` / `@hugeicons/react`**: Modern icon sets.

---

## 7. Local Development Commands

Run from the repository root: one `npm install` there installs every workspace. Status: TESTED = run in the Wave 1–4 audits, UNTESTED = not run.

```bash
npm run dev:frontend       # Vite dev server on http://localhost:5173; same as `npm run dev -w frontend`  [UNTESTED]
npm run build -w frontend  # tsc -b && vite build -> frontend/dist (also run in CI)  [TESTED]
npm run preview -w frontend   # serve the production build locally  [UNTESTED]
npm run lint -w frontend   # ESLint; currently reports 42 pre-existing problems, not a CI gate  [TESTED - fails]
```

`VITE_API_URL` is read at build time, so rebuild after changing it. The backend (at least the gateway, auth- and workspace-service) must be running for the app to work; see [onboarding](../docs/onboarding.md).

Testing: React pages and components have no automated tests and there are no browser end-to-end tests. Framework-free modules (`src/lib/token-refresh.ts`, `src/api/auth-interceptors.ts`, `src/utils/ai-stream.ts` and other helpers) are tested from the root `tests/client-*.test.ts` files with `npm test`; see [Testing](../docs/testing.md).

---

## 8. Related Documentation

- [Developer onboarding](../docs/onboarding.md)
- [Environment variables](../docs/reference/environment-variables.md)
- [API reference](../docs/reference/api.md)
- [Security model](../docs/architecture/security.md) (token storage and refresh)
- [Testing](../docs/testing.md)
