# Docker Deployment & Container Process — ResearchMind

## Overview

ResearchMind uses Docker Compose to orchestrate local infrastructure components (MongoDB database and Redis cache/queue server).

---

## Infrastructure Services (`docker-compose.yml`)

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:7.0
    container_name: researchmind-mongodb
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db

  redis:
    image: redis:7-alpine
    container_name: researchmind-redis
    ports:
      - "6379:6379"

  mongo-express:
    image: mongo-express:latest
    container_name: researchmind-mongo-express
    ports:
      - "8081:8081"
    environment:
      ME_CONFIG_MONGODB_SERVER: mongodb
      ME_CONFIG_MONGODB_PORT: 27017

volumes:
  mongodb_data:
```

---

## Database Schema & Databases Hosted in MongoDB Container

1. **`researchmind-auth`**: Stores user authentication profiles (`users`) and refresh token records (`tokens`).
2. **`researchmind-workspace`**: Stores research workspaces (`workspaces`) and team member memberships (`members`).
3. **`researchmind-documents`**: Stores document metadata, extracted text, and Cloudinary URLs (`documents`).

---

## Redis Container Usage

- **Rate Limiting**: API Gateway sliding window rate limiter.
- **Queue Producer**: Document Service pushes embedding job JSON strings into list `researchmind:embedding:jobs`.

---

## Quick Commands

```bash
# Start infrastructure containers
docker-compose up -d

# View container status
docker-compose ps

# View container logs
docker-compose logs -f

# Stop containers
docker-compose down
```
