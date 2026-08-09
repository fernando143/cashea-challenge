# Cashea — Take-Home Challenge

Backend de un flujo de compras en cuotas (BNPL), con frontend mínimo y la revisión de seguridad de `insecure/auth.ts` corregida. Detalle de las decisiones de diseño en [`DESIGN.md`](./DESIGN.md), hallazgos de seguridad en [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md).

## Cómo correr todo

### Prerrequisitos

- Docker + Docker Compose

### Pasos

1. Copiar `.env.example` a `.env`.
2. `docker-compose up` — levanta el backend y Postgres.
3. Correr las migraciones: `npm run migrate:up`.
4. Sembrar datos de prueba: `npm run seed` — crea un usuario con credenciales conocidas y una línea de crédito, para poder loguearse desde el frontend.
5. Frontend: servido como estático por el propio backend (o abrir `frontend/index.html` directo, según quede resuelto en la implementación).

### Tests

- `npm test` — unit tests.
- `npm run test:integration` — test de concurrencia contra una Postgres real, no mocks (ver `DESIGN.md` → Testing).

### Credenciales de prueba

- Email y password del usuario semilla: ver salida del script `npm run seed`.

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
