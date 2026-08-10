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
