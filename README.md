# FDS Backend Node

Node.js, Express, and PostgreSQL backend for a financial fraud detection dashboard.

This project is independent from the existing Java/Spring backend.

## Runtime

```bash
npm install
copy .env.example .env
docker compose up -d
npm run db:init
npm run dev
```

- API base URL: `http://localhost:4000/api`
- PostgreSQL: `localhost:5433`

## Seed Accounts

- Admin: `admin@fds.local` / `Admin1234!`
- User: `user@fds.local` / `User1234!`

## Transaction Response Flow

1. Transaction occurs.
2. Risk score is calculated.
3. Risk level is classified.
4. Initial action is decided.
5. Admin dashboard displays the result.
6. Action log is stored.

## Risk Policy

| Risk level | Score | Default handling |
| --- | ---: | --- |
| NORMAL | 0-30 | `APPROVED` |
| SUSPICIOUS | 31-60 | `REQUIRES_AUTH` |
| DANGER | 61+ | `BLOCKED` |

## Transaction Status

- `APPROVED`
- `PENDING_REVIEW`
- `REQUIRES_AUTH`
- `CALL_REQUIRED`
- `CALL_IN_PROGRESS`
- `CALL_CONFIRMED`
- `BLOCKED`
- `CARD_SUSPENDED`

## Admin Actions

Admin action request values:

- `APPROVE`
- `HOLD`
- `BLOCK`
- `REQUEST_AUTH`

Stored audit action values:

- `AUTO_APPROVE`
- `AUTO_REQUIRE_AUTH`
- `AUTO_BLOCK`
- `ADMIN_APPROVE`
- `ADMIN_HOLD`
- `ADMIN_BLOCK`
- `ADMIN_REQUIRE_AUTH`

## Main APIs

### Auth

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`

### User Transactions

- `GET /api/transactions`
- `POST /api/transactions`
- `GET /api/transactions/:id`
- `POST /api/transactions/:id/ars-call`

### Admin

- `POST /api/admin/fake-transactions`
- `GET /api/admin/stats`
- `GET /api/admin/suspicious-transactions`
- `GET /api/admin/transactions/:id`
- `POST /api/admin/transactions/:id/actions`

Admin action body:

```json
{
  "action": "BLOCK",
  "memo": "High risk transfer from new device"
}
```

### Reports

- `GET /api/reports/fraud.csv`
- `GET /api/reports/fraud.pdf`

## Tests

```bash
npm run test:rules
npm run test:actions
```

## Manual ARS Call Verification

`POST /api/transactions/:id/ars-call` manually starts a Twilio ARS call for a transaction that is waiting in `CALL_REQUIRED`. It uses the existing Twilio ARS sender and does not create a second call when the latest call verification is already `CALL_IN_PROGRESS`.

Required `.env` values for a real call:

```bash
TWILIO_ENABLED=true
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FROM_NUMBER=+15017122661
PUBLIC_BASE_URL=https://xxxx.ngrok-free.app
```

Manual check:

```bash
curl -X POST http://localhost:4000/api/transactions/<transaction-id>/ars-call \
  -H "Authorization: Bearer <admin-or-owner-token>"
```

Expected results:

- `CALL_REQUIRED`: returns `201` with `transactionId`, `callVerificationId`, `callStatus`, `twilioCallSid`, and `providerStatus`.
- `CALL_IN_PROGRESS`: returns `200` with `skipped: true` and does not create a new Twilio call.
- `APPROVED`, `CALL_CONFIRMED`, `BLOCKED`, or `CARD_SUSPENDED`: returns `200` with `skipped: true`.
- `TWILIO_ENABLED=false`: returns `503` when a new call would otherwise be started.
