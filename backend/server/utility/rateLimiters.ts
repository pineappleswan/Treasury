import rateLimit from "express-rate-limit";

const loginRateLimiter = rateLimit({
	windowMs: 30 * 1000, // Rate limit window of 30 seconds
	limit: 10, // 10 requests per window period
});

export {
	loginRateLimiter
}
