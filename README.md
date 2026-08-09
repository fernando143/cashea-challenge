# Cashea — Take-Home Challenge

[![CI](https://github.com/fernando143/cashea-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/fernando143/cashea-challenge/actions/workflows/ci.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=fernando143_cashea-challenge&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=fernando143_cashea-challenge)
[![codecov](https://codecov.io/gh/fernando143/cashea-challenge/branch/main/graph/badge.svg)](https://codecov.io/gh/fernando143/cashea-challenge)

Backend de un flujo de compras en cuotas (BNPL), con frontend mínimo y la revisión de seguridad de `insecure/auth.ts` corregida. Detalle de las decisiones de diseño en [`DESIGN.md`](./DESIGN.md), hallazgos de seguridad en [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md).

## Cómo correr todo

### Prerrequisitos

- Docker + Docker Compose
- Node.js 20+ (para ejecutar migraciones, seed y tests desde el host)

### Pasos

1. Copiar `.env.example` a `.env`: `cp .env.example .env`.
2. `docker compose up -d --build` — levanta el backend y Postgres.
3. Correr las migraciones desde el host: `PGHOST=localhost npm run migrate:up`.
4. Sembrar datos de prueba desde el host: `PGHOST=localhost npm run seed` — crea un usuario con credenciales conocidas y una línea de crédito, para poder loguearse desde el frontend.
5. Verificar el servicio: `curl http://localhost:3000/health`.
6. Abrir `http://localhost:3000/` para usar el frontend mínimo de login,
   simulación y confirmación.

`.env` es la única fuente de configuración del runtime. La aplicación y
Postgres consumen `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`,
`PORT`, `NODE_ENV`, `JWT_SECRET`, `SEED_EMAIL` y `SEED_PASSWORD`; no se usa `DATABASE_URL` ni se mantienen
credenciales fallback en `docker-compose.yml`.

### Tests

- `npm test` — tests unitarios (seguros para ejecutar sin una base local).
- `npm run test:unit` — tests unitarios.
- `npm run test:integration` — tests contra PostgreSQL real, no mocks (ver `DESIGN.md` → Testing).
- `npm run test:coverage` — suite con cobertura.
- `npm run lint` — ESLint sobre el código fuente y los tests.
- `npm run typecheck` — chequeo estático de TypeScript.

Para integración, copiar `.env.test.example` a `.env.test` y mantener
`PGDATABASE=cashea_test`. El hook `pretest:integration` crea esa base si no
existe y aplica las migraciones. Los tests resetean sus tablas con `TRUNCATE`
antes de cada caso; nunca apuntan a la base de desarrollo.

Los comandos de migración y seed también usan las variables `PG*` individuales:

- `npm run migrate:up`
- `npm run migrate:down`
- `npm run seed`

### CI

GitHub Actions ejecuta en cada push y pull request `lint`, tests unitarios,
tests de integración contra un servicio PostgreSQL efímero, cobertura de la
capa unitaria y `build`. La integración siempre usa `cashea_test`; nunca usa
la base de desarrollo.

### Credenciales de prueba

- El email y password del usuario semilla salen de `SEED_EMAIL` y
  `SEED_PASSWORD` en `.env`; el password nunca se guarda en el código fuente.

## mejoras para v2

Detalle completo y el porqué de cada uno en `DESIGN.md` → Fuera de scope. Resumen:

- Sistema de niveles de crédito / scoring
- Ledger contable completo / event sourcing
- Modelo de comercios (`Merchant`) y reconciliación
- Notificaciones, colas de mensajes
- Mora, intereses, refunds, cobranza
- Pago parcial de cuotas
- Rate limiting general en la API, MFA, blacklist de JWT, step-up auth
- Refresh token
- Redis como store de idempotencia (a escala, como cache delante de Postgres)
- Escalado horizontal, sharding, caching, circuit breakers
- Despliegue y observabilidad técnica avanzada (APM, tracing, alerting)
- Dashboard de salud de negocio (Grafana sobre Postgres)
