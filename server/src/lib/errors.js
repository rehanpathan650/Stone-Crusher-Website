export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, fields) => Object.assign(new HttpError(400, message, 'VALIDATION'), { fields });
export const unauthorized = (message = 'Please sign in') => new HttpError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'You do not have permission to do this') => new HttpError(403, message, 'FORBIDDEN');
export const notFound = (message = 'Not found') => new HttpError(404, message, 'NOT_FOUND');
export const conflict = (message, code = 'CONFLICT', details) => new HttpError(409, message, code, details);
