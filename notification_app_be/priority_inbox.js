const fs = require('fs/promises');
const path = require('path');
const { Log } = require('../logging_middleware/logger');

const DEFAULT_BASE_URL = 'http://20.207.122.201/evaluation-service';
const DEFAULT_NOTIFICATIONS_URL = `${DEFAULT_BASE_URL}/notifications`;
const DEFAULT_AUTH_URL = `${DEFAULT_BASE_URL}/auth`;

let cachedToken = null;
let cachedTokenExpiry = 0;

function getEnv(name) {
    return process.env[name] || '';
}

function normalizeType(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLowerCase();
}

function getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry) {
        return Promise.resolve(cachedToken);
    }

    const directToken = getEnv('EVAL_ACCESS_TOKEN');
    if (directToken) {
        cachedToken = directToken;
        cachedTokenExpiry = Date.now() + 15 * 60 * 1000;
        return Promise.resolve(cachedToken);
    }

    const email = getEnv('EVAL_EMAIL');
    const name = getEnv('EVAL_NAME');
    const rollNo = getEnv('EVAL_ROLLNO');
    const accessCode = getEnv('EVAL_ACCESS_CODE');
    const clientID = getEnv('EVAL_CLIENT_ID');
    const clientSecret = getEnv('EVAL_CLIENT_SECRET');

    if (!email || !name || !rollNo || !accessCode || !clientID || !clientSecret) {
        void Log('backend', 'error', 'auth', 'Missing evaluation API credentials for notifications');
        return Promise.reject(new Error('Missing auth credentials. Set EVAL_ACCESS_TOKEN or client credentials.'));
    }

    const authUrl = getEnv('EVAL_AUTH_URL') || DEFAULT_AUTH_URL;

    return fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name, rollNo, accessCode, clientID, clientSecret }),
    })
        .then(async response => {
            if (!response.ok) {
                const text = await response.text();
                void Log('backend', 'error', 'auth', `Auth failed: ${response.status} ${text}`);
                throw new Error(`Auth failed: ${response.status} ${text}`);
            }
            return response.json();
        })
        .then(data => {
            cachedToken = data.access_token;
            cachedTokenExpiry = Date.now() + (data.expires_in ? Number(data.expires_in) * 1000 : 10 * 60 * 1000);
            void Log('backend', 'info', 'auth', 'Fetched access token for notifications');
            return cachedToken;
        });
}

async function fetchNotifications() {
    const token = await getAccessToken();
    const notificationsUrl = getEnv('EVAL_NOTIFICATIONS_URL') || DEFAULT_NOTIFICATIONS_URL;

    const response = await fetch(notificationsUrl, { headers: { Authorization: `Bearer ${token}` } });

    if (!response.ok) {
        const text = await response.text();
        void Log('backend', 'error', 'service', `Notifications request failed: ${response.status} ${text}`);
        throw new Error(`Notifications request failed: ${response.status} ${text}`);
    }

    const payload = await response.json();
    if (Array.isArray(payload)) {
        return payload;
    }
    if (payload && Array.isArray(payload.notifications)) return payload.notifications;
    return [];
}

function computePriority(notification) {
    const type = normalizeType(notification.Type || notification.type);
    const weights = { placement: 3, result: 2, event: 1 };
    const weight = weights[type] || 1;

    const timestampValue = Date.parse(notification.Timestamp || notification.timestamp || '');
    const now = Date.now();
    const ageMinutes = timestampValue ? Math.max(0, (now - timestampValue) / 60000) : 0;

    const recencyScore = Math.max(0, 1000 - Math.floor(ageMinutes));
    return weight * 1000 + recencyScore;
}

function pickTopN(notifications, n) {
    return notifications
        .map(notification => ({ notification, score: computePriority(notification) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, n)
        .map(item => item.notification);
}

async function writeOutput(top) {
    const outputDir = path.resolve(__dirname, '..', 'notification_app_be');
    const outputPath = path.join(outputDir, 'priority_inbox.json');
    await fs.writeFile(outputPath, JSON.stringify({ top }, null, 2));
    void Log('backend', 'info', 'service', `Wrote priority inbox output to ${outputPath}`);
    return outputPath;
}

async function run() {
    const notifications = await fetchNotifications();
    const top = pickTopN(notifications, 10);
    await writeOutput(top);
    return top;
}

if (require.main === module) {
    run().catch(async error => {
        void Log('backend', 'error', 'service', `Priority inbox failed: ${error.message}`);
        const errorPath = path.join(__dirname, 'priority_inbox.error.txt');
        await fs.writeFile(errorPath, String(error.message || error));
    });
}

module.exports = {
    fetchNotifications,
    pickTopN,
    computePriority,
    run,
};
