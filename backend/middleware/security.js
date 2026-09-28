import rateLimit from 'express-rate-limit';

/**
 * Rate limiter for the login endpoint to prevent brute force attacks.
 * Limit: 10 attempts per 15 minutes per IP address.
 */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // limit each IP to 15 login requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many login attempts from this IP. Please try again after 15 minutes.'
  },
  skipSuccessfulRequests: false
});

/**
 * Middleware to enforce HTTPS in production (assuming reverse proxy/TLS termination).
 */
export function enforceHttps(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (!isHttps) {
      return res.status(403).json({
        error: 'HTTPS is required. Insecure HTTP connections are blocked.'
      });
    }
  }
  next();
}

/**
 * Safe logging helper that strips sensitive credentials (passwords, auth tokens)
 * before logging requests or errors.
 */
export function safeLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Never log req.body or headers containing credentials
    const status = res.statusCode;
    const method = req.method;
    const path = req.originalUrl || req.url;
    
    // Minimal non-sensitive access log
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[${new Date().toISOString()}] ${method} ${path} -> ${status} (${duration}ms)`);
    }
  });

  next();
}
