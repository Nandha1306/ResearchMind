# ADR 0003: Database Per Service Isolation Pattern

* **Status**: Accepted
* **Date**: 2026-08-01
* **Deciders**: ResearchMind Core Team

> **Status note (2026-11-11, documentation audit):** each service reads its
> own connection string (`MONGO_URI`; document-, task- and ai-service read
> `MONGODB_URI` first, then `MONGO_URI`; see [environment variables](../reference/environment-variables.md));
> isolation depends on pointing those at different databases. The database
> names in this record are examples, not values enforced by the code.

---

## 1. Context & Problem Statement
Microservices in **ResearchMind** manage distinct domain models (`auth-service` manages User credentials and Refresh Tokens; `workspace-service` manages Workspaces and Memberships; `document-service` manages Research Documents).

We needed to decide how data persistence should be structured across services to support scalability, domain boundaries, and independent deployments.

---

## 2. Options Considered

### Option A: Shared Monolithic Database (Single Database & Connection)
All microservices connect to a single MongoDB database (`researchmind_db`) and query shared collections directly.

* **Pros**: Simple initial setup; easy cross-domain joins and ACID transactions across collections.
* **Cons**: Tight coupling between services; a schema migration in one service can break other services; database performance issues in one service impact the entire system; violates microservice autonomy.

### Option B: Database Per Service with Isolated Databases (Chosen)
Each microservice owns its dedicated, isolated database (`researchmind_auth`, `researchmind_workspace`, `researchmind_document`). Microservices interact strictly through HTTP APIs and user context tokens; direct cross-database queries are forbidden.

* **Pros**: Strong domain boundary isolation; services can scale, optimize, or migrate database schemas independently; database outages in one service do not cascade to others.
* **Cons**: Relational joins across service boundaries are impossible at the database layer; eventual consistency must be managed programmatically.

---

## 3. Decision Rationale
We chose **Option B (Database Per Service)** because:
1. **Domain Autonomy**: A core goal of transitioning ResearchMind to microservices is allowing each service to evolve independently. Direct access to another service's database tables destroys microservice boundaries.
2. **Resilience**: Isolating data stores ensures that high query volume or database failure in `document-service` will not crash critical authentication operations in `auth-service`.
3. **Independent Scalability**: Storage and index tuning can be optimized per service database workload.

---

## 4. Consequences

### Positive
- Strict domain encapsulation and loose coupling between microservices.
- Independent database schema evolution, indexing, and data backups per service.
- Prevented accidental cross-domain data mutations.

### Negative / Tradeoffs
- Cross-service data (e.g. displaying workspace owner details) requires API aggregation or passing verified JWT user context.
- Database integrity across services must be managed programmatically rather than through database foreign keys.
