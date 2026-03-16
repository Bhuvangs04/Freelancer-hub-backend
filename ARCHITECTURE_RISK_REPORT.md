# FreelancerHub Backend — Architecture Risk Review (Concise)

## Scope
Static architecture/security/reliability review of the Node.js API, middleware, websocket layer, and critical workflows (auth, payments, disputes, file handling, messaging).

## Executive Summary
The codebase has solid domain coverage, but there are **several high-impact reliability and security risks** concentrated around:
1. **Infrastructure single points of failure** (MongoDB dependency, startup hard-fail behavior).
2. **Identity and authorization gaps** (trusting request body fields, unauthenticated destructive endpoint).
3. **Operational coupling** (dual websocket stacks, request-level metrics persisted to primary DB, single provider dependencies).
4. **Abuse pathways** (OTP brute force/vector, public PII/document access, unprotected email relay endpoint).

---

## Critical Flaws (Highest Priority)

### 1) Unauthenticated destructive endpoint (file deletion)
- `DELETE /projects/:projectId/files/:fileId` is exposed **without `verifyToken`**.
- This enables unauthorized deletion attempts against project files.
- Evidence: `routes/WorkSubmission.js` delete route lacks auth middleware.

**Impact:** Unauthorized data tampering and potential business disruption.

---

### 2) Broken object-level authorization (BOLA/IDOR pattern)
- Multiple endpoints accept `sender`, `receiver`, `projectId`, etc. from request/query body and do not strictly bind them to `req.user.userId`.
- Chat send flow trusts `sender` from body; read flows trust query params.
- Task/file/project operations in work submission validate existence, but ownership/participant checks are inconsistent.

**Impact:** Horizontal privilege escalation and data access/manipulation between tenants.

---

### 3) WebSocket identity spoofing + dual websocket architecture
- WS identity is extracted from URL path only (`req.url?.split('/').pop()`), with no JWT verification during handshake.
- Two websocket implementations exist:
  - `services/websocket.js` bound to main HTTP server.
  - `routes/chat.js` starts separate `new WebSocket.Server({ port: 9000 })`.

**Impact:**
- Identity impersonation in realtime channels.
- Architectural drift and operational fragility (split connection maps, deployment/port conflict complexity).

---

### 4) OTP implementation is weak for production threat models
- OTP values are stored plaintext.
- No attempt counter / lockout on verify.
- No TTL index in schema (expiry enforced only in route logic).

**Impact:** Brute-force and replay risk; sensitive auth data at rest not hardened.

---

### 5) Admin bootstrap exposure
- Public admin signup routes exist (`/signup/admin`, verify, backup regeneration) without a one-time bootstrap or invitation gate.

**Impact:** If surrounding controls are bypassed/misconfigured, attacker could attempt privileged account onboarding path.

---

## Single Points of Failure (SPoF)

### A) MongoDB as hard runtime dependency
- Startup exits process when DB URI missing/connection fails (`process.exit(1)`).
- Most flows (auth, chat persistence, payments, metrics, disputes) are directly DB-coupled.

**SPoF effect:** DB outage can take down the entire API lifecycle and core workflows.

---

### B) Metrics write path on primary DB for every request
- `latencyMonitor` attempts DB insert per request (`RequestMetric.create(...)`).
- Even with async fire-and-forget, this increases write pressure on the same primary datastore.

**SPoF effect:** During traffic spikes, observability can degrade transactional workload by competing on the same database.

---

### C) Email provider coupling
- `sendEmail` uses a single provider SDK path; failures throw and can break dependent flows.

**SPoF effect:** Provider outage can block OTP, notification, dispute communication, and some user journeys.

---

### D) Encryption key/config coupling
- Crypto features rely on `ENCRYPTION_KEY`; behavior differs across modules and missing key handling is inconsistent.

**SPoF effect:** Misconfiguration can break chat/message decryption or crash specific flows at runtime.

---

## Additional Architecture Concerns
- Public document/media endpoints expose profile/resume resources by userId; access policy appears broad and may violate least-privilege expectations.
- Large monolithic route files (notably payment/dispute/admin/freelancer) increase change risk and regression surface.
- Inconsistent error semantics and status codes across modules complicate client-side resiliency.

---

## Recommended Remediation Sequence (Pragmatic)

1. **Immediate security hotfixes (same sprint)**
   - Add `verifyToken` + strict role/ownership checks on all mutating routes (start with WorkSubmission delete, task/file operations, chat send/read).
   - Bind sender/user/project actions to authenticated identity (`req.user.userId`) rather than body-provided ids.
   - Protect WS handshake with JWT, reject unauthenticated sockets.

2. **Stabilize real-time architecture (next sprint)**
   - Consolidate to **one** websocket service and shared connection/session strategy.
   - Remove standalone port-9000 websocket server from route module.

3. **Harden auth/OTP/admin controls**
   - Hash OTP at rest, add per-email+IP attempt limits, and TTL index.
   - Restrict admin bootstrap to invitation token / allowlist / one-time setup flag.

4. **Reduce operational SPoF pressure**
   - Move high-volume metrics to separate store/queue (or sampled writes).
   - Add provider failover/retry queue for email.
   - Add graceful degraded mode for non-critical services during dependency outages.

5. **Governance & verification**
   - Add authorization-focused integration tests for IDOR/BOLA.
   - Add route-level policy matrix (public/authenticated/role/ownership) and enforce via reusable middleware.

---

## Bottom Line
Current design is functional but **risk-concentrated**: a few identity/control weaknesses and shared dependency couplings can materially impact confidentiality, integrity, and availability. Prioritizing authz correctness + websocket hardening + dependency decoupling will yield the highest risk reduction quickly.
