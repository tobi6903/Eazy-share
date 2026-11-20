// Errors that carry an HTTP status, so the service layer never needs to know about HTTP.

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequest extends ServiceError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class Unauthorized extends ServiceError {
  constructor(message: string) {
    super(message, 401);
  }
}

export class NotFound extends ServiceError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class Conflict extends ServiceError {
  constructor(message: string) {
    super(message, 409);
  }
}

export class LengthRequired extends ServiceError {
  constructor(message: string) {
    super(message, 411);
  }
}
