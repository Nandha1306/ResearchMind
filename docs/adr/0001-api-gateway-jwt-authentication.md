# ADR 0001: Centralized API Gateway & Edge Authentication

* **Status**: Accepted
* **Date**: 2026-08-01
* **Deciders**: ResearchMind Core Team

> **Status note (2026-11-11, documentation audit):** the gateway verifies the
> access token for `/api/workspaces`, `/api/documents`, `/api/tasks` and
> `/api/ai` (`services/api-gateway/src/app.ts`); `/api/auth` is proxied without
> it. Every downstream service ALSO verifies the token itself and checks
> workspace membership against workspace-service, so services do not rely on
> the gateway alone. Services still listen on their own ports, which must not
> be publicly reachable in a deployment. The gateway's CORS policy currently
> allows any origin (`cors()` with no options), so "handles CORS" below means
> it adds CORS headers, not that it restricts origins. See
> [security model](../architecture/security.md).

---

## 1. Context & Problem Statement
In the **ResearchMind** microservices ecosystem, client applications (frontend SPA, mobile, external clients) need to communicate with multiple backend services (`auth-service`, `workspace-service`, `document-service`, etc.).

We needed to decide how to handle client request routing, cross-cutting security concerns (CORS, rate limiting, security headers), and user authentication across microservice boundaries.

---

## 2. Options Considered

### Option A: Decentralized Service Security (No Gateway)
Clients communicate directly with each microservice port (`:5001`, `:5002`, `:5003`). Each microservice independently implements CORS, rate limiting, and JWT token verification.

* **Pros**: No single point of entry failure; microservices are fully autonomous.
* **Cons**: Client must manage multiple URLs; duplicated authentication logic and secret management across every service; exposure of internal microservice ports to public traffic.

### Option B: API Gateway with Edge Authentication (Chosen)
A dedicated API Gateway (`services/api-gateway`) acts as the single public entry point (`:5000`). The Gateway handles rate limiting, CORS, security headers, and verifies JWT tokens on protected routes before proxying traffic downstream.

* **Pros**: Single client entry point; centralized rate-limiting and security policies; unauthenticated or malformed requests are blocked at the perimeter before reaching internal microservices.
* **Cons**: Gateway is a single point of failure; requires shared JWT access secret or public key verification at the gateway layer.

### Option C: Full Service Mesh Architecture (e.g., Istio / Envoy / Kong)
Deploy an enterprise service mesh sidecar pattern to manage traffic and authentication.

* **Pros**: Advanced observability, automatic mutual TLS (mTLS), and enterprise routing rules.
* **Cons**: Overwhelming operational complexity, memory overhead, and steep learning curve for the project's current team size and scale.

---

## 3. Decision Rationale
We chose **Option B (API Gateway with Edge Authentication)** because:
1. **Simplified Client Interface**: The frontend client interacts with a single base URL (`http://localhost:5000`), reducing configuration complexity and avoiding browser CORS issues across multiple origins.
2. **Perimeter Defense**: Validating JWT tokens at the gateway level prevents unauthorized traffic from consuming downstream service resources (compute, database connections).
3. **Developer Velocity**: Microservice authors can focus on domain logic without re-implementing boilerplate CORS, rate-limiting, and authentication middlewares in every new service.

---

## 4. Consequences

### Positive
- Centralized security policies, CORS headers, and global rate limiting.
- Clear separation between public edge traffic and internal service routing.
- Downstream microservices receive pre-authenticated requests.

### Negative / Tradeoffs
- Gateway must be scaled horizontally in production to prevent performance bottlenecks.
- `JWT_ACCESS_SECRET` must be kept in sync between `auth-service` and `api-gateway`.
