import rateLimit from "express-rate-limit";

const globalLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    trustProxy: true,
  });
  

export {globalLimiter};