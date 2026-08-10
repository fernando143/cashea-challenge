export class ApiError extends Error {
  constructor(message, { status = 0, code = null, retryAfter = null, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  async function request(path, { token, ...options } = {}) {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    let response;
    try {
      response = await fetchImpl(path, { ...options, headers });
    } catch (cause) {
      throw new ApiError("The request could not be completed. Try again.", {
        code: "NETWORK_ERROR",
        cause,
      });
    }

    const body = await response.json();
    if (!response.ok) {
      if (
        body === null ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.error !== "string" ||
        ("code" in body && body.code !== null && typeof body.code !== "string")
      ) {
        throw new TypeError("Invalid API error response");
      }

      throw new ApiError(body.error, {
        status: response.status,
        code: body.code ?? null,
        retryAfter: response.headers.get("Retry-After"),
      });
    }
    return body;
  }

  return {
    login(credentials) {
      return request("/login", {
        method: "POST",
        body: JSON.stringify(credentials),
      });
    },
    getCreditLine(token) {
      return request("/credit-line", { token });
    },
    previewPurchase(input, token) {
      return request("/purchases/preview", {
        method: "POST",
        token,
        body: JSON.stringify(input),
      });
    },
    createPurchase(input, idempotencyKey, token) {
      return request("/purchases", {
        method: "POST",
        token,
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(input),
      });
    },
  };
}
