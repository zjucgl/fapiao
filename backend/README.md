# 项目团队发票管理系统 — 后端 (fapiao backend, M1–M4)

## Local dev

```bash
cd backend
npm install
# .env lives at project root; backend reads ../.env
# DB schema is applied via: DATABASE_URL=... npx prisma migrate deploy
npm run start:dev
```

Healthcheck: <http://localhost:3000/api/healthz>

## Tests

```bash
npm test            # unit
npm run test:e2e    # end-to-end (uses real MySQL — wipes user/team tables!)
```

## Endpoints (M1)

| Method | Path | Role |
|---|---|---|
| POST | /api/auth/login | public |
| POST | /api/auth/refresh | public |
| POST | /api/auth/change-password | any authed |
| GET / POST / PATCH | /api/super/teams[/:id] | super_admin |
| GET / POST | /api/super/teams/:teamId/admins | super_admin |
| PATCH | /api/super/teams/:teamId/admins/:userId/password | super_admin |
| PATCH | /api/super/teams/:teamId/admins/:userId/status | super_admin |
| GET / POST | /api/admin/operators | team_admin |
| PATCH | /api/admin/operators/:userId/password | team_admin |
| PATCH | /api/admin/operators/:userId/status | team_admin |

## Endpoints (M2–M4)

| Method | Path | Role |
|---|---|---|
| POST | /api/op/invoices | operator (multipart: paymentMethod, remark, invoiceImages[], proofImages[]) |
| GET | /api/op/invoices | operator |
| GET | /api/op/invoices/:id | operator |
| PATCH | /api/op/invoices/:id | operator (only while unprocessed) |
| DELETE | /api/op/invoices/:id | operator (soft-delete, only while unprocessed) |
| GET | /api/admin/invoices | team_admin (filters: status, invoiceType, paymentMethod, operatorId, fromDate, toDate, amountRegistered, page, pageSize) |
| GET | /api/admin/invoices/:id | team_admin |
| PATCH | /api/admin/invoices/:id | team_admin (register amount + invoiceType) |
| POST | /api/admin/invoices/batch-process | team_admin (`{ ids: string[] }`) |
| POST | /api/admin/invoices/export | team_admin (`{ ids, mode: invoice_only/proof_only/both, alsoMarkProcessed? }`) → `{ parts, expiresInSec }` |
| GET | /api/admin/invoices/export-download/:token | public (token-authed; 5-min TTL) |
| GET | /api/invoices/:invoiceId/images/:imageId/url | operator (own) / team_admin (own team) |
| GET | /api/invoices/:invoiceId/proofs/:imageId/url | operator (own) / team_admin (own team) |

### Upload constraints

- Allowed image MIME: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`
- Max file size: 10 MB
- Max files per kind per invoice: 10

### Image access

Image binaries live in private OSS. Frontend asks `/api/invoices/:invoiceId/{images,proofs}/:imageId/url`, gets a 5-minute signed URL, then displays it directly. Operators can sign their own invoice images; team admins can sign any image in their team.

### Export flow

1. Admin POSTs `/api/admin/invoices/export` with selected ids, mode, and (optional) `alsoMarkProcessed`.
2. Response is a manifest of 1–3 download parts (Excel always; invoice ZIP / proof ZIP per mode), each with a 5-minute HMAC-signed token.
3. Frontend triggers a browser download for each `part.href`. Tokens are public-routable but unforgeable and short-lived.

## Initial credentials

Set via env vars:
- `SUPER_ADMIN_USERNAME` (e.g., `admin`)
- `SUPER_ADMIN_INITIAL_PASSWORD` (e.g., `admin123`)

The super_admin row is auto-created on first boot if it doesn't exist. **First login forces password change.**
