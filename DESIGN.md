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
| id | UUID | PK |
| user_id | UUID | FK → User |
| operation | TEXT | `purchase` \| `payment` |
| key | TEXT | UNIQUE junto a usuario y operación |
| request_hash | TEXT | evita reusar una clave para otro request |
| response_code | TEXT | resultado semántico, independiente de HTTP |
| response_body | JSONB | respuesta persistida para replay |
| created_at | TIMESTAMPTZ | |

## Arquitectura y stack

- **Capas**, no hexagonal — complejidad innecesaria para este tamaño.
- **PostgreSQL**: ACID para transacciones multi-tabla, updates condicionales atómicos para la concurrencia, modelo relacional que encaja con la cadena de entidades.
- **Sin ORM**: SQL parametrizado vía `pg`, control total sobre las queries críticas.
- **Migraciones versionadas** (archivos `.sql` ordenados por timestamp), no un
  `init.sql` mutable — el schema puede evolucionar sin reescribir el historial.
- **Límites explícitos entre HTTP, aplicación y persistencia** para compras,
  cuotas y crédito. `src/insecure/auth.ts` es la única excepción: pertenece al
  challenge y se conserva sin modificaciones, incluyendo sus queries directas.

## Decisiones de diseño

### Dinero

La API acepta y devuelve enteros JSON en centavos, nunca strings ni decimales.
El rango público es `1..99_999_999`, por debajo de `Number.MAX_SAFE_INTEGER` y
del límite de PostgreSQL. Dominio y repositorios operan con `bigint`/`BIGINT`;
sólo la presentación del navegador transforma centavos a moneda VES con
`Intl.NumberFormat`. Reparto de cuotas: cuando no divide exacto, las primeras
cuotas absorben el resto, para que la suma cierre siempre contra el monto
original.

### Concurrencia

Update condicional atómico (`available >= :amount` en el `WHERE`) como primer paso de la transacción de compra — resuelve compras/pagos simultáneos del mismo usuario (double-click, retry, tabs duplicadas) sin necesitar un lock explícito aparte. Se descartaron `SELECT FOR UPDATE` (más verboso para una condición simple), optimistic locking (complejidad de reintento sin beneficio acá) y advisory locks (innecesario cuando ya hay una fila que lockear). El `CHECK` en `credit_lines` es una red de seguridad adicional, no el mecanismo principal.

### Idempotencia

`Idempotency-Key` en pagar cuota y crear compra, con el registro en la misma transacción que el movimiento de dinero — evita guardar una respuesta de éxito para una operación que en realidad hizo rollback. Se descartó Redis: un store separado del Postgres transaccional rompe esa atomicidad, y resuelve un problema de escala que este challenge no tiene.

Por simplicidad, el frontend es responsable de la intención de compra en este
challenge: genera una sola clave aleatoria por combinación normalizada de monto y
cuotas, y persiste en `localStorage` la clave junto con el usuario y el fingerprint
del request. La misma intención recupera la clave después de recargar o volver a
previsualizar; se elimina al cambiar el formulario o el usuario, cerrar sesión y
apenas la creación de la compra confirma éxito. `localStorage` es una dependencia
requerida del flujo: sus fallos se propagan y no existe un fallback en memoria. En
producción, el backend debería crear y poseer la intención mediante un `checkout
session id`: evita confiar este lifecycle a un único cliente y permite coordinar
reintentos, múltiples dispositivos y expiración centralizada.

### Compra, cuotas y pagos

La cuota 1 se liquida en la misma transacción que crea la compra, reusando la lógica de pago — el disponible que ve el usuario refleja solo lo pendiente. Vencimiento mensual anclado a la fecha de compra. Cuota ya pagada se rechaza (409). Sin pago parcial ni restricción de orden entre cuotas. Monto mínimo validado contra la cantidad de cuotas, para evitar cuotas de valor cero al repartir.

### API

`GET /purchases/:id` devuelve el detalle con un único campo `plan`.
`POST /purchases/preview`, sin efectos secundarios, reusa la misma función de split
que la creación real — evita que el plan mostrado antes de confirmar diverja
del que efectivamente se crea. La frontera HTTP convierte resultados semánticos
a status y DTOs; los errores usan `{ error, code }` y nunca exponen HTML, stack
ni paths internos. `/login` conserva su contrato original porque vive en el
archivo congelado del challenge.

### Autenticación y autorización

JWT real vía el middleware corregido de la Parte 3, reusado en toda la Parte 1 — no un `userId` de contexto simplificado, que hubiera reproducido el IDOR de la Parte 3 en código propio. `src/insecure/auth.ts` permanece **congelado byte por byte**, como exige el challenge: no se mueve, formatea, envuelve ni adapta aunque mezcle router, middleware, SQL y transporte. Esta excepción no define el patrón para código nuevo. Cada recurso con ID en la URL se filtra por el usuario autenticado directo en la query, sin middleware de autorización aparte; 404 uniforme si no matchea. Access token de vida corta (15 min).

### Medio de pago

Solo últimos 4 dígitos + marca, nunca el PAN completo — sin librería de tokenización, evitando el problema de raíz en vez de enmascararlo después. Consistente con el hallazgo #7 de `SECURITY_REVIEW.md`.

## Frontend

HTML+fetch con módulos JavaScript, sin framework — la Parte 2 pide
explícitamente no invertir tiempo en diseño visual. `src/app.ts` sirve
`frontend/` como estático desde la misma aplicación. Flujo: login → ver crédito
→ simular compra → confirmar → reflejar el disponible. El cliente conserva una
clave idempotente persistida por intención ante resultados inciertos, invalida la
intención cuando cambia el formulario o el usuario, cierra la sesión de forma
explícita y bloquea transiciones mientras confirma una compra. Es también la única
capa que formatea moneda. La coordinación se divide en `SessionController`
(login, logout, token, usuario y crédito) y `CheckoutController` (preview,
intención persistida y confirmación); `CheckoutPageController` sólo los compone
para la página. Así cada controller tiene una única razón de cambio y el lock de
interacción compartido evita duplicar la regla de no cambiar sesión durante una
confirmación.

## Testing

`npm test` ejecuta lógica de negocio y cliente en aislamiento, sin variables de
entorno ni DB. La integración usa Postgres real para concurrencia y
transacciones. `npm run test:coverage` prepara la base y ejecuta la suite completa
una sola vez, con un umbral global de 80%.

## CI y calidad

GitHub Actions verifica pushes a `main` y pull requests con lint, typecheck de
fuente/scripts/tests, una ejecución completa con cobertura, build TypeScript y
build de los targets Docker. LCOV se publica en Codecov. SonarCloud permanece
como quality gate externo; no forma parte del runtime ni implica despliegue.

## Runtime y migraciones

La imagen usa stages separados. `migrator` contiene `tsx`,
`node-pg-migrate`, scripts y migraciones; `runtime` contiene sólo dependencias de
producción, `dist/` y el frontend, y se ejecuta como el usuario no-root `node`.
Compose espera el healthcheck de PostgreSQL, ejecuta `migrator` como servicio
one-shot y sólo inicia la aplicación si termina exitosamente. `001` permanece
intacta; las migraciones nuevas usan nombres con timestamp soportados por
`node-pg-migrate`.

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
