# 🛠️ ResearchMind — Bug Fixing & Hardening Backlog

> **Historical snapshot (status note 2026-11-11):** this backlog was written on 2026-08-26 against an earlier tree. Many items have since been fixed in later fix waves; the checkboxes and line numbers below are not maintained. For current behaviour see the [documentation index](docs/README.md) and the *Current Implementation Status* section of the [project README](ResearchMind_readme.md).

**Source:** Phase 1 → Phase 4 Master Audit
**Created:** 2026-08-26
**Branch at time of audit:** `phase-4-meeting-summarizer-task-creatio`
**Goal:** Clear every blocker and known defect so Phase 5 (AI Agent + Tool Calling) can be built on a safe foundation.
**Last updated:** 2026-08-26 — WS-001, AI-001 and TASK-001 completed and runtime-verified.

---

## 📖 How To Use This Document

- Work **top to bottom**. P0 → P1 → P2 → P3. The order inside each section is already dependency-aware.
- Tick the checkbox when the fix is **implemented AND manually verified**.
- Every task lists the exact file(s). Line numbers are from the audit snapshot — re-check before editing.
- `Risk` = regression risk of the fix itself, not the severity of the bug.
- Do **not** refactor anything listed in [§ Do Not Touch](#-do-not-touch) while working through this list.

**Legend**

| Tag | Meaning |
|---|---|
| 🔴 **P0** | Blocks Phase 5. Must be fixed. |
| 🟠 **P1** | High. Fix before calling any phase complete. |
| 🟡 **P2** | Medium. Real defects, not blockers. |
| 🟢 **P3** | Low / polish / cleanup. |
| ⚙️ BE | Backend change |
| 🖥️ FE | Frontend change |
| 📄 DOC | Documentation only |
| 🧪 TEST | Test / CI |

---

## 📊 Progress Tracker

| Section | Tasks | Done |
|---|---|---|
| 🔴 P0 — Critical (Phase 5 blockers) | 8 | ☑ 7 / 8 · ◑ 1 partial |
| 🟠 P1 — High | 14 | ☑ 4 / 14 |
| 🟡 P2 — Medium | 35 | ☐ 0 / 35 |
| 🟢 P3 — Low / Nice-to-have | 29 | ☑ 1 / 29 |
| **Total** | **86** | **12 done + 1 partial / 86** |

**Completed so far:** `WS-001` ✅ · `AI-001` ✅ · `TASK-001` ✅ · `AUTH-001` ✅ · `AUTH-002` ✅ · `DOC-001` ✅ · `WS-004` ✅ · `TASK-002` ✅ · `TASK-003` ✅ · `SEC-002` ✅ · `SEC-005` ✅
**Partial:** `SEC-001` ◑ — all code hardening done and verified; **third-party key rotation needs the repo owner** (provider dashboards).
**P0 gate:** fully closed except `SEC-001`'s owner action.

**Rough effort:** ~14 working days of focused work, of which **≈2 days covers all 8 P0 blockers** and ~3 days is the test suite (TEST-001).

---
---

# 🔴 P0 — CRITICAL (Phase 5 Blockers)

> These eight tasks are the gate. Phase 5 must not start until all eight are ticked.
> **6 of 8 done** — `WS-001`, `AI-001`, `TASK-001`, `AUTH-001`, `AUTH-002` and `DOC-001` are implemented and runtime-verified.
> **`SEC-001` is code-complete and verified**, but stays open until the repo owner rotates the third-party API keys in their provider dashboards.
> **`WS-004` is done** — the files were committed in `17a74d0`, and the missing post-create refetch has been added.
> **Every other P0 is closed.**

---

### ☑ WS-001 — Fix the onboarding guard redirect race 🖥️ FE — ✅ DONE

**Severity:** CRITICAL · **Phase:** 1 · **Risk:** Very Low · **Est:** 1–2 h

**Files**
- `frontend/src/routes/AppRouter.tsx` (lines 12–33)
- `frontend/src/store/workspace.store.ts` (lines 18–24, 44–70, 106–112)

**Current behavior**
`OnboardingGuard` renders before its `useEffect` runs. At that moment `isLoading === false` and `workspaces === []` (the array is never persisted — `partialize` only saves `currentWorkspace`), so it immediately returns `<Navigate to="/create-workspace" />`. React fires the child `<Navigate>` effect *before* the parent's fetch effect, so the redirect wins every time.

**Impact**
Every login, every registration, and **every browser refresh** ejects a user who already has workspaces onto the onboarding screen — which has no link back to the dashboard. Journeys C, D, E and F are unreachable across a refresh.

**Fix steps**
1. In `workspace.store.ts`, change the initial state to `isLoading: true` and add `hasFetchedWorkspaces: false`.
2. In `fetchWorkspaces`, set `hasFetchedWorkspaces: true` in **both** the success and error paths.
3. In `AppRouter.tsx`, change the guard to:
   ```tsx
   if (isLoading || !hasFetchedWorkspaces) return <LoadingScreen />;
   if (workspaces.length === 0) return <Navigate to="/create-workspace" replace />;
   return <Outlet />;
   ```
4. (Optional but recommended) Add `workspaces: state.workspaces` to `partialize` for instant rehydration on reload.

**Verify**
- [ ] Log in with an account that has ≥1 workspace → lands on `/dashboard`.
- [ ] Press F5 on `/dashboard` → stays on `/dashboard`.
- [ ] Press F5 on `/dashboard/tasks` → stays there.
- [ ] Register a brand-new account → correctly lands on `/create-workspace`.
- [ ] Clear `localStorage` and reload → redirects to `/login`, not onboarding.

---

### ☑ AI-001 — Remove the fabricated-answer fallback in the LLM client ⚙️ BE — ✅ DONE

**Severity:** CRITICAL · **Phase:** 3 · **Risk:** Low · **Est:** 1 h

**Files**
- `services/ai-service/src/services/grok.service.ts` (lines 10–13, 40–48, 60–73)
- `services/ai-service/src/config/grok.ts` (line 277)

**Current behavior**
Both `generateGrokResponse` and `streamGrokResponse` catch **every** error and return a hardcoded sentence containing a fake `[Source 1]` citation. `streamGrokResponse` even emits it word-by-word with a 20 ms delay to imitate a real stream. `rag.service.ts` then persists it to MongoDB as a genuine `AISession` and emits `done` — never `error`.

**Impact**
When the API key expires, rate-limits, or the network fails, the researcher receives a fluent, cited, **completely fabricated** answer about "object-oriented encapsulation" — saved to their history and shown on the dashboard as their latest insight. The system lies and keeps a record of the lie.

**Fix steps**
1. Delete the `if (!apiKey || apiKey === "mock-xai-key")` blocks in both functions.
2. Delete both `catch` fallback blocks; re-throw instead. `rag.service.ts:72-76` already has a correct `emitEvent("error", …)` handler waiting.
3. Remove the `"mock-xai-key"` default in `config/grok.ts`; throw at startup if no key is configured (match the pattern already used in `config/voyage.ts:236` and `config/pinecone.ts:264`).
4. If a keyless dev mode is genuinely wanted, gate it behind an explicit `AI_DEV_MOCK=true` env var **and** prefix output with a visible `[MOCK RESPONSE]` marker.

**Verify**
- [ ] Temporarily set an invalid API key → the AI Researcher page shows a visible error, not an answer.
- [ ] No `AISession` row is written on failure.
- [ ] The service refuses to start with no key configured.

---

### ☑ TASK-001 — Add a UI to create a task 🖥️ FE — ✅ DONE

**Severity:** CRITICAL · **Phase:** 4 · **Risk:** Very Low · **Est:** 3–4 h

**Files**
- `frontend/src/pages/KanbanPage.tsx`
- `frontend/src/api/task.api.ts` (`createTask` already exists, lines 25–34)

**Current behavior**
`createTask` has exactly **one** call site in the whole frontend: `TaskDetailModal.tsx:278`, which creates *subtasks*. There is no "Add Task" / "New Task" control anywhere. The only ways to create a top-level task are the AI meeting summarizer or a manual API call.

**Impact**
Journey D (Workspace → Board → Task → Edit → Kanban) is broken at step three. The Kanban empty-state copy actively misleads: *"Create a board now to manage workflows or convert meeting action items into tasks"* — only the second clause is true.

**Fix steps**
1. Add a primary **"New Task"** button in the Kanban page header (next to "New Board").
2. Add a compact **"+ Add task"** affordance in each `KanbanColumnContainer` header that pre-fills `status` from the column and `boardId` from `selectedBoardId`.
3. Build a `CreateTaskModal` (mirror `CreateWorkspaceModal` structure) with: title (required), description, status, priority, due date.
4. On success, append to local `tasks` state so the card appears immediately.
5. Update the empty-state copy so it no longer implies tasks come only from meetings.

**Verify**
- [x] Create a task from the page header → appears in the correct column.
- [ ] Create a task from a column header → lands in that column's status. — **deferred**, see below.
- [x] Validation: empty title is rejected client-side and server-side.
- [x] The new task opens correctly in `TaskDetailModal`.

---

#### ✅ Completion record — TASK-001

**Completed:** 2026-08-26 · **Verified by:** live UI + MongoDB + API runtime tests

**What shipped**
- **New:** `frontend/src/components/kanban/CreateTaskModal.tsx` — accessible dialog with title (required), board (required), description, status, priority, assignee and due date.
- **Changed:** `frontend/src/pages/KanbanPage.tsx` — primary **"Create Task"** button in the board toolbar, live insertion of the created task into Kanban state, a `boardsError` + reload-key path so the dialog can retry a failed board load, and corrected empty-state copy.
- Reused the existing `createTask()` in `task.api.ts` and `CreateTaskPayload`; **no new API client, no backend change**.

**Top-level guarantee**
The dialog sends `parentTaskId: null` and never receives a task id as a prop, so it is structurally incapable of inheriting the selected task. Verified with `TaskDetailModal` open at the time of creation.

**Runtime results**
| Suite | Result |
|---|---|
| Backend + MongoDB (`201`, persisted fields, `TaskActivity`, 401/403/400, no duplicates) | **18 / 18** |
| Live UI via Playwright (create, board choice, double-submit, failure + retry, isolation, a11y, responsive) | **29 / 29** |
| Assignee dropdown (real member IDs, persisted, no React key warning) | **4 / 4** |
| STEP 21 regression (boards, editing, drag/drop, subtasks, summarizer, bulk action items, AI query/search, onboarding) | **15 / 15** |
| WS-001 not regressed | **10 / 10** |
| AI-001 not regressed | **9 / 9** |

`tsc --noEmit` clean across all six services and the frontend; `npm run build` ✓; ESLint unchanged at the 39-error / 4-warning baseline.

**Bug found and fixed along the way**
`workspace-service` persists `Workspace.members` as a plain `string[]` of user IDs, but `frontend/src/types/workspace.types.ts` declares `WorkspaceMember[]` (`{ userId, role, email? }`). The assignee dropdown is the first code to consume `members`, which exposed it: every option rendered blank with an `undefined` React key. The dialog now normalises both shapes so TASK-001 ships correctly. **The underlying type mismatch is still unfixed** — it is already tracked as `API-001` (P1), now with a second confirmed symptom.

**Deferred from the original fix steps**
The per-column **"+ Add task"** affordance (step 2) was not built. The task brief specified toolbar placement, and the toolbar dialog already lets the user pick any status. Worth adding later as a convenience; it is not a blocker.

---

### ☑ AUTH-001 — Add Sign Out to the app shell and wire the logout API 🖥️ FE — ✅ DONE

**Severity:** CRITICAL · **Phase:** 1 · **Risk:** Low · **Est:** 2 h
**Depends on:** AUTH-002 (fix the endpoint before calling it)

**Files**
- `frontend/src/components/layout/TopBar.tsx` (lines 166–168)
- `frontend/src/components/layout/Sidebar.tsx` (profile block, lines 265–286)
- `frontend/src/api/auth.api.ts` (lines 15–18 — `logout` is **never called**)
- `frontend/src/store/workspace.store.ts` (`clearWorkspaceState` is **never called**)

**Current behavior**
The only Sign Out button in the entire app is on `/create-workspace`. The TopBar avatar has `cursor-pointer` but **no `onClick` handler** — it looks clickable and does nothing. `authApi.logout()` is never invoked, so the refresh token stays valid in MongoDB for its full 7-day TTL after the user believes they signed out.

**Fix steps**
1. Turn the TopBar avatar into a dropdown menu (name, email, Sign Out).
2. Implement a shared `signOut()` helper:
   ```ts
   await authApi.logout({ refreshToken });   // best-effort, wrap in try/catch
   useAuthStore.getState().logout();
   useWorkspaceStore.getState().clearWorkspaceState();
   navigate("/login");
   ```
3. Call the same helper from `CreateWorkspacePage` so both paths behave identically.
4. Also call `clearWorkspaceState()` from the axios interceptor's forced-logout paths (`axios.ts:71`, `axios.ts:100`).

**Verify**
- [x] Sign Out is reachable from every authenticated page.
- [x] After sign-out, `localStorage` contains no `researchmind-auth` **and** no stale `currentWorkspace`.
- [x] The refresh token row is gone from `researchmind-auth.refreshtokens`.
- [x] Logging in as a different user does not show the previous user's workspace.

---

#### ✅ Completion record — AUTH-001

**Completed:** 2026-08-26 · **Verified by:** live browser + MongoDB + API runtime tests

**What shipped**
- **New** `frontend/src/lib/session.ts` — the single canonical teardown. `clearClientSession()` (hook-free, callable from the axios interceptor) clears workspace state, cancels and removes every React Query cache entry, clears auth, and deletes both persisted localStorage keys. `signOutClientSession()` wraps it with best-effort server revocation.
- **New** `frontend/src/lib/queryClient.ts` — the query client moved out of `App.tsx` so non-React code can reset per-user cache.
- **New** `frontend/src/hooks/useSignOut.ts` — adds router navigation (`replace`) and a double-click guard.
- **Changed** `TopBar.tsx` — the dead `cursor-pointer` avatar is now a real account menu (`aria-haspopup`, `role="menu"`, name + email + Sign Out), closing on outside-click and Escape.
- **Changed** `auth.store.ts` — added a transient `sessionId` generation counter, bumped by login/register/logout.
- **Changed** `axios.ts` — the refresh path captures `sessionId` and refuses to write tokens back if it changed; both forced-logout paths now call `clearClientSession()` instead of clearing auth alone.
- **Changed** `auth.api.ts` — `logout(refreshToken)` now sends the token in the body (it previously sent none, so the server revoked nothing).
- **Changed** `CreateWorkspacePage.tsx` — its existing Sign Out now uses the same helper.
- **Changed** `AppRouter.tsx` — added Sign Out to the workspace-unavailable screen (see below).
- **Changed** `services/auth-service/src/services/auth.service.ts` — `deleteOne` → `deleteMany` (see below).

**Backend token revocation — what actually exists**
Refresh-token revocation is real and now works: `POST /api/auth/logout` deletes the matching `RefreshToken` row and `refreshAccessToken()` checks that collection, so a revoked token returns 401. **Access tokens are stateless JWTs with no server-side revocation** — an already-issued access token stays valid until it expires. Sign-out is therefore client-side teardown plus refresh-token revocation. Verified, not assumed.

**Two real bugs found and fixed**
1. `logoutUser()` used `deleteOne`. Two sign-ins for one user within the same second mint an identical refresh JWT and therefore two rows with the same token value; `deleteOne` left one behind, so a "revoked" token still minted access tokens. Reproduced (`duplicateRowsBefore=2 → refresh 200`), fixed with `deleteMany`, re-verified (`rowsLeft=0 → refresh 401`).
2. The workspace-unavailable screen replaces the entire app shell, so when the workspace service was down the user was stranded inside the authenticated app with only "Try again" and no way out. It now carries its own Sign Out.

**Runtime results**
| Suite | Result |
|---|---|
| Live browser (discoverability, redirect, storage, Back, A→B isolation, multi-workspace, per-route sign-out, races, a11y, DB) | **32 / 32** |
| Backend security (STEP 13 A–D, revocation, deleteMany fix, DB survival) | **10 / 10** |
| WS-001 not regressed | **10 / 10** |
| TASK-001 not regressed | **29 / 29** |
| AI-001 not regressed | **9 / 9** |
| Broad phase regression | **15 / 15** |

The refresh-race guard was proved by removing it: with the guard gone and server revocation failing, a live access token was written back into storage **after** sign-out (`tokenAfter=true`). Restored, byte-identical by md5, and re-verified.

`tsc --noEmit` clean across all six services; frontend `tsc -b` and `npm run build` pass; ESLint unchanged at the 39-error / 4-warning baseline.

**Still outstanding**
`AUTH-002` steps 1–3 (authenticate the logout route, scope the delete by `userId`) were **not** implemented — out of scope for this task. Step 4 (send `{ refreshToken }` in the body) is done.

---

### ☑ DOC-001 — Secure the unauthenticated `embedding-status` endpoint ⚙️ BE — ✅ DONE

**Severity:** CRITICAL · **Phase:** 2/3 · **Risk:** Medium (two-sided change) · **Est:** 2 h

**Files**
- `services/document-service/src/routes/document.routes.ts` (lines 42–45)
- `services/document-service/src/controllers/document.controller.ts` (lines 124–171)
- `services/ai-service/src/services/document-status.service.ts` (lines 294–320)
- `services/api-gateway/src/app.ts` (lines 44–52)

**Current behavior**
```ts
router.patch("/:id/embedding-status", updateEmbeddingStatus);   // ← no authenticate
```
The handler validates only the status enum, then calls `Document.findByIdAndUpdate(id, …)`. **No user, no workspace, no membership check.** It is open because the AI worker calls it without a token.

**Impact**
Two exposures: (1) directly on `:5003` it is completely unauthenticated; (2) the gateway proxies the whole `/api/documents` prefix, so **any logged-in user of any workspace can flip any document's status in any other workspace** — a direct breach of the workspace isolation model.

**Fix steps**
1. Move the route to an internal prefix, e.g. `PATCH /internal/documents/:id/embedding-status`.
2. Require a shared secret header (`X-Internal-Token`, from `INTERNAL_SERVICE_TOKEN` env var) and reject with 401 when absent/wrong.
3. Update `ai-service/document-status.service.ts` to send the same header and the new URL.
4. Confirm the gateway's `pathFilter: "/api/documents"` does **not** match `/internal/*`.
5. Add `INTERNAL_SERVICE_TOKEN` to both services' `.env` and to `.env.example` (see SEC-001).
6. In production, bind document-service to loopback.

**Verify**
- [x] `curl -X PATCH :5003/internal/documents/<id>/embedding-status` without the header → 401.
- [x] `curl -X PATCH :5000/api/documents/<id>/embedding-status` with a valid user JWT → 404 (route no longer proxied).
- [x] Upload a document with Redis running → status still transitions `pending → indexing → indexed`.

---

#### ✅ Completion record — DOC-001

**Completed:** 2026-08-26 · **Verified by:** live API + MongoDB + a real end-to-end indexing run

**Vulnerability confirmed before the fix** (then reverted): an unauthenticated `PATCH :5003/api/documents/<id>/embedding-status` flipped a real document `indexed → failed`, and the *same* mutation succeeded through the gateway using a freshly-registered user who was not a member of that document's workspace.

**What shipped**
- **New** `services/document-service/src/middlewares/internal-auth.middleware.ts` — `requireInternalServiceToken`. Reads `X-Internal-Token`, compares against `INTERNAL_SERVICE_TOKEN` with `crypto.timingSafeEqual` over SHA-256 digests (equal-length buffers, so no length oracle). **Fails closed** when the env var is unset, and checks per request rather than at boot so a service that never serves internal traffic still starts.
- **New** `services/document-service/src/routes/internal.routes.ts` — `PATCH /documents/:id/embedding-status`, mounted at `/internal`, outside the `/api/documents` router the gateway proxies.
- `document.routes.ts` — the unauthenticated public route is **deleted** (a comment records why).
- `app.ts` — mounts `/internal`.
- `ai-service/document-status.service.ts` — calls the new URL with the header; throws if the token is unset; deliberately does not interpolate 401/403 bodies into error messages.
- **New** `.env.example` for both services, with placeholders only.

**Runtime results**
| Suite | Result |
|---|---|
| Security matrix (missing/wrong/near-miss token, JWT-as-token, old route, gateway variants, path traversal, field scoping) | **13 / 13** |
| Real pipeline (wrong-token rejection, then real upload → Redis → Voyage → Pinecone → internal callback) | **17 / 17** |
| WS-001 / AI-001 / TASK-001 / AUTH-001 / AUTH-002 not regressed | **10/10 · 9/9 · 29/29 + 18/18 · 32/32 · 17/17 + 6/6** |
| Broad phase regression | **15 / 15** |

Wrong token: the worker picked the job up, was rejected by the internal endpoint, and the document stayed `pending` — **no false `indexed`**. Correct token: `pending → indexing → indexed`, with real embeddings and real Pinecone vectors, and `/ai/search` then returned matches.

**Secret audit:** the real token value appears in exactly two files, both gitignored `.env`s. Nothing in `frontend/src`, the built bundle, worker logs, URLs or query strings.

**Still outstanding**
Step 6 (bind document-service to loopback in production) is **NOT done**. `app.listen(PORT)` binds `0.0.0.0`, and the services are not containerised (docker-compose runs only mongo/redis/mongo-express), so Docker networking does not provide isolation either. The `/internal` surface is now protected by the shared secret regardless of bind address, but the network-level hardening remains open. Changing the bind unilaterally could break a multi-host deployment, so it is left for a deployment-aware change.

`SEC-001` is **not** addressed here: no existing secret was rotated and the hardcoded JWT fallbacks remain.

---

### ◑ SEC-001 — Rotate secrets, add `.env.example`, remove hardcoded JWT fallbacks ⚙️ BE — CODE COMPLETE, OWNER ACTION PENDING

**Severity:** CRITICAL · **Phase:** All · **Risk:** Low (requires service restarts) · **Est:** 2–3 h

**Files**
- `services/*/.env` (all)
- `services/api-gateway/src/middlewares/auth.middleware.ts` (line 25)
- `services/auth-service/src/middlewares/auth.middleware.ts` (line 29)
- `services/auth-service/src/utils/jwt.ts` (lines 7–8)
- `services/workspace-service/src/middlewares/auth.middleware.ts` (line 32)

**Current state (verified)**
- ✅ **Good:** no `.env` file is tracked in git (`git ls-files | grep env` is empty), and no secret has ever been committed. The frontend contains **zero** server secrets.
- ❌ **Bad:** live active keys sit on disk — `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `XAI_API_KEY` (actually a Groq key), `CLOUDINARY_API_SECRET`.
- ❌ **Bad:** there is **no `.env.example` anywhere**, despite `.gitignore` explicitly carving out `!.env.example`.
- ❌ **Bad:** `JWT_ACCESS_SECRET` defaults to the guessable literal `"researchmind_access_secret"` in **four** files. A deployment that forgets the env var silently runs on a public signing key — anyone who knows it can mint valid tokens for any `userId`.

**Fix steps**
1. **Rotate all four third-party keys** (Voyage, Pinecone, Groq/xAI, Cloudinary).
2. Generate a high-entropy `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` (`openssl rand -hex 32`).
3. Remove every `|| "researchmind_access_secret"` fallback. Fail fast at startup instead:
   ```ts
   if (!process.env.JWT_ACCESS_SECRET) throw new Error("JWT_ACCESS_SECRET is not configured");
   ```
4. Create `services/<name>/.env.example` for all 7 services with placeholder values and comments.
5. Create `frontend/.env.example` with `VITE_API_URL=http://localhost:5000/api` (see CFG-002).

**Verify**
- [x] Every service refuses to start with `JWT_ACCESS_SECRET` unset. *(13/13 fail-closed cases verified.)*
- [x] `.env.example` exists for all 6 implemented services and is **tracked** in git. *(notification-service is an empty stub with no runtime; frontend deferred to CFG-002 — it has no `import.meta.env` usage yet, so an example would document a variable that does not exist.)*
- [ ] **Old third-party keys are revoked in each provider dashboard — OWNER ACTION, see below.**

---

#### ◑ Completion record — SEC-001

**Date:** 2026-09-10 · **Verified by:** unit + fail-closed startup + runtime security matrix + full regression

**The finding that mattered.** Every service's *configured* `JWT_ACCESS_SECRET` was byte-identical to the hardcoded fallback literal `researchmind_access_secret` — and that literal was published in **four service READMEs and `docs/onboarding.md`**. Proven exploitable before the fix: a token forged with only the README-documented string authenticated successfully against the gateway and ai-service (rejected only later by a workspace-membership check, i.e. authentication passed). `ai-service` had no `JWT_ACCESS_SECRET` at all and was running purely on the fallback.

**What shipped**
- **New** `packages/shared/config/secrets.ts` — `requireSecret()` / `assertRequiredSecrets()`. Rejects missing, empty, `<placeholder>`, sub-32-char, and a denylist of weak values **including both legacy literals**. Errors name the VARIABLE, never the VALUE.
- Removed all four `|| "researchmind_access_secret"` fallbacks and workspace-service's `process.env.JWT_ACCESS_SECRET!` non-null assertion.
- Startup validation added to all six services **and** the ai worker, with least privilege: refresh secret only in auth-service; internal token only in document-service + ai-service.
- **JWT algorithm pinned to HS256 on sign and verify** in all four verification paths — previously `jwt.verify` honoured the token's own `alg` header.
- Rotated `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` to fresh 96-char values (separate secrets), and added the missing one to ai-service.
- Removed the hardcoded Mongo credential fallback in `ai-service/src/config/db.ts`.
- `.env.example` for all six services; secret literals and a **real committed Cloudinary key** redacted from `docs/onboarding.md` and `document-service/README.md`.
- `docker-compose.yml` credentials converted to `${VAR:-default}` references (non-breaking).
- `api-gateway/tsconfig.json` `rootDir` aligned to the monorepo convention used by the other five services.

**Runtime results**
| Suite | Result |
|---|---|
| Secret-validation unit checks | **6 / 6** |
| Fail-closed startup (13 missing/weak/legacy/placeholder cases across all services + worker) | **3 / 3** |
| Runtime security matrix (rotation in force, alg confusion, tampering, separation, leakage) | **15 / 15** |
| Full regression (WS-001, AI-001, TASK-001, AUTH-001, AUTH-002, DOC-001 + Phase 1–4) | **18 / 18** |

Key evidence: a token signed with the old published literal is now rejected **401 by every one of the six services**; `alg=none` and `alg=HS512` are both rejected; no secret value appears in any of 11 probed API responses, any of 260 git-tracked files, `frontend/src`, or the built `frontend/dist` bundle.

**⚠️ OWNER ACTION REQUIRED — SEC-001 is not closed until these are done**
1. **Rotate the four third-party keys in their provider dashboards:** `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `XAI_API_KEY` (a Groq key), `CLOUDINARY_API_SECRET`. These are live credentials; only the account owner can revoke and reissue them.
2. **The Cloudinary API key and cloud name were committed to git** (`docs/onboarding.md`, `services/document-service/README.md`). They are redacted in the working tree, but **remain in git history** — rotating that credential is mandatory, not optional.
3. Every existing session is invalidated by the JWT rotation — all users must sign in again (see *Secret rotation compatibility* below).

**Secret rotation compatibility (STEP 15).** There is no key-ID/multi-key support: changing `JWT_ACCESS_SECRET` immediately invalidates every issued access token, and changing `JWT_REFRESH_SECRET` invalidates every stored refresh token. Rotation is therefore a forced global logout. Graceful rotation would need `AUTH-003` — **not implemented here.**

---

### ☑ TASK-002 — Prevent subtask cycles (A → B → A) and self-parenting ⚙️ BE — ✅ DONE

**Severity:** CRITICAL for Phase 5 · **Phase:** 4 · **Risk:** Low · **Est:** 2 h

**Files**
- `services/task-service/src/services/task.service.ts` (lines 38–48, 75–85, 289–299)
- `packages/validation/schemas/task.schema.ts` (line 22)

**Current behavior**
`createTask` and `updateTask` validate only that the parent exists **in the same workspace**. There is no check that `parentTaskId !== taskId` and no ancestry walk. Via the API:
```
PATCH .../tasks/A  { parentTaskId: "B" }
PATCH .../tasks/B  { parentTaskId: "A" }   → accepted, cycle created
```

**Impact**
Today the modal's single-level filter survives a cycle. Any recursive traversal — a subtask tree, a progress roll-up, or the **Phase 5 agent walking task hierarchies** — will infinite-loop. Data is silently corrupted with no user-visible symptom.

**Fix steps**
1. In `updateTask`, reject `data.parentTaskId === taskId` with a 400 ("A task cannot be its own parent").
2. Add `ensureNoCycle(workspaceId, taskId, proposedParentId)` that walks the ancestor chain (bounded at ~20 hops) and rejects if `taskId` appears.
3. Apply the same guard in `createTask` (defence in depth) and in `bulkCreateTasks` phase 1.
4. Return 400, not 404 (see TASK-004).

**Verify**
- [x] `PATCH task A { parentTaskId: A }` → 400.
- [x] A → B, then B → A → 400 on the second call.
- [x] A three-node cycle (B→C→A→B) → 400.
- [x] A legitimate deeper subtask still creates fine.

**✅ Completed 2026-09-10.**

`assertParentChainIsSafe(workspaceId, proposedParentId, selfId?)` in `task.service.ts` walks the ancestor chain upward from the proposed parent, bounded at `MAX_ANCESTRY_DEPTH = 20`, with a `visited` set so it terminates even against a database that *already* contains a cycle. Wired into all three write paths:

- **`updateTask`** — the only path that can actually close a loop. Self-parenting is rejected before the lookup so the message is precise; the ancestry walk then rejects re-pointing a task at its own descendant.
- **`createTask`** — defence in depth. A new task has no id so it cannot close a loop itself, but it must not be grafted onto a chain that is already cyclic or already at the depth ceiling.
- **`bulkCreateTasks` phase 1** — validated before any document is written, so a bad chain aborts the whole batch.

All rejections are `AppError(..., 400)`, per step 4. The pre-existing "parent not in this workspace → `null` → 404" path is deliberately **left alone** — converting that to a 400 is `TASK-004`, not this task.

**Runtime results — 7/7:** self-parent 400 (no write) · A→B then B→A 400 (no write) · three-node cycle 400 (no write) · legitimate deeper assignment still 200 · create-with-parent and detach both still work · depth ceiling rejects at hop 20 with 400 and does not hang · bulk creation still succeeds on a sane chain.

**Proved the guard matters** by removing it: both cycle cases then returned **200** and wrote A and B pointing at each other. Restored md5-identical and re-verified.

---

### ☑ TASK-003 — Cascade deletes: boards, tasks, subtasks, activities ⚙️ BE — ✅ DONE

**Severity:** CRITICAL for Phase 5 · **Phase:** 4 · **Risk:** Medium (destructive) · **Est:** 3–4 h

**Files**
- `services/task-service/src/services/board.service.ts` (lines 75–83)
- `services/task-service/src/services/task.service.ts` (lines 340–348)
- `services/task-service/src/services/task-activity.service.ts`

**Current behavior**

| Delete | Cascades? | Orphaned |
|---|---|---|
| Board | ❌ | Its tasks — **invisible in the UI** (Kanban filters by `selectedBoardId`) but still returned by `getWorkspaceTasks`, and undeletable |
| Task | ❌ | Its subtasks keep a dangling `parentTaskId` and render as loose cards; **every** `TaskActivity` row becomes permanently unreachable |
| Workspace | **no endpoint at all** | Everything across four databases |

**Fix steps**
1. `deleteBoard`: inside one operation, delete the board's `Task`s and their `TaskActivity` rows. **Or** refuse deletion when tasks exist and return a clear 409 with the count — decide and document which.
2. `deleteTask`: either cascade-delete subtasks, or promote them to top-level (`parentTaskId: null`). Whichever you pick, return the affected count so the UI can confirm it.
3. Always delete the task's `TaskActivity` rows.
4. Use a Mongo session/transaction so a partial cascade cannot occur.
5. Surface the consequence in the UI confirmation dialog (`TaskDetailModal.tsx:323` currently uses a bare `window.confirm`).

**Verify**
- [x] Delete a board with 3 tasks → refused with a clear 409 naming the count; `cascade: true` then removes everything.
- [x] Delete a parent with 2 subtasks → cascades the whole subtree, and the UI confirmation names the consequence.
- [x] `taskactivities` has no rows referencing a deleted `taskId`.

**Completed 2026-09-10.**

**Decision - board delete (step 1): REFUSE by default, cascade only on explicit opt-in.** `DELETE /boards/:id` returns **409** naming the task count; repeating with `{"cascade": true}` (or `?cascade=true`) deletes the board, its tasks and their activities. Rationale: the safe default matters most for a Phase 5 agent, which must not erase fifty tasks with one unqualified call - but boards stay deliberately deletable.

**Decision - task delete (step 2): CASCADE the subtree, do not promote.** Promoting orphaned children to top-level would surface them as loose Kanban cards - exactly the defect `UX-004` tracks - and silently change their meaning. `collectSubtree()` gathers descendants breadth-first, bounded by `MAX_ANCESTRY_DEPTH` with a `seen` set so pre-TASK-002 cyclic rows cannot hang it.

**Step 3:** all `TaskActivity` rows for every deleted task are removed, in both paths.

**Step 4 - could NOT be implemented as written, deliberately.** The spec asks for a Mongo session/transaction. **This deployment is a standalone `mongo:7`, not a replica set, so multi-document write transactions are unavailable** - verified directly (`This MongoDB deployment does not support retryable writes`). Instead the deletes are **ordered so a partial failure cannot orphan anything**: activities, then tasks deepest-first, then the parent/board last. A crash midway leaves the parent present and the call safely repeatable; it can never strand a child whose parent is already gone. Genuine atomicity needs Mongo running as a replica set - a deployment change, not a code one.

**Step 5:** `TaskDetailModal`'s confirmation previously asked only "Are you sure?". It now names the consequence - how many subtasks will also be destroyed, and that activity history goes with them. (Replacing `window.confirm` with an in-app dialog remains `A11Y-001`.)

**Runtime results - 7/7:** parent delete cascades children *and* grandchildren (4 to 0 tasks) - all 5 activity rows removed - response reports `{deletedTaskCount, deletedSubtaskCount, deletedActivityCount}` - zero orphaned activity rows workspace-wide - board delete refused 409 with "still contains 3 tasks", nothing removed - `cascade:true` removes board + 3 tasks + 3 activities - an empty board still deletes without cascade.

---
---

# 🟠 P1 — HIGH PRIORITY

---

### ☐ ARCH-001 — Stop importing source files across service boundaries ⚙️ BE

**Risk:** Low · **Est:** 3 h

**Files**
- `services/task-service/src/routes/task.routes.ts:3`, `board.routes.ts:3`, `controllers/task.controller.ts:15`
- `services/document-service/src/routes/document.routes.ts:7`
- `services/ai-service/src/routes/ai.routes.ts:2`, `controllers/meeting.controller.ts:3`
- `services/document-service/src/utils/workspace-checker.ts:1`

**Problem**
Three services do `import { authenticate } from "../../../auth-service/src/middlewares/auth.middleware"`. Worse, `document-service` imports another service's **Mongoose model** (`workspace-service/src/models/Workspace`) and queries it on its own connection — against `researchmind-document`, which has no `workspaces` collection, so the fallback **always returns false**. It is dead code that also violates `docs/adr/0003-service-database-isolation.md`.

Each `tsconfig` sets `rootDir: "../.."` specifically to permit these reach-throughs, so auth-service source is compiled into four services' `dist/`. No service can be containerised independently.

**Fix steps**
1. Create `packages/shared/auth/authenticate.ts` (next to the already-correctly-shared `AppError`, `asyncHandler`, `validate`).
2. Update all imports in task, document and ai services to point there.
3. **Delete** the `Workspace` model import and its entire dead fallback branch in `document-service/src/utils/workspace-checker.ts` — the HTTP check on lines 12–31 is the correct and only mechanism.
4. Consider consolidating the three near-duplicate `workspace-checker.ts` files into `packages/shared/workspace/` (see INC-02).

**Verify**
- [ ] `grep -rn "auth-service/src" services/` returns nothing.
- [ ] `grep -rn "workspace-service/src" services/` returns nothing.
- [ ] All 7 services pass `tsc --noEmit`.

---

### ☑ AUTH-002 — Authenticate the logout endpoint and scope the delete ⚙️ BE — ✅ DONE

**Risk:** Low · **Est:** 30 min

**Files**
- `services/auth-service/src/routes/auth.routes.ts:28`
- `services/auth-service/src/services/auth.service.ts:170-181`
- `services/auth-service/src/controllers/auth.controller.ts:47-58`

**Problem**
```ts
router.post("/logout", logout);                              // ← no authenticate
await RefreshToken.deleteOne({ token: refreshToken });       // ← client-supplied value
```
Three defects: (1) unauthenticated — anyone can call it; (2) no check that the token belongs to the caller; (3) `authApi.logout()` sends **no body**, so `refreshToken` is `undefined`.

**Correction, measured 2026-08-26 during AUTH-001.** Defect (3)'s stated consequence was wrong. Mongoose does **not** collapse `{ token: undefined }` to `{}` here — it matches nothing. Runtime proof: calling `POST /api/auth/logout` with no body against a database holding 178 refresh tokens returned `200 {"message":"Logged out successfully"}` and left all **178 rows intact**. So there is no arbitrary-deletion hazard; the real consequence is milder but still wrong — the endpoint reports success while revoking nothing. AUTH-001 fixed the client side (the body is now always sent). Defects (1) and (2) are unchanged and still open.

A separate defect was found and fixed under AUTH-001: the service used `deleteOne`, so when two rows shared one token value (two sign-ins in the same second produce an identical JWT) a "revoked" token still worked. It is now `deleteMany`. When step 3 below lands, keep it as `deleteMany({ token, userId })`.

**Fix steps**
1. Add `authenticate` to the route.
2. Guard: `if (!refreshToken) throw new AppError("Refresh token is required", 400);`
3. Scope the query: `RefreshToken.deleteMany({ token: refreshToken, userId: req.user!.userId })`.
4. ~~Update the frontend to send `{ refreshToken }` in the body.~~ ✅ **done in AUTH-001.**

**Verify**
- [x] `POST /api/auth/logout` with no `Authorization` header → 401.
- [x] With no body → 400.
- [x] With user A's token while authenticated as user B → deletes nothing.
- [x] A token duplicated across rows is still fully revoked (`deleteMany` kept).

---

#### ✅ Completion record — AUTH-002

**Completed:** 2026-08-26 · **Verified by:** API + MongoDB + live-browser integration tests

**What shipped**
- `packages/validation/schemas/auth.schema.ts` — **new** `logoutSchema` requiring a non-empty `refreshToken`. Uses Zod v4's `z.string({ error })` so a *missing* field also reports "Refresh token is required" rather than Zod's generic type message.
- `services/auth-service/src/routes/auth.routes.ts` — `router.post("/logout", authenticate, validate(logoutSchema), logout)`, matching the ordering already used by `/register` and `/login`. No second JWT implementation was introduced.
- `services/auth-service/src/controllers/auth.controller.ts` — takes `AuthRequest`, passes `req.user!.userId` through to the service.
- `services/auth-service/src/services/auth.service.ts` — `logoutUser(refreshToken, userId)` now runs `deleteMany({ token, userId })`. `deleteMany` from AUTH-001 is preserved.

**Behaviour**
| Request | Before | After |
|---|---|---|
| No / malformed / invalid / expired `Authorization` | 200 | **401** |
| Authenticated, no body or `{}` | 200, revoked nothing | **400** "Refresh token is required" |
| Authenticated, own token | revoked | revoked (unchanged) |
| Authenticated as A, presenting B's token | **revoked B's session** | **200, B untouched** |
| Token duplicated across rows | all revoked | all revoked (unchanged) |

The response body is byte-identical whether or not a row matched, so the endpoint cannot be used to test whether an arbitrary token string belongs to the caller. The deleted count is deliberately not returned.

**Runtime results**
| Suite | Result |
|---|---|
| AUTH-002 API (auth rejection, schema rejection, cross-user scoping, idempotency, duplicates, refresh/login regression) | **17 / 17** |
| AUTH-002 × AUTH-001 integration (browser sign-out revokes; stale access token; concurrent users) | **6 / 6** |
| AUTH-001 not regressed | **32 / 32** |
| WS-001 / TASK-001 / AI-001 not regressed | **10/10 · 29/29 + 18/18 · 9/9** |
| Broad phase regression | **15 / 15** |

The `userId` scope was proved by removing it: User A then destroyed User B's session (`B.rowsAfter=0`, B's refresh dead). Restored, md5-identical, re-verified.

`tsc --noEmit` clean across all six services; frontend `tsc -b` and `npm run build` pass; ESLint unchanged at the 39-error / 4-warning baseline.

**Note for whoever runs the stack**
`packages/validation/` sits outside each service's nodemon watch path, so a schema edit does **not** hot-reload — auth-service needs a manual restart. This cost one confusing red test during verification.

---

### ☐ AUTH-003 — Hash refresh tokens, rotate on refresh, detect reuse ⚙️ BE

**Risk:** Medium (forces all users to re-login once) · **Est:** 4 h

**Files**
- `services/auth-service/src/services/auth.service.ts` (lines 9–24, 134–167)
- `services/auth-service/src/models/RefreshToken.ts`
- `frontend/src/api/axios.ts` (lines 83–89 — already handles rotation)

**Problem**
`refreshAccessToken` returns **only a new access token**. The raw JWT is stored in plaintext in Mongo, so a single DB read yields working 7-day credentials for every user. There is no reuse detection and no index on `token` (verified: `refreshtokens` has only `_id_` and `expiresAt_1`, so the lookup is a collection scan).

`ResearchMind_readme.md §8.2` documents the exact opposite: SHA256 in Redis, full rotation, and "delete all tokens on reuse". Redis is connected in `auth-service/src/server.ts:14` and then **never used**.

**Fix steps**
1. Store `sha256(token)` in a `tokenHash` field; add a unique index on it.
2. On refresh: verify JWT → look up hash → issue a **new pair** → delete the old row → insert the new one → return both tokens. The frontend already reads `response.data.data.refreshToken`.
3. Reuse detection: if the JWT verifies but no row matches, delete **all** rows for that `userId` and return 401.
4. Decide whether to use Redis (as documented) or keep Mongo, then make the readme match.

**Verify**
- [ ] Refresh returns both a new access **and** a new refresh token.
- [ ] Presenting the old refresh token afterwards → 401 and all sessions revoked.
- [ ] No plaintext token exists in `refreshtokens`.

---

### ☑ SEC-002 — Add real rate limiting (per-route, Redis-backed) ⚙️ BE — ✅ DONE

**Risk:** Low · **Est:** 2–3 h

**Files**
- `services/api-gateway/src/middlewares/rate-limit.middleware.ts`
- `services/api-gateway/src/app.ts:24`

**Problem**
One global limiter, **1000 requests / 15 min / IP**, in the default **in-memory** store, applied to everything including `/api/auth/login`. It resets on restart and is per-process. Combined with a 6-character password minimum, ~1000 guesses per 15 min per IP is a viable brute-force attack. AI endpoints have no per-user cap, so a single user can exhaust the entire Groq/Voyage budget.

The readme documents Redis sliding-window limits (5 logins/15 min, 3 registrations/hour, 30 `/ai/search`/hour). None exist.

**Fix steps**
1. Install `rate-limit-redis` and point it at the existing Redis instance.
2. Add per-route limiters mounted **before** the proxies:
   - `POST /api/auth/login` → 5 / 15 min per IP
   - `POST /api/auth/register` → 3 / hour per IP
   - `POST /api/ai/query` and `/api/ai/search` → 30 / hour **per userId**
   - `POST /api/ai/summarize-meeting` → 20 / hour per userId
   - everything else → 100 / min per userId
3. Return the standard `{ success: false, message }` envelope on 429.

**Verify**
- [x] 6 failed logins from one IP → 429.
- [x] Limits survive a gateway restart (stored in Redis).
- [ ] The frontend's existing 429 handling in `ai.api.ts:53-54` displays correctly - **not exercised end-to-end**, see below.

**Completed 2026-09-10.**

`rate-limit-redis` + `ioredis` added to api-gateway, with a distinct Redis key prefix per limiter (sharing one prefix would make every limiter share a counter). Limits as specced: login 5/15min per IP (failures only, via `skipSuccessfulRequests`, so signing in from several devices is not punished), register 3/hour per IP, `/ai/query` + `/ai/search` 30/hour per user, `/ai/summarize-meeting` 20/hour per user, everything else 100/min per user. All 429s use the standard `{ success, message }` envelope.

**Mount ordering matters twice:** the per-IP auth limiters sit *before* the auth proxy (those routes are unauthenticated, so there is no user to key on), and the per-user limiters sit *after* `authenticate` (they key on `req.user.userId`, which does not exist until the token is verified).

**Bug found while verifying:** the gateway's `authenticate` verified the JWT and then **discarded the payload** - `req.user` was never set at the gateway, so every "per-user" limit silently degraded to per-IP and everyone behind one NAT shared a single AI budget. It now attaches `req.user`. This weakens nothing: each service still verifies the token independently.

**Second bug, mine:** the first implementation used `enableOfflineQueue: false`, which made `rate-limit-redis` fail to load its increment script at module load (before the socket was writeable). Combined with `passOnStoreError: true` that turned **all limiting into no limiting** - caught only because the tests showed zero Redis keys. The offline queue is now enabled with a finite `maxRetriesPerRequest`, so a genuinely-down Redis still fails fast and fails open.

Limiters **fail open** by design: rate limiting is an availability control, not an authorization control, and the JWT + workspace checks are what actually protect data. Redis errors are logged once per outage.

**Runtime results - 6/6:** `[401,401,401,401,401,429,429]` on repeated failed logins - 429 body is the standard envelope - counters live in Redis under `rl:login:*` so they survive a restart - registration allows exactly 3 then 429s - 20 consecutive authenticated requests unthrottled - AI keys confirmed `user:<id>`-scoped.

**Not verified:** the frontend's 429 handling in `ai.api.ts` was not driven end-to-end - reaching it needs 30 real AI calls, which would burn live Voyage/Groq quota. The server side of the contract is confirmed; the client side is pre-existing unchanged code.

---

### ☐ API-001 — Align the `Workspace.members` type 🖥️ FE ⚙️ BE

**Risk:** Low · **Est:** 1 h

**Files**
- `frontend/src/types/workspace.types.ts` (lines 1–16)
- `frontend/src/components/layout/Sidebar.tsx` (lines 36–40)
- `services/workspace-service/src/models/Workspace.ts` (lines 35–38)

**Problem**
Frontend declares `members: WorkspaceMember[]` (`{userId, role, email?}`); backend returns `members: [String]`. So in the sidebar:
```tsx
const member = currentWorkspace.members?.find((m) => m.userId === user.id);
return member?.role || "Lead";
```
`m` is a string → `m.userId` is `undefined` → the find never matches → **every user in every workspace is labelled "Lead"**. The role system the type declares does not exist server-side: no role field, no assignment endpoint, and no authorization anywhere consults a role.

`members.length` is used correctly elsewhere (Overview stat card, Right Context Panel), so those counts are right.

**Second symptom confirmed 2026-08-26 (during TASK-001).** The new Create Task dialog's assignee dropdown consumes `members` directly. With the declared type, every option rendered blank with an `undefined` React key (`Each child in a list should have a unique "key" prop`). Runtime proof — the API returns `members: ["6a8efb8dd0c7a3164ea0b154"]`, a plain string array. `CreateTaskModal.tsx` now normalises `string | WorkspaceMember` locally so the feature works, but that shim should be deleted once this task lands.

**Fix steps**
- **Option A (recommended now):** change the frontend type to `members: string[]`, delete `WorkspaceMember`, and remove the role display from the sidebar.
- **Option B (larger):** implement roles server-side (`members: [{ userId, role }]`), add a role-change endpoint, and enforce roles in authorization.

Do **not** leave a UI claiming a permission model that does not exist.

**Verify**
- [ ] The sidebar no longer shows a fabricated role.
- [ ] Member counts on Overview and the Right Context Panel are still correct.
- [ ] `tsc -b` passes in the frontend.
- [ ] The `string | WorkspaceMember` normalisation shim in `CreateTaskModal.tsx` is removed and the assignee dropdown still lists real members.

---

### ☐ TASK-004 — Return 400 (not 404) for invalid board / parent references ⚙️ BE

**Risk:** Low · **Est:** 1 h

**Files**
- `services/task-service/src/services/task.service.ts` (lines 268–299)
- `services/task-service/src/controllers/task.controller.ts` (lines 218–223)
- `frontend/src/components/kanban/TaskDetailModal.tsx` (lines 258–260)

**Problem**
`updateTask` returns `null` for three different conditions (task not found / board not in workspace / parent not in workspace) and the controller collapses all three into a 404. The modal maps 404 to *"This task no longer exists"* **and calls `onTaskDeleted(taskId)`, removing the card from the Kanban board**. A user who submits a bad board reassignment watches a healthy task disappear and is told it is gone. It returns on refresh.

`createTask` handles the identical condition correctly with a 400 (`task.controller.ts:97-102`) — the two paths disagree.

**Fix steps**
1. Change `updateTask` to return a discriminated result:
   `{ ok: false, reason: 'not_found' | 'invalid_board' | 'invalid_parent' | 'cycle' }`.
2. Map `not_found` → 404; everything else → 400 with a specific message.
3. Confirm the modal only calls `onTaskDeleted` on a genuine 404.

**Verify**
- [ ] `PATCH` with a `boardId` from another workspace → 400, and the card stays on the board.
- [ ] `PATCH` on a genuinely deleted task → 404, and the card is removed.

---

### ☐ UX-001 — Fix light mode: replace hardcoded hex with semantic tokens 🖥️ FE

**Risk:** Low (mechanical, but wide) · **Est:** 4–6 h

**Files (by hardcoded `#RRGGBB` count)**

| File | Count |
|---|---|
| `frontend/src/pages/SemanticSearchPage.tsx` | **103** |
| `frontend/src/components/documents/UploadDocumentModal.tsx` | 38 |
| `frontend/src/components/documents/PdfViewerModal.tsx` | 34 |
| `frontend/src/pages/KanbanPage.tsx` | 31 |
| `frontend/src/pages/MeetingSummarizerPage.tsx` | 22 |
| `frontend/src/components/kanban/TaskDetailModal.tsx` | 18 |
| `frontend/src/components/documents/DocumentToolbar.tsx` | 18 |
| `frontend/src/pages/DocumentsPage.tsx` | 14 |
| `frontend/src/components/documents/DocumentCard.tsx` | 12 |
| `frontend/src/components/documents/DocumentEmptyState.tsx` | 11 |
| `frontend/src/components/documents/DocumentSkeleton.tsx` | 9 |
| `frontend/src/components/documents/DocumentErrorState.tsx` | 6 |
| `frontend/src/components/documents/DocumentStatusBadge.tsx` | 4 |

**Problem**
`index.css` defines a **complete light palette** on `:root` (`--bg-base: #FFFFFF`, `--text-primary: #0A0A0A`) and a dark palette on `.dark`. The theme toggle works. But these files bypass the tokens entirely.

Concrete failure: `DocumentsPage.tsx:58` renders the page `<h1>` as `text-[#EDEDEE]` (near-white) inside a container whose background resolves to `#FFFFFF` in light mode → **white text on white background**. The pattern repeats across the AI Researcher page, the document grid and the toolbar.

**Fix steps**
1. Replace hex with the existing tokens: `bg-bg-base`, `bg-bg-surface`, `bg-bg-elevated`, `text-text-primary`, `text-text-secondary`, `text-text-muted`, `border-border-default`, `border-border-subtle`, `bg-accent-primary`, `text-accent-primary`.
2. Replace the literal `#7C6AF7` accent with `accent-primary` everywhere.
3. Work in order: `SemanticSearchPage` → `DocumentsPage` + document components → `KanbanPage` → `TaskDetailModal` → `MeetingSummarizerPage` → modals.
4. Reference `Sidebar.tsx`, `TopBar.tsx`, `OverviewPage.tsx` and `CreateWorkspacePage.tsx` — they already do this correctly.

**Verify**
- [ ] Toggle to light mode and visit **every** page — no invisible text, no dark panels on a light page.
- [ ] Toggle back to dark — visually unchanged from today.
- [ ] `grep -c "#[0-9A-Fa-f]\{6\}"` is near zero in the files above.

---

### ☐ WS-002 — Allow joining a workspace from inside the app 🖥️ FE

**Risk:** Very Low · **Est:** 2 h

**Files**
- `frontend/src/components/layout/Sidebar.tsx` (lines 150–161)
- New: `frontend/src/components/workspace/JoinWorkspaceModal.tsx`

**Problem**
`POST /api/workspaces/join` is fully implemented and correct, and the store exposes `joinWorkspace`. But the only UI that calls it is `CreateWorkspacePage`, reachable **only** via the zero-workspace redirect. The sidebar dropdown offers "New Workspace" and nothing else.

A researcher already in "My Thesis" who receives an invite code for "Lab Group" has no way to use it.

**Fix steps**
1. Add a **"Join workspace"** entry beside "New Workspace" in the sidebar dropdown.
2. Build `JoinWorkspaceModal` mirroring `CreateWorkspaceModal` (invite-code input, inline error, success confirmation).
3. On success, call `fetchWorkspaces()` and switch to the joined workspace.
4. Fix the misleading placeholder: `CreateWorkspacePage.tsx:234` shows `e.g. INV_WSA_12345`, but real codes are 8 uppercase base-36 characters.

**Verify**
- [ ] Join a second workspace from the sidebar → it appears in the dropdown and becomes current.
- [ ] Joining a workspace you already belong to → clear "Already a member" message.
- [ ] An invalid code → clear "Invalid invite code" message.

---

### ☐ AI-002 — Refresh the access token for SSE streams 🖥️ FE

**Risk:** Low · **Est:** 2 h

**Files**
- `frontend/src/api/ai.api.ts` (lines 22–65)
- `frontend/src/api/axios.ts` (lines 45–109)

**Problem**
`streamAiQuery` uses raw `fetch`, not the axios instance — necessary for streaming, but it means the 401 → refresh → retry interceptor never runs. On a 401 it shows *"Your session has expired. Please sign in again."* and stops.

Access tokens live 15 minutes. A researcher who reads an answer, thinks, then asks a follow-up will routinely cross that boundary and be locked out — while the app still holds a valid refresh token and every other page keeps working. There is no sign-in link in the message and (per AUTH-001) no way to sign out and back in.

**Fix steps**
1. Export a reusable `ensureFreshToken()` from `axios.ts` that performs (or awaits) a refresh.
2. Call it before the `fetch` in `streamAiQuery`.
3. On a 401 response, refresh once and retry the stream a single time before surfacing the error.

**Verify**
- [ ] Manually expire the access token, then run a query → it succeeds transparently.
- [ ] With an invalid refresh token → clean forced logout, not a stuck error.

---

### ☐ DOC-002 — Add document delete and re-index ⚙️ BE 🖥️ FE

**Risk:** Medium (destructive) · **Est:** 4 h

**Files**
- `services/document-service/src/routes/document.routes.ts`
- `services/document-service/src/controllers/document.controller.ts`
- `services/document-service/src/services/document.service.ts`
- `services/ai-service/src/services/vector-service.ts` (`deleteDocumentEmbeddings`, lines 427–454)
- `frontend/src/components/documents/DocumentCard.tsx`

**Problem**
There is **no DELETE and no reindex route**. `README §8.3` documents both; the Phase 3 checklist ticks *"Vector delete on document delete (`deleteDocumentEmbeddings`)"* — but that function has exactly one call site: `embedding.worker.ts:76-79`, as the idempotency step before an upsert. **No delete path invokes it.**

`DocumentCard` shows a red "Failed" badge with no action attached. With Redis down, `addEmbeddingJob` throws and every upload is marked `failed` — so **every uploaded document currently lands in a state the user can neither fix nor remove.** Cloudinary assets and Pinecone vectors accumulate forever.

**Fix steps**
1. Add `DELETE /api/documents/:id` with a membership check. It must: delete the Mongo record, destroy the Cloudinary asset via `cloudinaryPublicId`, and delete the Pinecone vectors.
2. Vector deletion crosses a service boundary — either expose an internal `DELETE /internal/vectors` on ai-service (reuse the SEC-001 internal token) or publish a Redis event the worker consumes. **Do not** import `vector-service` into document-service (see ARCH-001).
3. Add `POST /api/documents/:id/reindex` that re-enqueues an embedding job and resets status to `pending`.
4. Surface both on `DocumentCard`: a delete action with confirmation, and a **Retry** button rendered directly on the `failed` badge.

**Verify**
- [ ] Delete a document → gone from Mongo, Cloudinary and Pinecone.
- [ ] Re-index a `failed` document with Redis up → transitions to `indexed`.
- [ ] Deleting a document removes it from RAG results.

---

### ☐ GW-001 — Handle proxy errors at the gateway ⚙️ BE

**Risk:** Very Low · **Est:** 1 h · **Reproduced live during the audit**

**Files**
- `services/api-gateway/src/app.ts` (lines 26–72)

**Problem**
```
$ curl -i -X POST http://127.0.0.1:5000/api/auth/login -d '{...}'
HTTP/1.1 504
Error occurred while trying to proxy: 127.0.0.1:5000/api/auth/login
```
Plain text, not JSON, no `success` field, and it discloses internal routing detail. Every other error in the system uses `{ success, message }`. The frontend reads `err.response?.data?.message`, gets `undefined`, and falls back to *"Request failed with status code 504"* on the login screen.

**Fix steps**
1. Add an `on: { error: (err, req, res) => {...} }` handler to **each** `createProxyMiddleware`.
2. Respond `503` with `{ success: false, message: "Service temporarily unavailable. Please try again." }`.
3. Log the real error server-side with the target host.
4. Guard against writing headers twice on an already-streaming SSE response.

**Verify**
- [ ] Stop auth-service → login returns a JSON 503 with a friendly message.
- [ ] No internal host:port appears in any response body.

---

### ☑ WS-004 — Commit the working-tree workspace-creation changes 🖥️ FE — ✅ DONE

**Risk:** None · **Est:** 15 min

**Problem**
`git status` at audit time showed:
```
 M frontend/src/components/layout/Sidebar.tsx
 ?? frontend/src/components/workspace/CreateWorkspaceModal.tsx
 M frontend/src/pages/CreateWorkspacePage.tsx
 M frontend/src/routes/AppRouter.tsx
 M frontend/src/types/workspace.types.ts
```
Requirement A ("an existing user can create another workspace") is satisfied **only in the working tree** — not in any commit. A fresh clone does not have it.

**Fix steps**
1. Review and commit these files.
2. Also fix: `CreateWorkspaceModal` never calls `fetchWorkspaces()` after success, so its local append is the only source of truth until the next guard mount. Add the refetch.

**Verify**
- [x] `git status` is clean for these files.
- [x] A fresh clone shows "New Workspace" in the sidebar dropdown.

**✅ Completed 2026-09-10.** Step 1 was already satisfied: all five files were committed in `17a74d0 feat(frontend): create workspaces from a sidebar modal` — they are tracked, and the only outstanding modifications to `CreateWorkspacePage.tsx` / `AppRouter.tsx` come from AUTH-001's sign-out work, not from uncommitted workspace-creation code.

Step 2 **was** still outstanding and is now fixed: `CreateWorkspaceModal` called `createWorkspace()` (which appends locally) but never `fetchWorkspaces()`, so the optimistic append was the only source of truth until the next guard mount. A non-awaited `void fetchWorkspaces()` now reconciles with the server after a successful create — deliberately not awaited so the success message and close animation do not wait on a round trip, and safe for WS-001 because `workspaces.length >= 1` after a create keeps the guard's `isUndecided` false.

Verified: "New Workspace" reachable from the sidebar dropdown, the created workspace persists (1 row) and renders immediately, and exactly **1** `GET /api/workspaces` refetch fires after submit.

---

### ☐ WS-005 — Add workspace detail and member-list endpoints ⚙️ BE

**Risk:** Low · **Est:** 2 h
**Unblocks:** ASSIGN-001, MEET-001, ACT-002

**Files**
- `services/workspace-service/src/routes/workspace.routes.ts`
- `services/workspace-service/src/services/workspace.service.ts`

**Problem**
The workspace API is create / list / join / membership only. There is no way to fetch a single workspace or resolve the user IDs in `members[]` into names. This is the root cause of three separate UX defects: the assignee field shows raw ObjectIds, AI action-item names cannot be mapped to accounts, and the activity timeline prints `User ID: 68a1f…`.

**Fix steps**
1. Add `GET /api/workspaces/:workspaceId` (membership-checked) returning the workspace document.
2. Add `GET /api/workspaces/:workspaceId/members` returning `[{ userId, name, email, avatar }]`.
   Requires a lookup against auth-service — add an internal `POST /internal/users/bulk` on auth-service taking `userIds[]` (reuse the SEC-001 internal token). **Do not** import the `User` model across services.
3. Add the routes to the gateway swagger.

**Verify**
- [ ] `GET /api/workspaces/:id/members` returns real names for all members.
- [ ] A non-member gets 403.

---

### ☐ TEST-001 — Add a minimum test suite and CI 🧪 TEST

**Risk:** None · **Est:** 2–3 days

**Problem (verified)**
`find` for `*.test.ts`, `*.spec.ts`, `*.test.tsx`, `jest.config*`, `vitest.config*`, `*.cy.ts` across the whole repo returns **nothing**. The only `"test"` scripts are three `echo "Error: no test specified" && exit 1` stubs. There is **no `.github/` directory**.

Consequence: the readme's *"100% COMPLETE & VERIFIED"* claims for Phases 1 and 2 are not backed by any executable artefact and cannot be re-verified by anyone.

**Fix steps — in priority order**
1. **Workspace isolation matrix** (highest value). Supertest + `mongodb-memory-server`. Assert user A gets **403** on user B's board, task, activity, document and AI endpoints.
2. **Auth flow.** register → login → refresh → logout; duplicate email → 409; wrong password → 401; expired token → 401; invalid refresh → 401.
3. **`OnboardingGuard` render test** — would have caught WS-001 immediately.
4. **Bulk creation atomicity** — an invalid `boardId` at position 7 must create **zero** tasks.
5. **AI failure path** — a Grok error must produce an `error` event, never an answer (locks in AI-001).
6. **`detectTaskActivityChanges`** — pure function, demonstrably wrong today (see ACT-001).
7. **`SSEStreamParser`** — pure, self-contained, easiest high-value unit test in the repo.
8. **Subtask cycle prevention** (locks in TASK-002).
9. **Cascade behaviour** (locks in TASK-003).
10. **API contract** — a type test that would catch the `members` drift (API-001).

**CI**
Create `.github/workflows/ci.yml` running: `tsc --noEmit` for all 7 services, `tsc -b` + `eslint` for the frontend, and the test suite.

**Verify**
- [ ] `npm test` runs green at the repo root.
- [ ] CI runs on every push and PR.
- [ ] The isolation matrix genuinely fails if `requireWorkspaceMembership` is removed from a route.

---
---

# 🟡 P2 — MEDIUM PRIORITY

---

### ☐ ASSIGN-001 — Make task assignment actually work 🖥️ FE
**Depends on:** WS-005 · **Est:** 3 h
`frontend/src/components/kanban/TaskDetailModal.tsx:517-546`
The modal renders a `readOnly` input showing the raw `assigneeId` ObjectId with only a "Clear" button — **there is no way to assign anyone**. No API existed to list members, so no picker was possible. Replace with a real `<select>` populated from `GET /workspaces/:id/members`, showing names. Show "Unassigned" as an explicit option.

---

### ☐ MEET-001 — Stop implying AI action items are assigned 🖥️ FE
**Depends on:** WS-005 · **Est:** 2 h
`frontend/src/pages/MeetingSummarizerPage.tsx:196-206, 526-531`
AI assignee names are written into the task **description** as `"Assignee context: Arjun"` with `assigneeId: null` — honest, but the review UI shows the name in a person-badge with a `Users` icon and no caveat. Fix: attempt to match the name against the workspace member list; on a match set the real `assigneeId`; on no match show an explicit **"Not matched — will be created unassigned"** chip.

---

### ☐ MEET-002 — Warn when an AI due date cannot be parsed 🖥️ FE
**Est:** 1 h
`frontend/src/pages/MeetingSummarizerPage.tsx:184-191`
`new Date("next Friday")` → `NaN` → `parsedDueDate = null`, **silently**. The user saw a "next Friday" badge; the created task has no due date and nothing says so. Fix: show an inline warning on the action-item row when the date is unparseable, and let the user pick a date before creating.

---

### ☐ MEET-003 — Add "Open in Kanban" after bulk task creation 🖥️ FE
**Est:** 30 min
`frontend/src/pages/MeetingSummarizerPage.tsx:604-618`
The success panel lists titles but offers no link to the board. Journey E ends without a route to its own output. Add a button navigating to `/dashboard/tasks` with the target board pre-selected.

---

### ☐ ACT-001 — Fix the activity diff engine's missing cases ⚙️ BE
**Est:** 2 h
`services/task-service/src/services/task-activity-diff.service.ts:111-143`
The engine misses: **un-assignment** (skipped by `|| !current.assigneeId`), a due-date **change** or **removal** (the rule requires `previous.dueDate == null`, so only the first set is logged), and title / description / board changes (never logged at all). Fix the two flawed rules and add `title_changed`, `description_changed`, `board_changed` — extending the `TaskActivity.action` enum in `models/TaskActivity.ts:32` and `frontend/src/types/task.types.ts:61` to match.

---

### ☐ ACT-002 — Humanise the activity timeline 🖥️ FE
**Depends on:** WS-005 · **Est:** 2 h
`frontend/src/components/kanban/TaskDetailModal.tsx:707-717`
The timeline renders `JSON.stringify(act.payload)` verbatim and `User ID: <ObjectId>` — developer output in a researcher-facing feature. Fix: resolve `userId` to a display name; render each action as a sentence ("Priya changed status from To Do to In Progress").

---

### ☐ UX-002 — Remove or wire the decorative TopBar controls 🖥️ FE
**Est:** 1 h
`frontend/src/components/layout/TopBar.tsx:111-127, 157-165`
The global search input has no `onChange`/`onSubmit` — a dead field. The `⌘K` badge has no key handler. The notification bell has no handler **and renders a permanent red unread dot**, implying waiting notifications that cannot exist (notification-service is an empty stub). Remove all three, or wire search to navigate to the AI Researcher page with the query pre-filled. **At minimum, delete the fake unread dot.**

---

### ☐ UX-003 — Stop shipping five placeholder nav destinations 🖥️ FE
**Est:** 1 h
`frontend/src/routes/AppRouter.tsx:76-83`, `frontend/src/components/layout/Sidebar.tsx:50-64`
**5 of 11** sidebar destinations render *"module is currently in development"*: Sources, Analytics, Literature Review, Report Drafter, Settings. Nearly half the navigation is non-functional. Fix: move them into a visually distinct, disabled **"Coming soon"** group, or hide them behind a feature flag until their phase lands.

---

### ☐ UX-004 — Stop rendering subtasks as loose Kanban cards 🖥️ FE ⚙️ BE
**Est:** 2 h
`frontend/src/pages/KanbanPage.tsx:594`
`getWorkspaceTasks` returns subtasks unfiltered, so they render as **independent top-level cards** alongside their parent with no visual link. Fix: add a `?parentTaskId=null` (or `topLevelOnly=true`) query parameter to the tasks endpoint and use it on the board; show a subtask count badge on the parent card instead.

---

### ☐ UX-005 — Make Kanban cards draggable and keyboard-accessible 🖥️ FE
**Est:** 2 h
`frontend/src/pages/KanbanPage.tsx:113-143`
Dragging is only possible from a ~14 px `GripVertical` button — poor discoverability and far below the 44 px touch-target guideline. Fix: attach drag listeners to the whole card with an activation distance, keep the grip as a visual affordance, and make the card a real button (or add `role="button"`, `tabIndex={0}` and an `onKeyDown` Enter/Space handler) so it can be opened by keyboard.

---

### ☐ UX-006 — Fix the misleading "Sources Indexed" dashboard tile 🖥️ FE
**Est:** 30 min
`frontend/src/pages/OverviewPage.tsx:52-54, 101-110`
The tile counts **all** documents regardless of status and shows *"All sources indexed & searchable"* whenever nothing is mid-flight — **including when every document is `failed`**. Fix: count only `embeddingStatus === "indexed"`, and surface a failed count with a link to the Documents page.

---

### ☐ DB-001 — Add an index on `Workspace.members` ⚙️ BE
**Est:** 15 min
`services/workspace-service/src/models/Workspace.ts:35-38`
Verified live: the `workspaces` collection has only `_id_` and `inviteCode_1`. `getUserWorkspaces` runs `find({members: userId})` — a full collection scan on the **hottest query in the app** (it runs on every guard mount). Add `members: { type: [String], default: [], index: true }`.

---

### ☐ DB-002 — Ensure declared indexes are actually built ⚙️ BE
**Est:** 1 h
`services/*/src/config/db.ts`, `services/task-service/src/models/Board.ts:8-12`
Verified live: `Board.workspaceId` is declared `index: true` but the running `boards` collection has only `_id_`. Declared indexes are not reaching the database. Fix: call `Model.syncIndexes()` (or `createIndexes()`) on startup in non-production, and add an ops note that production indexes are created by migration. Then verify every model's indexes exist.

---

### ☐ PERF-001 — Fetch subtasks server-side, not by loading every task 🖥️ FE ⚙️ BE
**Est:** 1 h
`frontend/src/components/kanban/TaskDetailModal.tsx:125-131`
The modal calls `getWorkspaceTasks(workspaceId)` — **every task in the workspace** — then filters client-side for children. Add a `?parentTaskId=<id>` filter to the endpoint and use it. Pairs naturally with UX-004.

---

### ☐ PERF-002 — Stop shipping `extractedText` in the document list ⚙️ BE
**Est:** 30 min
`services/document-service/src/services/document.service.ts:171-179`
`getWorkspaceDocuments` returns full `extractedText` for every document. A 20-paper library ships megabytes of text the grid never displays. Add `.select("-extractedText")` to the list query; keep the full text on the single-document endpoint.

---

### ☐ PERF-003 — Add pagination to unbounded list endpoints ⚙️ BE 🖥️ FE
**Est:** 3 h
`task.service.ts:214-232`, `task-activity.service.ts:41-46`, `document.service.ts:171-179`
Tasks, activities and documents are all unbounded (only `AISession` caps, at 20). Add `?limit`/`?cursor` with sane defaults (50 tasks, 20 activities, 30 documents) and "load more" in the UI.

---

### ☐ PERF-004 — Code-split the frontend bundle 🖥️ FE
**Est:** 2 h
Verified: `npm run build` emits a single **1,504 kB** JS chunk (444 kB gzip) with an explicit chunk-size warning. `react-pdf`, `katex`, `recharts` and `@dnd-kit` all load on the **login page**. Fix: `React.lazy` + `Suspense` for each route in `AppRouter.tsx`, and lazy-load `PdfViewerModal` and `MathMarkdown`.

---

### ☐ AI-003 — Stop returning a fake session id when persistence fails ⚙️ BE
**Est:** 30 min
`services/ai-service/src/services/ai-session.service.ts:244-249`
`saveAiSession` catches all errors and returns `session_${Date.now()}` — so the client receives a `done` event with an id that references nothing, and the query silently vanishes from history. Fix: log the failure and emit `done` with `sessionId: null`; have the UI omit the history entry rather than fabricate one.

---

### ☐ TASK-005 — Make bulk task creation transactional ⚙️ BE
**Est:** 2 h
`services/task-service/src/services/task.service.ts:174-206`
Phase 1 correctly validates the whole batch, but phase 2 writes in a loop with no session. A mid-loop failure leaves a partial batch **and** returns an error — so the UI reports failure while some tasks exist. Wrap phase 2 in a Mongo transaction (requires a replica set; document the requirement) or add compensating deletes on failure.

---

### ☐ TASK-006 — Unify `dueDate` validation ⚙️ BE
**Est:** 30 min
`packages/validation/schemas/task.schema.ts:10, 21, 32`
`dueDate` is `z.string().datetime()` in the bulk schema but plain `z.string()` in create and update. So `PATCH { dueDate: "tomorrow" }` passes Zod, hits Mongoose, throws a `CastError`, and surfaces via `error.middleware.ts:18-23` as the misleading message **"Invalid resource ID"**. Use `.datetime()` in all three, and add a distinct message for date casting failures.

---

### ☐ WS-003 — Generate invite codes cryptographically ⚙️ BE
**Est:** 30 min
`services/workspace-service/src/utils/invite-code.ts:2-7`
`Math.random().toString(36).substring(2,10)` is non-cryptographic, occasionally shorter than 8 characters, and has **no collision retry** — a duplicate-key error surfaces as a bare 500. Fix: use `crypto.randomBytes`, produce a fixed-length unambiguous alphabet (exclude `0/O`, `1/I/l`), and retry up to 5 times on duplicate key.

---

### ☐ SEC-003 — Raise the backend password policy ⚙️ BE
**Est:** 30 min
`packages/validation/schemas/auth.schema.ts:11-16` (min **6**, no complexity) vs `frontend/src/lib/validations/auth.schema.ts:26` (min **8**). Server-side is authoritative, so an API client can register a 6-character password. Raise the backend to 8+ with at least one letter and one digit, and align the two messages.

---

### ☐ SEC-004 — Restrict CORS and add Helmet everywhere ⚙️ BE
**Est:** 1 h
`cors()` with no options on the gateway and every service — all origins allowed. Helmet is applied on gateway, auth and ai but **absent** on document and task services. Fix: allowlist origins from `CORS_ORIGIN` env, and add `helmet()` to `document-service/src/app.ts` and `task-service/src/app.ts`.

---

### ☐ OPS-001 — Add a `/health` endpoint to task-service ⚙️ BE
**Est:** 15 min
Verified: `curl :5004/health` returns **404**. `task-service/src/app.ts` has no health route while every other service does. Add one matching the existing shape.

---

### ☐ OPS-002 — Make health endpoints check their dependencies ⚙️ BE
**Est:** 1 h
Verified live: `document-service` returns `{"success":true}` while its MongoDB connection is unusable. Only `ai-service` checks a dependency (Redis). Fix: standardise a `/health` that reports `mongo` (via `mongoose.connection.readyState`) and, where relevant, `redis`, returning 503 when a required dependency is down.

---

### ☐ CFG-001 — Complete the gateway `.env` ⚙️ BE
**Est:** 15 min
`services/api-gateway/.env` defines only `AUTH_SERVICE_URL` and `WORKSPACE_SERVICE_URL`. Document, task and AI rely on hardcoded `localhost` fallbacks in `app.ts:49,59,69`, while the gateway's own README lists all four as **Required** — and omits task-service entirely. Add `DOCUMENT_SERVICE_URL`, `TASK_SERVICE_URL`, `AI_SERVICE_URL`, and fail fast if any is missing.

---

### ☐ CFG-002 — Make the frontend API URL configurable 🖥️ FE
**Est:** 30 min
`frontend/src/api/axios.ts:4` hardcodes `http://localhost:5000/api`. The frontend has **no `.env`**, no `.env.example`, and zero `import.meta.env` usage — the app cannot be deployed without a code edit. Fix: `export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000/api";` and add `frontend/.env.example`.

---

### ☐ A11Y-001 — Add focus traps and Escape handling to every modal 🖥️ FE
**Est:** 3 h
**No modal in the application has a focus trap.** `TaskDetailModal` is the only one with an Escape handler. `CreateWorkspaceModal` and the Create Board modal also lack backdrop-click close. `role="dialog"` is present on only two of four.

| Modal | File | Trap | Esc | Backdrop | role |
|---|---|---|---|---|---|
| TaskDetailModal | `components/kanban/TaskDetailModal.tsx:341-345` | ❌ | ✅ | ❌ | ✅ |
| CreateWorkspaceModal | `components/workspace/CreateWorkspaceModal.tsx:64-70` | ❌ | ❌ | ❌ | ✅ |
| Create Board | `pages/KanbanPage.tsx:643-645` | ❌ | ❌ | ❌ | ❌ |
| UploadDocumentModal | `components/documents/UploadDocumentModal.tsx:100-108` | ❌ | ❌ | ✅ | ❌ |
| PdfViewerModal | `components/documents/PdfViewerModal.tsx` | ❌ | — | — | ❌ |

Fix: build one shared `<Modal>` primitive (focus trap, Escape, backdrop click, `role="dialog"`, `aria-modal`, focus restore on close) and migrate all five.

---

### ☐ A11Y-002 — Make click-only `div`s keyboard-accessible 🖥️ FE
**Est:** 1 h
`frontend/src/pages/KanbanPage.tsx:113-121` (task cards — no `tabIndex`, no `role`, no `onKeyDown`) and `frontend/src/pages/MeetingSummarizerPage.tsx:508-517` (action-item rows — a custom checkbox with no `role="checkbox"`, no `aria-checked`, no key handler). Keyboard users cannot open a task or select an action item. Convert to real `<button>` / `role="checkbox"` elements with Enter/Space handlers.

---

### ☐ A11Y-003 — Give the workspace dropdown proper menu semantics 🖥️ FE
**Est:** 1 h
`frontend/src/components/layout/Sidebar.tsx:104-163` — no `aria-expanded`, no `role="menu"`/`menuitem`, no outside-click close and no Escape. It stays open until re-clicked. Fix: add the ARIA attributes, an outside-click listener, Escape-to-close, and arrow-key navigation.

---

### ☐ BUILD-001 — Fix the frontend TypeScript configuration 🖥️ FE
**Est:** 2–4 h (fixing the errors `strict` reveals)
- `frontend/tsconfig.app.json` has **no `strict`** and no `noUnusedLocals` — this is why 26 `any`s survive typechecking.
- `frontend/tsconfig.node.json` sets `"include": ["src"]` (it should cover `vite.config.ts`, which is therefore **never typechecked**) **and** shares the *same* `tsBuildInfoFile` path as the app project.

Fix: add `"strict": true` and `"noUnusedLocals": true` to `tsconfig.app.json`; change `tsconfig.node.json` to `"include": ["vite.config.ts"]` with its own `tsBuildInfoFile`; then fix the resulting errors.

---

### ☐ LINT-001 — Clear the 39 ESLint errors 🖥️ FE
**Est:** 3 h
`npx eslint .` → **39 errors, 4 warnings**:

| Rule | Count |
|---|---|
| `@typescript-eslint/no-explicit-any` | 26 |
| `react-hooks/set-state-in-effect` | 6 |
| `react-hooks/exhaustive-deps` | 2 |
| `react-hooks/incompatible-library` | 2 |
| `preserve-caught-error` | 2 |
| `react-hooks/immutability` | 1 |
| `@typescript-eslint/no-unused-vars` | 1 |
| `no-empty` | 1 |
| `no-misleading-character-class` | 1 |
| `react-refresh/only-export-components` | 1 |

Highest value: type the `catch (err: any)` blocks with a shared `ApiError` type, and address `set-state-in-effect` in `MeetingSummarizerPage.tsx:54` and `KanbanPage.tsx`.

---

### ☐ INC-07 — Apply `asyncHandler` consistently in task-service ⚙️ BE
**Est:** 30 min
Only `bulkCreateTasksHandler` is wrapped (`task.controller.ts:110`). Ten sibling handlers in `task.controller.ts` and all of `board.controller.ts` are not. It currently works because Express 5 forwards rejected promises, but the inconsistency signals uncertainty and will break if the framework is ever downgraded. Wrap all of them (or none, with a comment explaining why).

---

### ☐ INC-12 — Migrate boards / tasks / activities to React Query 🖥️ FE
**Est:** 4 h
React Query is used only for documents (`hooks/useDocuments.ts`). Boards, tasks, subtasks and activities use hand-rolled `useState` + `useEffect` in `KanbanPage.tsx`, `TaskDetailModal.tsx` and `MeetingSummarizerPage.tsx` — no caching, no dedupe, no background refresh. **Boards are fetched independently by two pages** and can disagree after a create. Fix: add `useWorkspaceBoards`, `useWorkspaceTasks`, `useTaskActivities` hooks with keys scoped by `workspaceId`, and invalidate on mutation.

---

### ☐ INC-16 — Unify "Sources" vs "Documents" terminology 🖥️ FE 📄 DOC
**Est:** 1 h
One word carries four meanings: "Sources" (sidebar nav), "Documents" (page title), "Sources Indexed" (dashboard stat), "Retrieved Sources & Citations" (RAG results). Pick one noun for uploaded files ("Documents") and reserve "Sources" exclusively for RAG citations. Update the sidebar, the stat card and the Right Context Panel.

---
---

# 🟢 P3 — LOW PRIORITY / NICE TO HAVE

---

### ☐ DEAD-001 — Delete the orphaned workspace onboarding stepper 🖥️ FE
**Est:** 15 min
Imported by **zero** files, superseded by `CreateWorkspacePage`:
- `frontend/src/components/workspace/WorkspaceStepper.tsx`
- `frontend/src/components/workspace/WorkspaceDetailsStep.tsx`
- `frontend/src/components/workspace/ProjectDomainStep.tsx`
- `frontend/src/components/workspace/InviteTeamStep.tsx`
- `frontend/src/components/workspace/ReviewWorkspaceStep.tsx`
- `frontend/src/lib/validations/workspace.schema.ts`

Also remove the now-unused `LocalTeammate` and `LocalOnboardingData` types from `types/workspace.types.ts:27-39`.

---

### ☐ DEAD-002 — Delete the mock dashboard cards 🖥️ FE
**Est:** 15 min
Imported by **zero** files, containing hardcoded mock data and explicit `TODO: Replace with API integration` markers:
- `frontend/src/components/dashboard/PriorityTasksCard.tsx` (TODO at line 105)
- `frontend/src/components/dashboard/TeamWorkloadCard.tsx` (TODO at line 79)
- `frontend/src/components/dashboard/ResearchActivityCard.tsx`
- `frontend/src/types/dashboard.types.ts` — supports only these, and defines a **fourth conflicting** status enum (`"backlog" | "todo" | "in_progress" | "completed"`)

---

### ☐ DEAD-003 — Clean up unused config and the empty service stub ⚙️ BE
**Est:** 30 min
- `packages/shared-config/tsconfig.base.json` is extended by **no** service — either wire it up in all 7 `tsconfig.json` files or delete it.
- `services/notification-service/tsconfig.json` is a **0-byte file**; `src/app.ts` and `src/server.ts` are empty and the package has no `express` dependency. Either scaffold it properly or leave a README note that it is a Phase 8 placeholder (the README already says so — just fix the empty tsconfig so tooling does not choke).

---

### ☐ DOCS-001 — Rewrite `task-service/README.md` 📄 DOC
**Est:** 1 h
It currently states *"Not implemented. (Service placeholder scaffolded in monorepo structure)"* — while the service is the **entire Phase 4 backend**: 3 models, 2 controllers, 4 services, 11 routes, activity diffing and bulk creation. **The most misleading document in the repo.** Document the real endpoints, models, port (5004), database (`researchmind-task`) and env vars.

---

### ☐ DOCS-002 — Fix the root readme's architecture section 📄 DOC
**Est:** 2 h
`ResearchMind_readme.md §6, §8` describes a different system:
- Ports **3000–3006** (actual: **5000–5006**)
- A **chat-service :3003** that does not exist
- Workspaces living **inside auth-service** (actual: a separate service on **:5002**)
- **task-service :5004 is not mentioned at all**
- Endpoint paths (`/docs/*`, `/tasks/boards/:id`) that match no route
- `§8.1`: the gateway injects `X-User-Id`/`X-User-Role` (it injects **nothing**) and uses Redis sliding-window per-endpoint limits (it uses **one in-memory global limiter**)
- `§8.2`: refresh rotation, SHA256 in Redis, reuse detection, httpOnly cookie, forgot/reset password — **none implemented**
- `§8.3`: `.md`/`.txt` support, `DELETE /docs/:id`, `/reindex`, `/content`, `/file` — **none exist**
- `§8.5`: status `review`, priority `urgent`, `estimatedHours`, `linkedDocId`, `tags` — **none exist**

---

### ☐ DOCS-003 — Tick the Phase 3 and Phase 4 checklists honestly 📄 DOC
**Est:** 30 min
`ResearchMind_readme.md §16` **understates** reality. Phase 3's *"Semantic search page with streaming answer + source citations (Frontend)"* is unticked but fully built. **Every Phase 4 item is unticked** yet 6 of 7 are implemented. Update both, and add an explicit "known gaps" note per phase pointing at this file.

---

### ☐ DOCS-004 — Fix the service README endpoint tables 📄 DOC
**Est:** 1 h
- `workspace-service/README.md` documents `GET /api/workspaces/:id/members/:userId`; the actual route is `GET /api/workspaces/:workspaceId/membership`.
- `auth-service/README.md` omits `POST /api/auth/logout`.
- `ai-service/README.md` omits `POST /api/ai/summarize-meeting` and `GET /api/ai/sessions/workspace/:workspaceId`.
- `api-gateway/README.md` omits task-service entirely.

---

### ☐ DOCS-005 — Fix the database names in the onboarding guide 📄 DOC
**Est:** 10 min
`docs/onboarding.md:39-40` says `researchmind-documents` and `researchmind_ai`; the actual `.env` values are `researchmind-document` and `researchmind-ai`. Also add the task-service row (port 5004, `researchmind-task`).

---

### ☐ DOCS-006 — Stop gitignoring the docs folder 📄 DOC
**Est:** 15 min
`.gitignore` contains a bare `docs` entry, so `docs/00-START-HERE.md`, `docs/README.md` and the entire `docs/adr/` directory are **untracked** (`git status --ignored` confirms). Only three older docs files are in version control. Remove the entry (the intent was almost certainly the separate `docker_process.md` rule above it) and commit the docs.

---

### ☐ DOCS-007 — Fix the AI provider and model documentation 📄 DOC
**Est:** 30 min
The readme says Claude, then Grok. `.env` sets `XAI_API_KEY=gsk_…` — a **Groq** key — so `config/grok.ts:280` routes to `api.groq.com` with model `openai/gpt-oss-120b`, while the UI badge reads *"Generated by Grok AI"*. The readme says `voyage-4`; `.env` uses `voyage-4-lite`. Fix: rename the env var to `LLM_API_KEY`/`LLM_PROVIDER`, correct the UI label to the model actually in use, and align the readme.

---

### ☐ SWAG-001 — Complete the Swagger specifications 📄 DOC
**Est:** 1 h
Missing from the specs:
- `GET /api/ai/sessions/workspace/{workspaceId}` — absent from both `api-gateway/src/swagger.json` and `ai-service/src/swagger.json`
- `PATCH /api/documents/{id}/embedding-status` — absent from both gateway and document specs (this is precisely the unauthenticated endpoint from DOC-001)

Add them, plus any new routes from WS-005, DOC-002 and TASK-001.

---

### ☐ TEST-002 — Extend the Postman collection 📄 DOC 🧪 TEST
**Est:** 2 h
Coverage is auth (6 requests) and workspaces (3). Nothing for task, document or AI. `postman/environments`, `flows`, `globals`, `mocks` and `specs` are all **empty**, and one collection is still named *"New Collection"*. Rename it, add a local environment with `{{baseUrl}}` and `{{accessToken}}`, and add folders for boards, tasks, documents and AI.

---

### ☐ UX-007 — Replace the raw task ID in the modal header 🖥️ FE
**Est:** 15 min
`frontend/src/components/kanban/TaskDetailModal.tsx:358-362` shows *"ID: 68a1f2c3..."* (a truncated ObjectId) as the only subtitle. Replace with the board name and the created date, or add a copy-to-clipboard action if the ID is genuinely useful.

---

### ☐ UX-008 — Expose board rename and delete 🖥️ FE
**Est:** 2 h
`PATCH .../boards/:id` and `DELETE .../boards/:id` are fully implemented server-side but exposed nowhere in the UI. Add a small overflow menu next to the board selector. **Complete TASK-003 first** so deletion does not orphan tasks.

---

### ☐ UX-009 — Let subtasks carry their own metadata 🖥️ FE
**Est:** 1 h
`frontend/src/components/kanban/TaskDetailModal.tsx:278-284` forces every subtask to `status: "todo"`, `priority: "medium"` and the parent's board, with no way to set a due date. Add an optional expand-for-details affordance on the add-subtask form.

---

### ☐ UX-010 — Improve the invite-code affordance 🖥️ FE
**Est:** 30 min
`frontend/src/components/layout/Sidebar.tsx:116-118` renders the invite code permanently under the workspace name with no copy button and no explanation. Add a copy-to-clipboard action with confirmation and a short tooltip ("Share this code so teammates can join").

---

### ☐ UX-011 — Add upload progress feedback 🖥️ FE
**Est:** 1 h
`frontend/src/components/documents/UploadDocumentModal.tsx` shows a spinner but no percentage. A 10 MB PDF over a slow link gives no feedback for many seconds. Use Axios `onUploadProgress` and render a progress bar.

---

### ☐ UX-012 — Clean up `docker-compose.yml` ⚙️ BE
**Est:** 30 min
- Remove the obsolete `version: "3.9"` key (Docker emits a warning on every command).
- MongoDB and Redis publish on `0.0.0.0` — bind to `127.0.0.1` for local development.
- `admin/password` is used for Mongo root **and** mongo-express basic auth — move to `.env` variables.
- Add a healthcheck to the mongo and redis services.

---

### ☐ UX-013 — Add a landing / product-explanation route 🖥️ FE
**Est:** 2 h
`AppRouter.tsx:92` sends `*` straight to `/login`. A new researcher never learns what ResearchMind is before being asked to create an account. Add a minimal public landing route at `/` explaining the product in three lines with Sign in / Create account actions.

---

### ☐ UX-014 — Add a way back to the dashboard from onboarding 🖥️ FE
**Est:** 30 min
`frontend/src/pages/CreateWorkspacePage.tsx` has no link back. Even after WS-001 is fixed, a user who navigates here deliberately is stuck unless they create, join or sign out. Show a "Back to dashboard" link when `workspaces.length > 0`.

---

### ☐ UX-015 — Increase body text sizes 🖥️ FE
**Est:** 2 h
`text-[10px]` and `text-[11px]` are used pervasively for body copy, badges, metadata and timestamps — below comfortable reading size on any device and a contrast/legibility concern. Establish a minimum of 12px for body text and 11px for badges only.

---

### ☐ UX-016 — Add success feedback for silent operations 🖥️ FE
**Est:** 1 h
Subtask creation and task deletion give no confirmation beyond the list changing. Drag-and-drop succeeds silently (acceptable — the card moves). Add a lightweight toast for subtask created, task deleted, and board created.

---

### ☐ UX-017 — Add a cancel action to AI summarization 🖥️ FE
**Est:** 1 h
`frontend/src/pages/MeetingSummarizerPage.tsx:110-147` runs a 10–30 s LLM call with a spinner and no way out. Add an `AbortController` and a Cancel button (the RAG page already does this correctly in `hooks/useAiQuery.ts:60-66` — reuse the pattern).

---

### ☐ UX-018 — Fix the fake invite-code placeholder 🖥️ FE
**Est:** 5 min
`frontend/src/pages/CreateWorkspacePage.tsx:234` shows `e.g. INV_WSA_12345`, but real codes are 8 uppercase base-36 characters (e.g. `K3F9Q2XZ`). Update the placeholder to match reality. *(Rolls up into WS-002 if done together.)*

---

### ☐ INC-09 — Standardise health endpoints across all services ⚙️ BE
**Est:** 1 h · *(Rolls up OPS-001 + OPS-002)*
`ai-service` checks Redis; `document-service`, `workspace-service` and `api-gateway` return a static `true`; **task-service has none**. Extract one shared health handler in `packages/shared/` reporting service name, uptime and dependency status.

---

### ☐ INC-10 — Apply Helmet to document-service and task-service ⚙️ BE
**Est:** 10 min · *(Rolls up into SEC-004)*
Helmet is applied on gateway, auth and ai but absent on `services/document-service/src/app.ts` and `services/task-service/src/app.ts`.

---

### ☐ INC-04/05 — Decide and document the task status/priority enums ⚙️ BE 📄 DOC
**Est:** 30 min
Four different task-status vocabularies exist in the repo:
1. Code (authoritative): `todo | in_progress | done` — `Task.ts:48`, `task.schema.ts:7`, `task.types.ts:15`
2. Readme `§8.5`: `todo | in_progress | review | done`
3. `frontend/src/types/dashboard.types.ts:40`: `backlog | todo | in_progress | completed`
4. Priority: code has `low | medium | high`; readme adds `urgent`

Decide whether `review` and `urgent` are wanted. If **no**, fix the readme and delete `dashboard.types.ts` (see DEAD-002). If **yes**, add them to the model, both Zod schemas, the frontend type, the Kanban columns and the modal selects — in one atomic change.

---

### ☐ INC-02 — Consolidate the three `workspace-checker.ts` copies ⚙️ BE
**Est:** 1 h · *(Do after ARCH-001)*
Three near-duplicate implementations exist with different fallbacks:
- `services/task-service/src/utils/workspace-checker.ts` — HTTP only, returns false without an auth header
- `services/document-service/src/utils/workspace-checker.ts` — HTTP **plus a dead cross-service DB fallback**
- `services/ai-service/src/utils/workspace-checker.ts` — HTTP only, logs a warning

Move one canonical implementation to `packages/shared/workspace/checkMembership.ts`. Consider adding a short-TTL in-memory cache — the check currently costs a network hop on **every** board/task/document/AI request.

---

### ☑ SEC-005 — Make the document ownership check unconditional ⚙️ BE — ✅ DONE
**Est:** 15 min
`services/document-service/src/controllers/document.controller.ts:61-75` fetches the document first, then checks membership behind `if (userId)`. It is currently unreachable (the route has `authenticate`), but a request that somehow arrived without `req.user` would **skip the check entirely**. Invert it: return 401 when there is no user, before the lookup.

**✅ Completed 2026-09-10.** `getDocument` now returns 401 before the lookup and runs the membership check unconditionally. Moving the auth check ahead of the fetch also removes a 401-vs-404 oracle — an unauthenticated caller previously could not read a document but *could* learn whether an id existed.

The same defect class three lines away in `createDocumentHandler` (`if (workspaceId) { ...check... }`) was hardened too: `createDocumentSchema` makes it unreachable today, but an authorization check that silently no-ops when a field is absent is one schema edit from being a hole. It now returns 400 for a missing workspace and checks membership unconditionally.

**Runtime results — 5/5:** owner reads 200 · non-member 403 with no body leak · unauthenticated 401 via gateway *and* direct, no content · existing vs non-existent id both 401 (no probing oracle) · create rejects missing workspace 400 and foreign workspace 403.

---
---

## 🚦 Suggested Execution Order

**Sprint 1 — Unblock the product (≈2 days)** — *in progress*
~~`WS-001`~~ ✅ → ~~`TASK-001`~~ ✅ → ~~`AUTH-002`~~ ✅ → ~~`AUTH-001`~~ ✅ → `WS-004` → ~~`AI-001`~~ ✅
*Outcome: the app is usable end to end and stops lying about AI answers.*
*Sprint 1 is complete — `WS-004` closed 2026-09-10.*
*Note: AUTH-001 shipped ahead of AUTH-002 (the stated dependency was only step 4,
which AUTH-001 implemented). AUTH-002 has since closed steps 1–3.*

**Sprint 2 — Close the security holes (≈2 days)**
~~`DOC-001`~~ ✅ → `SEC-001` ◑ *(code done; owner must rotate provider keys)* → ~~`SEC-002`~~ ✅ → `AUTH-003` → ~~`SEC-005`~~ ✅ → `SEC-004` / `INC-10`
*Outcome: no unauthenticated endpoints, no guessable secrets, no brute-force surface.*

**Sprint 3 — Protect the data (≈2 days)**
~~`TASK-002`~~ ✅ → ~~`TASK-003`~~ ✅ → `TASK-004` → `TASK-005` → `TASK-006` → `DB-001` → `DB-002`
*Outcome: safe for an autonomous agent to write to.*

**Sprint 4 — Architecture and contracts (≈2 days)**
`ARCH-001` → `INC-02` → `API-001` → `GW-001` → `WS-005` → `CFG-001` → `CFG-002`
*Outcome: services are independently deployable; the frontend is deployable at all.*

**Sprint 5 — The test gate (≈3 days)**
`TEST-001` (isolation matrix first, then auth flow, then the pure-function unit tests, then CI)
*Outcome: **this is the actual Phase 5 gate.** Do not skip it.*

**Sprint 6 — UX repair (≈3 days)**
`UX-001` → `WS-002` → `ASSIGN-001` → `MEET-001/002/003` → `UX-002` → `UX-003` → `DOC-002` → `AI-002`

**Sprint 7 — Polish and cleanup (ongoing)**
Everything remaining in P2 and P3.

---

## ✅ Phase 5 Readiness Gate

Phase 5 (AI Agent + Tool Calling) may begin only when **all** of the following are true:

- [ ] All 8 **P0** tasks are ticked and manually verified
- [ ] `ARCH-001` is done — the agent must not add a ninth cross-service source import
- [ ] `TEST-001` items 1 and 2 exist and pass — an agent acting across four services without a regression test is indefensible
- [ ] `WS-005` is done — the agent needs a real member directory to assign tasks to
- [ ] `GW-001` is done — the agent will hit downstream services that are sometimes down
- [ ] `npx tsc --noEmit` passes for **all 7 services**
- [ ] `npm run build` and `npx eslint .` pass in the frontend
- [ ] Journeys A–F can each be completed manually, start to finish, **including a page refresh at every step**

---

## 🚫 Do Not Touch

Modifying these creates regression risk with no benefit. Extend them; do not restructure them.

| Area | File(s) | Why |
|---|---|---|
| Workspace service core | `workspace-service/src/services/workspace.service.ts` | 74 lines, correct and secure. Add functions; do not restructure. |
| Pinecone namespace strategy | `ai-service/src/services/retrieval.service.ts`, `vector-service.ts` | Changing the namespace key strands every existing vector. |
| Chunking parameters | `ai-service/src/services/chunking.service.ts` (`CHUNK_SIZE 400`, `CHUNK_OVERLAP 60`, separators) | Changing them invalidates every embedding and forces a full re-index. |
| Vector upsert/delete | `ai-service/src/services/vector-service.ts` | Batching, ID scheme (`documentId-chunk-index`) and 404 tolerance are correct. |
| String vs ObjectId convention | all models | Cross-service IDs as `String`, intra-service as `ObjectId` is the right call for database-per-service. Do not "normalise" it. |
| Axios refresh interceptor | `frontend/src/api/axios.ts:45-109` | The queue-and-replay logic is correct and easy to break. Extend for SSE; do not rewrite. |
| Kanban drag handler | `frontend/src/pages/KanbanPage.tsx:402-467` | Optimistic-with-rollback plus per-task locking is subtle and correct. |
| Bulk creation two-phase design | `task-service/src/services/task.service.ts:129-206` | Add a transaction around phase 2; leave the structure alone. |
| Response envelope | all services | `{ success, data / message }` is universally applied and correctly consumed. Standardise the two exceptions **onto** it. |
| Error middleware | `packages/shared/errors/error.middleware.ts` | The `CastError` and `ValidationError` → 400 mappings prevent a whole class of 500s. |
| Onboarding page layout | `frontend/src/pages/CreateWorkspacePage.tsx` | The dual join/create design already satisfies the new-user requirement. Commit the sidebar counterpart; do not redesign this page. |
| AppShell breakpoints | `frontend/src/layouts/AppShell.tsx:18-36` | The three-tier responsive strategy works. Fix colours inside pages, not the shell. |
| Workspace-switch invalidation | `KanbanPage`, `MeetingSummarizerPage`, `useDocuments`, `useAiQuery` | Audited surface by surface — every workspace-scoped view clears and refetches correctly. No stale data anywhere. |

---

*Generated from the ResearchMind Phase 1 → Phase 4 Master Audit. Re-verify line numbers before editing — they reflect the repository state at audit time.*
