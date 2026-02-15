import rateLimit from 'express-rate-limit';

/** General API rate limiter allowing 1000 requests per 15-minute window. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

/** Auth endpoint rate limiter allowing 50 attempts per 15-minute window. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth attempts, please try again later.' },
});

/** Transfer endpoint rate limiter allowing 30 attempts per minute. */
export const transferLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many transfer attempts, please try again later.' },
});
