export class AppError extends Error {
  constructor(code, status = 400, message = code, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL_ERROR', 500, 'internal error');
}
