import rateLimit from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';
import config from '../config/index.js';

const isTest = config.nodeEnv === 'test';

/** General API rate limiter: 100 requests per minute. */
export const generalRateLimiter = isTest
  ? (_req: Request, _res: Response, next: NextFunction) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, please try again later' },
    });

/** Pin creation rate limiter: 10 pins per minute. */
export const pinRateLimiter = isTest
  ? (_req: Request, _res: Response, next: NextFunction) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      message: { error: 'Too many pins created, please try again later' },
    });

/** Login rate limiter: 5 attempts per minute. */
export const loginRateLimiter = isTest
  ? (_req: Request, _res: Response, next: NextFunction) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      message: { error: 'Too many login attempts, please try again later' },
    });

/** Follow rate limiter: 30 follows per minute. */
export const followRateLimiter = isTest
  ? (_req: Request, _res: Response, next: NextFunction) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: { error: 'Too many follow requests, please try again later' },
    });

/** Save rate limiter: 20 saves per minute. */
export const saveRateLimiter = isTest
  ? (_req: Request, _res: Response, next: NextFunction) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 20,
      message: { error: 'Too many save requests, please try again later' },
    });

/** Search rate limiter: 30 searches per minute. */
export const searchRateLimiter = isTest
  ? (_req: Request, _res: Response, next: NextFunction) => next()
  : rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: { error: 'Too many search requests, please try again later' },
    });
