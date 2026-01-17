import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Global error handler middleware.
 * Catches unhandled errors and returns a consistent JSON error response.
 * Logs errors for debugging and hides details in production.
 * @param err - The error that was thrown
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function (unused but required for Express error handler signature)
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);

  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
}

/**
 * 404 Not Found handler.
 * Mounted after all routes to catch unmatched paths.
 * @param req - Express request object
 * @param res - Express response object
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/**
 * Wraps async route handlers to catch rejected promises.
 * Automatically forwards errors to the Express error handler.
 * @param fn - Async route handler function
 * @returns Express RequestHandler that handles promise rejections
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Request logging middleware.
 * Logs HTTP method, path, status code, and response time for each request.
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`
    );
  });

  next();
}
