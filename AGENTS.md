# Repository Guidelines

## Project Structure & Module Organization

This Node.js, Express, and PostgreSQL backend supports a financial fraud detection dashboard. Runtime code lives in `src/`:

- `src/server.js` starts the HTTP server; `src/app.js` wires middleware and routes.
- `src/routes/` contains Express routes grouped by API area.
- `src/services/` contains business logic and service tests (`*.service.test.js`).
- `src/db/` contains PostgreSQL pool setup, initialization, and seed scripts.
- `src/config/` loads environment settings; `src/middlewares/` contains Express middleware.
- `sql/schema.sql` defines database schema. Environment examples are in `.env.example`.

## Build, Test, and Development Commands

- `npm install`: install locked dependencies.
- `copy .env.example .env`: create a local environment file on Windows.
- `docker compose up -d`: start PostgreSQL locally.
- `npm run db:init`: initialize the database schema.
- `npm run db:seed:customers`: seed sample customers.
- `npm run dev`: run the API with `nodemon` for local development.
- `npm start`: run the API with Node.
- `npm run test:rules`, `npm run test:actions`, `npm run test:ars`, `npm run test:policy`, `npm run test:memo`: run service-level tests.

The API base URL is `http://localhost:4000/api`; health check is `GET /health`.

## Coding Style & Naming Conventions

Use CommonJS (`require`/`module.exports`) and keep modules focused by layer: routes handle HTTP, services handle business logic, and db modules handle persistence. Follow the existing style: two-space indentation, semicolons, single quotes, and `camelCase` for variables and functions. File names use lowercase kebab or dotted patterns, such as `auth.routes.js`, `detection.service.js`, and `memo-validation.service.test.js`.

No formatter or linter is currently configured, so keep diffs small and match nearby code.

## Testing Guidelines

Tests are plain Node scripts using `assert`, usually colocated in `src/services/`. Name new tests as `<feature>.service.test.js` and add an npm script when useful. Some tests access PostgreSQL through `pool`, so start Docker and run `npm run db:init` before database-backed tests.

## Commit & Pull Request Guidelines

Git history uses Conventional Commits with prefixes such as `feat:`. Prefer short messages like `feat: add ARS policy test` or `fix: handle missing admin user`.

Pull requests should include a summary, affected API or service areas, database or environment changes, and test commands run. Link related issues when available. Include screenshots only for dashboard or API documentation changes.

## Security & Configuration Tips

Do not commit real `.env` values, credentials, logs, or generated local artifacts. Keep `.env.example` updated when adding configuration. Validate request input with existing patterns such as `zod`, and preserve authentication and role checks in route changes.
