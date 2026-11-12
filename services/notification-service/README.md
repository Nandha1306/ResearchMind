# Notification Service (`notification-service`)

Notification dispatch microservice stub for the **ResearchMind** platform.

---

## 1. Purpose
**Roadmap / not yet implemented.** Planned microservice for real-time notifications, workspace alerts, and email notifications. The application currently sends no notifications of any kind.

---

## 2. Responsibilities
- *Not implemented.* (Service placeholder scaffolded in monorepo structure).

---

## 3. Folder Structure
```
notification-service/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── middlewares/
│   ├── models/
│   ├── routes/
│   ├── services/
│   ├── app.ts                # (Empty placeholder)
│   └── server.ts             # (Empty placeholder)
├── package.json
└── tsconfig.json
```

---

## 4. API Endpoints
*Not implemented.* No active routes are registered in the codebase yet.

---

## 5. Environment Variables
*Not implemented.* No environment variables are read and no port is configured.

---

## 6. Dependencies
- **`winston`**: Declared in `package.json`, not used yet.
- **`typescript`**, **`ts-node`**, **`nodemon`**: Dev dependencies only. `express` is not a dependency yet.

---

## 7. Local Development Commands
```bash
# Install dependencies (from the repository root)
npm install

# No dev, build or start scripts are defined yet (the only script, `test`, is npm's
# placeholder and exits with an error). The service is not started by `npm run dev`
# and is not typechecked in CI.
```

---

## 8. Related Documentation

- Planned notification features: `ResearchMind_readme.md` (Current Implementation Status and section 8.7)
- [Developer onboarding](../../docs/onboarding.md)
