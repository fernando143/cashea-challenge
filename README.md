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
2. `docker compose up -d --build` — levanta Postgres, espera su healthcheck,
   ejecuta las migraciones y recién entonces inicia el backend.
3. Sembrar datos de prueba desde el host: `PGHOST=localhost npm run seed` — crea un usuario con credenciales conocidas y una línea de crédito, para poder loguearse desde el frontend.
4. Verificar el servicio: `curl http://localhost:3000/health`.
5. Abrir `http://localhost:3000/` para usar el frontend mínimo de login,
   simulación y confirmación.

El servicio `migrate` es one-shot: termina con código cero cuando no quedan
migraciones pendientes. La aplicación depende de ese resultado y no arranca si
una migración falla. Para diagnosticarlo: `docker compose logs migrate`.

`.env` es la fuente de configuración del runtime para conexión, puerto, JWT y
seed. La aplicación y Postgres consumen `PGHOST`, `PGPORT`, `PGUSER`,
`PGPASSWORD`, `PGDATABASE`, `PORT`, `JWT_SECRET`, `SEED_EMAIL` y
`SEED_PASSWORD`; Compose fija `NODE_ENV=production` para la aplicación y el
migrator. No se usa `DATABASE_URL` ni se mantienen credenciales fallback en
`docker-compose.yml`.

### Tests

- `npm test` — tests unitarios y del frontend; no requiere `.env` ni una base local.
- `npm run test:unit` — tests unitarios.
- `npm run test:integration` — tests contra PostgreSQL real, no mocks (ver `DESIGN.md` → Testing).
- `npm run test:coverage` — prepara la base y ejecuta toda la suite una sola vez con cobertura.
- `npm run lint` — ESLint sobre el código fuente y los tests.
- `npm run typecheck` — chequeo estático de TypeScript.

La cobertura instrumenta el runtime de `src/**/*.ts` y los módulos del cliente
en `frontend/`; exige al menos
80% en líneas, statements, branches y funciones. Se excluyen el bootstrap de
`src/server.ts`, los tipos sin runtime de `src/repositories/types.ts` y los
scripts operativos de `scripts/`. También se excluye `frontend/main.mjs`, que es
el composition root del navegador.

Para integración, copiar `.env.test.example` a `.env.test` y mantener
`PGDATABASE=cashea_test`. El hook `pretest:integration` crea esa base si no
existe y aplica las migraciones. Los tests resetean sus tablas con `TRUNCATE`
antes de cada caso; nunca apuntan a la base de desarrollo.

Los comandos de migración y seed también usan las variables `PG*` individuales:

- `npm run migrate:up`
- `npm run migrate:down`
- `npm run seed`

### CI

GitHub Actions ejecuta en los pushes a `main` y en pull requests: `lint`,
typecheck, la suite completa con cobertura contra PostgreSQL efímero, `build` y
los targets Docker `migrator` y `runtime`. La suite corre una sola vez y publica
su LCOV en Codecov. La integración siempre usa `cashea_test`; nunca usa la base
de desarrollo.

### Contrato monetario

La API recibe y devuelve enteros JSON en centavos, entre `1` y `99_999_999`.
No acepta strings ni decimales. Dominio y persistencia operan con enteros
(`bigint`/`BIGINT`); sólo el frontend aplica formato de moneda para mostrar VES.

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
