export class AppError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "ERROR",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorStatus(error: unknown): number {
  return error instanceof AppError ? error.status : 500;
}

export function errorMessage(error: unknown): string {
  return error instanceof AppError ? error.message : "Internal server error";
}
