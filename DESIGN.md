## Resumen

Backend en Node.js + Express + TypeScript para el flujo de compras en cuotas de Cashea (BNPL), con frontend mínimo en HTML+fetch y la revisión de seguridad de `insecure/auth.ts` corregida en el lugar. Arquitectura en capas sobre PostgreSQL, sin ORM. Las decisiones centrales priorizan la exactitud del dinero: representación en centavos, transacciones atómicas para la concurrencia sobre el crédito disponible, idempotencia en los endpoints que mueven dinero, y autenticación/autorización consistentes entre la Parte 1 y la Parte 3. El detalle de cada decisión, alternativas descartadas y lo que queda deliberadamente fuera de scope está documentado a continuación.

## Modelo de datos

### User

Datos personales y credenciales de login. `PaymentMethod` y `CreditLine` son entidades separadas, relacionadas por `user_id`.

| Campo | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| full_name | TEXT | dato personal |
| document_id | TEXT | documento de identidad |
| email | TEXT | UNIQUE, login |
| password_hash | TEXT | bcrypt/argon2 |
| created_at | TIMESTAMPTZ | |

### CreditLine

Uno por usuario, semilla fija preaprobada.

| Campo | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → User, UNIQUE |
| credit_limit | BIGINT | centavos |
| available | BIGINT | centavos, `CHECK (available >= 0 AND available <= credit_limit)` |
| created_at | TIMESTAMPTZ | |

### Purchase

`status` se deriva de sus `Installment`, no se almacena.

| Campo | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → User |
| amount | BIGINT | centavos |
| installments | SMALLINT | `CHECK (installments IN (3, 6, 12))` |
| created_at | TIMESTAMPTZ | ancla de vencimientos |

### Installment

| Campo | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| purchase_id | UUID | FK → Purchase |
| number | SMALLINT | 1..installments |
| amount | BIGINT | centavos |
| due_date | DATE | |
| status | TEXT | `pending` \| `paid` |
| paid_at | TIMESTAMPTZ | |

### PaymentMethod

| Campo | Tipo | Notas |
|---|---|---|
| id | UUID | PK |
| user_id | UUID | FK → User |
| last_4 | CHAR(4) | nunca el PAN completo |
| brand | TEXT | |
| created_at | TIMESTAMPTZ | |

### idempotency_keys

| Campo | Tipo | Notas |
|---|---|---|
| key | TEXT | PK |
| user_id | UUID | FK → User |
| endpoint | TEXT | |
| response_status | SMALLINT | |
| response_body | JSONB | |
| created_at | TIMESTAMPTZ | |

## Arquitectura y stack

- **Capas**, no hexagonal — complejidad innecesaria para este tamaño.
- **PostgreSQL**: ACID para transacciones multi-tabla, updates condicionales atómicos para la concurrencia, modelo relacional que encaja con la cadena de entidades.
- **Sin ORM**: SQL parametrizado vía `pg`, control total sobre las queries críticas.
- **Migraciones versionadas** (`.up.sql`/`.down.sql`), no un `init.sql` único — el schema iteró durante el desarrollo.
- **Cliente de Postgres en `src/config/db.ts`, no dentro de `src/insecure/`** — al integrar el módulo corregido de la Parte 3 vino acoplado a una conexión a la base propia; se movió a la capa transversal de config porque el resto de los endpoints (compras, cuotas, pagos) también la necesitan, no es exclusiva de auth.

## Decisiones de diseño

### Dinero

Enteros en centavos (`BIGINT`), no `NUMERIC` — evita depender de una librería de decimales en la capa de negocio para no perder precisión al operar. Reparto de cuotas: cuando no divide exacto, las primeras cuotas absorben el resto, para que la suma cierre siempre contra el monto original.

### Concurrencia

Update condicional atómico (`available >= :amount` en el `WHERE`) como primer paso de la transacción de compra — resuelve compras/pagos simultáneos del mismo usuario (double-click, retry, tabs duplicadas) sin necesitar un lock explícito aparte. Se descartaron `SELECT FOR UPDATE` (más verboso para una condición simple), optimistic locking (complejidad de reintento sin beneficio acá) y advisory locks (innecesario cuando ya hay una fila que lockear). El `CHECK` en `credit_lines` es una red de seguridad adicional, no el mecanismo principal.

