/** Domain errors mapped to HTTP status in the global error handler (see src/app.ts). */
export class AppError extends Error {
  constructor(public status: number, message: string, public code = 'APP_ERROR') {
    super(message)
  }
}
export class NotFoundError extends AppError {
  constructor(what = 'Resource') { super(404, `${what} not found`, 'NOT_FOUND') }
}
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') { super(403, message, 'FORBIDDEN') }
}
export class BadRequestError extends AppError {
  constructor(message: string) { super(400, message, 'BAD_REQUEST') }
}
export class IntegrationError extends AppError {
  constructor(service: string, status: number, detail: string) {
    super(status >= 500 || status === 0 ? 502 : status === 401 || status === 403 ? 502 : status,
      `${service} error (${status}): ${detail}`, 'INTEGRATION_ERROR')
  }
}
export class NotConnectedError extends AppError {
  constructor(service: 'jira' | 'bitbucket') {
    super(409, `Your ${service === 'jira' ? 'Jira' : 'Bitbucket'} account is not connected yet. Open Connections to link it.`, 'NOT_CONNECTED')
  }
}
export class PeriodExistsError extends AppError {
  constructor(public existingPlanId: string, period: string) {
    super(409, `You already have a PGP for ${period}.`, 'PERIOD_EXISTS')
  }
}
