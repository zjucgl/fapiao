# fapiao backend (M1)

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

## Initial credentials

Set via env vars:
- `SUPER_ADMIN_USERNAME` (e.g., `admin`)
- `SUPER_ADMIN_INITIAL_PASSWORD` (e.g., `admin123`)

The super_admin row is auto-created on first boot if it doesn't exist. **First login forces password change.**
