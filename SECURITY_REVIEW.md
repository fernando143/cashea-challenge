# Security Review — `insecure/auth.ts`

Revisión del módulo de autenticación y consulta de crédito provisto en `insecure/auth.ts`. Diez hallazgos, documentados y corregidos en el lugar (no reescrito desde cero).

## 1. `jwt.decode()` en vez de `jwt.verify()`, y el middleware nunca corta la request

- **Severidad:** Crítica
- **Impacto:** `authenticate()` nunca valida la firma del token — cualquiera puede forjar un JWT con cualquier `userId` sin conocer el secreto. Además, `next()` se llama incondicionalmente: sin token, con token inválido o con `decoded` vacío, la request igual llega al handler con `req.userId` en `undefined`. Son dos problemas independientes, no solo uno: aunque se corrija la función usada, si el middleware no corta la request cuando la verificación falla, sigue sin bloquear nada.
- **Corrección:** `jwt.verify(token, JWT_SECRET)` dentro de un `try/catch`; si falla o no hay token, responder 401 y no llamar a `next()`.

## 2. SQL injection en `/login`

- **Severidad:** Crítica
- **Impacto:** `email`/`password` interpolados directo en el query string. Permite bypassear el login sin credenciales válidas (ej. `' OR '1'='1`) o ejecutar SQL arbitrario contra la base.
- **Corrección:** query parametrizada (`$1`, `$2`), nunca interpolar input del usuario en SQL.

## 3. SQL injection en `/credit-line`

- **Severidad:** Crítica
- **Impacto:** mismo patrón que el hallazgo 2, vía `userId`. Permite leer o manipular datos arbitrarios de la base.
- **Corrección:** query parametrizada.

## 4. IDOR — `req.query.userId || req.userId`

- **Severidad:** Crítica
- **Impacto:** cualquier usuario autenticado puede leer la línea de crédito (incluido `card_number`) de cualquier otro usuario, pasando su `userId` por query string.
- **Corrección:** usar siempre el `userId` del token verificado; nunca aceptar un identificador de usuario como parámetro externo.

## 5. Passwords en texto plano

- **Severidad:** Alta
- **Impacto:** un leak de la base (backup expuesto, acceso indebido) expone todas las contraseñas en claro, reutilizables en otros servicios por los mismos usuarios.
- **Corrección:** hash con bcrypt/argon2 al crear el usuario, comparación vía `bcrypt.compare()` en el login — nunca se guarda ni se compara texto plano.

## 6. `JWT_SECRET` hardcodeado

- **Severidad:** Alta
- **Impacto:** cualquiera con acceso al código fuente (repo, leak) puede firmar tokens válidos para cualquier usuario.
- **Corrección:** variable de entorno, nunca versionada en el repositorio.

## 7. `card_number` completo en la respuesta

- **Severidad:** Alta
- **Impacto:** expone el número completo de tarjeta (dato PCI) a cualquier cliente con acceso al endpoint.
- **Corrección:** no seleccionar `card_number` en la query; el medio de pago se expone solo como últimos 4 dígitos + marca (ver `DESIGN.md` → Medio de pago).

## 8. PII y credenciales logueadas en texto plano

- **Severidad:** Media
- **Impacto:** el `console.log` expone tanto el email como el password de cada intento de login en los logs del servidor, accesible a cualquiera con acceso a esos logs. No es solo el password — es el problema general de loguear PII/credenciales sin necesidad.
- **Corrección:** eliminar el `console.log`; nunca loguear credenciales ni PII sensible.

## 9. JWT sin `expiresIn`

- **Severidad:** Media
- **Impacto:** un token robado (XSS, log leak) sigue siendo válido indefinidamente.
- **Corrección:** firmar con `expiresIn` (15 min, ver `DESIGN.md` → Autenticación y autorización).

## 10. Sin rate limiting en `/login`

- **Severidad:** Media
- **Impacto:** permite fuerza bruta o credential stuffing sin fricción.
- **Corrección:** limiter en memoria (`express-rate-limit`) por IP/email, solo en `/login`. Distinto del rate limiting general de la API, que queda fuera de scope (ver `DESIGN.md` → Fuera de scope).
