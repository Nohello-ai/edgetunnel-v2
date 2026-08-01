export class AppError extends Error {
  constructor(code, status = 400, message = code, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class UsageLimitError extends Error {
  constructor(message = 'TRAFFIC_QUOTA_EXHAUSTED') {
    super(message);
    this.name = 'UsageLimitError';
    this.code = 'TRAFFIC_QUOTA_EXHAUSTED';
    this.status = 403;
  }
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof UsageLimitError) return error;
  return new AppError('INTERNAL_ERROR', 500, 'internal error');
}
