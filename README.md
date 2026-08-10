# Cashea — Take-Home Challenge

[![CI](https://github.com/fernando143/cashea-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/fernando143/cashea-challenge/actions/workflows/ci.yml)
[![Quality Gate](https://sonarcloud.io/api/project_badges/measure?project=fernando143_cashea-challenge&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=fernando143_cashea-challenge)
[![codecov](https://codecov.io/gh/fernando143/cashea-challenge/branch/main/graph/badge.svg)](https://codecov.io/gh/fernando143/cashea-challenge)

Backend de un flujo de compras en cuotas (BNPL), con frontend mínimo y la revisión de seguridad de `insecure/auth.ts` corregida. Detalle de las decisiones de diseño en [`DESIGN.md`](./DESIGN.md), hallazgos de seguridad en [`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md).

## Levantar challenge
```bash
cp .env.example .env
docker compose up -d --build --wait
docker compose run --rm migrate npm run seed
```

Abrir [http://localhost:3000](http://localhost:3000) e iniciar sesión con los valores de `SEED_EMAIL` y `SEED_PASSWORD` definidos en `.env`.

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
