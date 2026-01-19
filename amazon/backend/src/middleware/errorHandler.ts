import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

interface AppError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
}

export const errorHandler: ErrorRequestHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error('Error:', err);

  if (err.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation failed',
      details: err.details
    });
    return;
  }

  if (err.code === '23505') {
    // PostgreSQL unique violation
    res.status(409).json({
      error: 'Resource already exists'
    });
    return;
  }

  if (err.code === '23503') {
    // PostgreSQL foreign key violation
    res.status(400).json({
      error: 'Invalid reference to related resource'
    });
    return;
  }

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
};
