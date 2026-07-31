export class AppError extends Error {
  constructor(code, status = 400, message = code) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError('INTERNAL_ERROR', 500, 'internal error');
}
