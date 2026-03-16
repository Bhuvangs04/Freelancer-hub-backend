# Architecture Risk Audit (Freelancer Hub Backend)

## Scope
Quick architecture-level audit covering reliability, security, and operational risks across auth, payments, storage, websocket, and observability paths.

## Executive Summary
- **Overall risk:** Medium-High (security + availability coupling).
- **Highest-impact concerns:**
  1. WebSocket identity spoofing risk (no auth on socket handshake).
  2. Database/process tight coupling (startup exits on DB/env failures).
  3. Public access to user media/resume endpoints.
  4. Request-metric write amplification (every request persisted to MongoDB).
  5. Payment finalization depends on synchronous API path (no webhook-driven reconciliation).

## Key Single Points of Failure (SPOFs)
1. **Single Node process for all concerns (HTTP API + WS + business logic).**
   - If process crashes/OOMs, all API and realtime traffic drops together.
2. **MongoDB availability is a hard dependency at boot.**
   - Startup exits process when `MongoDBURL` is missing/connection fails.
3. **Metrics pipeline tied directly to primary DB.**
   - Every request can trigger DB writes, risking self-induced degradation during spikes.
4. **Payment state transition centralized in one request flow.**
   - If client callback path fails at critical moment, payment reconciliation can drift.

## Major Findings

### 1) WebSocket authentication/authorization gap (Critical)
- User identity is taken from URL path segment (`extractUserId`) without token verification.
- This enables potential socket impersonation and unauthorized message routing.

### 2) Startup/runtime resilience gaps (High)
- Process exits on DB config/connection errors; no degraded-mode boot strategy.
- App runs as one instance per process by design; no built-in worker isolation.

### 3) Sensitive document exposure via unauthenticated routes (High)
- Profile picture proxy and resume view/download routes are public with only `userId`.
- This creates predictable-ID data exposure risk.

### 4) Metrics write amplification & noisy-neighbor risk (Medium-High)
- Latency middleware stores each request metric to MongoDB asynchronously.
- Under traffic spikes, this can increase DB pressure and back up event loop tasks.

### 5) Crypto and credential handling weaknesses (Medium)
- Login uses reversible XOR obfuscation with hardcoded key; this is not meaningful transport security.
- Fallback secrets exist in non-production code paths; risks accidental weak deployments.

### 6) Idempotency model collision domain (Medium)
- Idempotency key has a global unique index while runtime lookup uses `key + userId`.
- Different users reusing same key can collide unexpectedly.

## Recommended Remediation Plan (Prioritized)
1. **Immediately secure WebSocket handshake** using JWT auth in upgrade request and enforce sender==token user.
2. **Protect media endpoints** (`/profile-picture/:userId`, `/resume/*`) with auth + authorization or signed URL policy.
3. **Decouple observability writes**: sample metrics, buffer via queue, or send to separate telemetry store.
4. **Add payment webhook reconciliation** (Razorpay webhook signature validation + retryable state machine).
5. **Harden secrets/config lifecycle**: fail CI/CD if JWT/ENCRYPTION/RAZORPAY envs missing; remove weak fallbacks.
6. **Fix idempotency indexing** to compound unique (`key`, `userId`, `endpoint`) and enforce consistent lookup semantics.
7. **Improve HA posture**: run multiple instances behind LB, add health/readiness checks tied to critical dependencies.

## Suggested SLO-Oriented Guardrails
- Define SLOs for auth latency, payment consistency, and DB error budget.
- Add circuit breakers/timeouts for third-party calls (Razorpay/email).
- Add alerting for: DB disconnects, webhook lag, withdrawal queue backlog, and 5xx spikes.