### Idempotencia

`Idempotency-Key` en pagar cuota y crear compra, con el registro en la misma transacción que el movimiento de dinero — evita guardar una respuesta de éxito para una operación que en realidad hizo rollback. Se descartó Redis: un store separado del Postgres transaccional rompe esa atomicidad, y resuelve un problema de escala que este challenge no tiene.

### Compra, cuotas y pagos

La cuota 1 se liquida en la misma transacción que crea la compra, reusando la lógica de pago — el disponible que ve el usuario refleja solo lo pendiente. Vencimiento mensual anclado a la fecha de compra. Cuota ya pagada se rechaza (409). Sin pago parcial ni restricción de orden entre cuotas. Monto mínimo validado contra la cantidad de cuotas, para evitar cuotas de valor cero al repartir.

### API

`GET /purchases/:id` devuelve el detalle con su plan de cuotas. Se agregó `POST /purchases/preview`, sin efectos secundarios, que reusa la misma función de split que la creación real — evita que el plan mostrado antes de confirmar diverja del que efectivamente se crea.

### Autenticación y autorización

JWT real vía el middleware corregido de la Parte 3, reusado en toda la Parte 1 — no un `userId` de contexto simplificado, que hubiera reproducido el IDOR de la Parte 3 en código propio. Cada recurso con ID en la URL se filtra por el usuario autenticado directo en la query, sin middleware de autorización aparte; 404 uniforme si no matchea. Access token de vida corta (15 min).

### Medio de pago

Solo últimos 4 dígitos + marca, nunca el PAN completo — sin librería de tokenización, evitando el problema de raíz en vez de enmascararlo después. Consistente con el hallazgo #7 de `SECURITY_REVIEW.md`.

### Observabilidad

Logging estructurado con ID de correlación en los flujos de dinero — requisito autoimpuesto, el enunciado no lo pide explícitamente.

## Frontend

HTML+fetch, sin framework — la Parte 2 pide explícitamente no invertir tiempo en diseño visual. Flujo: login → ver crédito → simular compra (preview) → confirmar → reflejar nuevo disponible, con manejo de carga, error y crédito insuficiente.

## Testing

Unit tests sobre la lógica de negocio, especialmente la que mueve dinero. Test de integración contra Postgres real (no mocks) para la concurrencia — es la única forma de probar que el update atómico funciona de verdad.

## CI y calidad

Agregado propio, no pedido por el enunciado: GitHub Actions (lint + tests + cobertura + SonarCloud) en cada push, Codecov, todo dockerizado. Sin despliegue.

## Riesgos y casos difíciles identificados

1. Race condition en compras/pagos concurrentes → update atómico.
2. Reparto de centavos que no divide exacto → primeras cuotas absorben el resto.
3. Monto menor a la cantidad de cuotas → validación de mínimo.
4. Idempotencia sin atomicidad real → misma transacción que el movimiento de dinero.
5. IDOR en endpoints propios → filtro por ownership + 404 uniforme.
6. Preview divergiendo de la compra real → misma función de split.
7. Doble pago de cuota saldada → rechazo 409.
8. Medio de pago repitiendo el hallazgo de seguridad → nunca guardar el PAN.

## Supuestos

- Una línea de crédito por usuario, una sola moneda.
- Límite preaprobado, semilla fija — el proceso de aprobación queda fuera de scope.

## Fuera de scope

- Sistema de niveles de crédito / scoring
- Ledger contable completo / event sourcing
- Modelo de `Merchant` y reconciliación con comercios
- Notificaciones, colas de mensajes, webhooks
- Mora, intereses, refunds, cobranza
- Pago parcial de cuotas
- Rate limiting general (el fix puntual del hallazgo #10 sí se hace), MFA, blacklist de JWT, step-up auth
- Refresh token
- Redis como store de idempotencia
- Escalado horizontal, sharding, caching, circuit breakers
- Despliegue, observabilidad técnica avanzada
- Dashboard de salud de negocio (Grafana sobre Postgres directo)
