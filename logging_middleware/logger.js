const DEFAULT_LOG_ENDPOINT = 'http://20.27.122.201/evaluation-service/logs';
const ALLOWED_STACKS = new Set(['backend', 'frontend']);
const ALLOWED_LEVELS = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const ALLOWED_PACKAGES = new Set(['handler', 'repository', 'route', 'service', 'auth', 'config', 'middleware', 'utils']);

const normalizeValue = value => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const isValidPayload = (stack, level, packageName, message) => (
    ALLOWED_STACKS.has(stack)
    && ALLOWED_LEVELS.has(level)
    && ALLOWED_PACKAGES.has(packageName)
    && typeof message === 'string'
    && message.trim().length > 0
);

async function Log(stack, level, packageName, message) {
    const normalizedStack = normalizeValue(stack);
    const normalizedLevel = normalizeValue(level);
    const normalizedPackage = normalizeValue(packageName);

    if (!isValidPayload(normalizedStack, normalizedLevel, normalizedPackage, message)) return;

    if (typeof fetch !== 'function') return;

    const payload = { stack: normalizedStack, level: normalizedLevel, package: normalizedPackage, message: message.trim() };

    const accessToken = process.env.LOG_ACCESS_TOKEN || process.env.EVAL_ACCESS_TOKEN;
    const headers = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    try {
        await fetch(process.env.LOG_ENDPOINT || DEFAULT_LOG_ENDPOINT, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
    } catch (error) {
        return;
    }
}

function requestLogger(req, res, next) {
    const startTime = Date.now();

    res.on('finish', () => {
        const durationMs = Date.now() - startTime;
        const status = res.statusCode;
        const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
        const message = `${req.method} ${req.originalUrl} ${status} ${durationMs}ms`;

        void Log('backend', level, 'middleware', message);
    });

    next();
}

module.exports = {
    Log,
    requestLogger,
};
