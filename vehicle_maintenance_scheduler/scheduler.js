const fs = require('fs/promises');
const path = require('path');
const { Log } = require('../logging_middleware/logger');

const DEFAULT_BASE_URL = 'http://20.207.122.201/evaluation-service';
const DEFAULT_DEPOTS_URL = `${DEFAULT_BASE_URL}/depots`;
const DEFAULT_TASKS_URL = `${DEFAULT_BASE_URL}/vehicles`;
const DEFAULT_AUTH_URL = `${DEFAULT_BASE_URL}/auth`;

let cachedToken = null;
let cachedTokenExpiry = 0;

const getEnv = name => process.env[name] || '';

const pickNumber = (obj, keys) => {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
    }
    return null;
};

const normalizeDepot = raw => ({
    id: raw.id ?? raw.ID ?? raw.depotId ?? raw.depotID ?? raw.depot_id ?? null,
    mechanicHours: pickNumber(raw, ['mechanicHours', 'MechanicHours', 'capacity', 'hours']),
    raw,
});

const normalizeTask = raw => ({
    id: raw.id ?? raw.taskId ?? raw.taskID ?? raw.TaskID ?? raw.vehicleId ?? null,
    duration: pickNumber(raw, ['duration', 'Duration', 'serviceDuration', 'hours', 'time']),
    impact: pickNumber(raw, ['impact', 'Impact', 'priority', 'importance', 'score']),
    depotId: raw.depotId ?? raw.depotID ?? raw.depot_id ?? null,
    raw,
});

const getScale = tasks => (tasks.some(task => task.duration !== null && !Number.isInteger(task.duration)) ? 100 : 1);

function selectTasks(tasks, capacity) {
    if (!Number.isFinite(capacity) || capacity <= 0) return { selected: [], totalDuration: 0, totalImpact: 0 };

    const scale = getScale(tasks);
    const scaledCapacity = Math.max(0, Math.floor(capacity * scale));
    const filtered = tasks.filter(task => task.duration && task.duration > 0 && task.impact && task.impact > 0);
    const scaledDurations = filtered.map(task => Math.floor(task.duration * scale));

    const dp = new Array(scaledCapacity + 1).fill(0);
    const prev = new Array(scaledCapacity + 1).fill(-1);
    const chosen = new Array(scaledCapacity + 1).fill(-1);

    for (let i = 0; i < filtered.length; i += 1) {
        const weight = scaledDurations[i];
        const value = filtered[i].impact;
        for (let cap = scaledCapacity; cap >= weight; cap -= 1) {
            const candidate = dp[cap - weight] + value;
            if (candidate > dp[cap]) {
                dp[cap] = candidate;
                prev[cap] = cap - weight;
                chosen[cap] = i;
            }
        }
    }

    let bestCap = 0;
    for (let cap = 1; cap <= scaledCapacity; cap += 1) if (dp[cap] > dp[bestCap]) bestCap = cap;

    const picked = [];
    for (let cap = bestCap; cap > 0 && chosen[cap] !== -1; cap = prev[cap]) {
        picked.push(filtered[chosen[cap]]);
    }

    return {
        selected: picked,
        totalDuration: picked.reduce((sum, task) => sum + task.duration, 0),
        totalImpact: picked.reduce((sum, task) => sum + task.impact, 0),
    };
}

function buildSchedule(depots, tasks) {
    const normalizedDepots = depots.map(normalizeDepot).filter(depot => depot.mechanicHours !== null);
    const normalizedTasks = tasks.map(normalizeTask);

    const hasDepotMapping = normalizedTasks.some(task => task.depotId !== null && task.depotId !== undefined);
    const formattedDepots = normalizedDepots.map(depot => ({ ID: depot.id, MechanicHours: depot.mechanicHours }));
    const formattedVehicles = normalizedTasks.map(task => ({
        TaskID: task.id,
        Duration: task.duration,
        Impact: task.impact,
        DepotID: task.depotId ?? null,
    }));

    if (!normalizedDepots.length) {
        return {
            depots: formattedDepots,
            vehicles: formattedVehicles,
            schedule: {
                TotalMechanicHours: 0,
                TotalDuration: 0,
                TotalImpact: 0,
                SelectedVehicles: [],
            },
        };
    }

    if (!hasDepotMapping) {
        const totalHours = normalizedDepots.reduce((sum, depot) => sum + depot.mechanicHours, 0);
        const { selected, totalDuration, totalImpact } = selectTasks(normalizedTasks, totalHours);

        return {
            depots: formattedDepots,
            vehicles: formattedVehicles,
            schedule: {
                TotalMechanicHours: totalHours,
                TotalDuration: totalDuration,
                TotalImpact: totalImpact,
                SelectedVehicles: selected.map(task => ({ TaskID: task.id, Duration: task.duration, Impact: task.impact })),
            },
        };
    }

    const schedules = normalizedDepots.map(depot => {
        const candidateTasks = normalizedTasks.filter(task => String(task.depotId) === String(depot.id));
        const { selected, totalDuration, totalImpact } = selectTasks(candidateTasks, depot.mechanicHours);
        return {
            depotId: depot.id,
            mechanicHours: depot.mechanicHours,
            totalDuration,
            totalImpact,
            selectedTasks: selected.map(task => ({ id: task.id, duration: task.duration, impact: task.impact })),
        };
    });

    return {
        depots: formattedDepots,
        vehicles: formattedVehicles,
        schedules: schedules.map(schedule => ({
            DepotID: schedule.depotId,
            MechanicHours: schedule.mechanicHours,
            TotalDuration: schedule.totalDuration,
            TotalImpact: schedule.totalImpact,
            SelectedVehicles: schedule.selectedTasks.map(task => ({
                TaskID: task.id,
                Duration: task.duration,
                Impact: task.impact,
            })),
        })),
    };
}

async function getAccessToken() {
    if (cachedToken && Date.now() < cachedTokenExpiry) return cachedToken;

    const directToken = getEnv('EVAL_ACCESS_TOKEN');
    if (directToken) {
        cachedToken = directToken;
        cachedTokenExpiry = Date.now() + 15 * 60 * 1000;
        void Log('backend', 'info', 'auth', 'Using provided access token for evaluation API');
        return cachedToken;
    }

    const email = getEnv('EVAL_EMAIL');
    const name = getEnv('EVAL_NAME');
    const rollNo = getEnv('EVAL_ROLLNO');
    const accessCode = getEnv('EVAL_ACCESS_CODE');
    const clientID = getEnv('EVAL_CLIENT_ID');
    const clientSecret = getEnv('EVAL_CLIENT_SECRET');

    if (!email || !name || !rollNo || !accessCode || !clientID || !clientSecret) {
        void Log('backend', 'error', 'auth', 'Missing evaluation API credentials');
        throw new Error('Missing auth credentials. Set EVAL_ACCESS_TOKEN or client credentials.');
    }

    const authUrl = getEnv('EVAL_AUTH_URL') || DEFAULT_AUTH_URL;

    const response = await fetch(authUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email,
            name,
            rollNo,
            accessCode,
            clientID,
            clientSecret,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        void Log('backend', 'error', 'auth', `Auth failed: ${response.status} ${text}`);
        throw new Error(`Auth failed: ${response.status} ${text}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    cachedTokenExpiry = Date.now() + (data.expires_in ? Number(data.expires_in) * 1000 : 10 * 60 * 1000);

    void Log('backend', 'info', 'auth', 'Fetched evaluation API access token');

    return cachedToken;
}

async function fetchWithAuth(url, token) {
    const response = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        const text = await response.text();
        void Log('backend', 'error', 'service', `Request failed: ${response.status} ${text}`);
        throw new Error(`Request failed: ${response.status} ${text}`);
    }

    return response.json();
}

const extractList = (payload, key) => (
    Array.isArray(payload) ? payload : (payload && Array.isArray(payload[key]) ? payload[key] : [])
);

async function fetchDepotsAndTasks() {
    const token = await getAccessToken();
    const depotsUrl = getEnv('EVAL_DEPOTS_URL') || DEFAULT_DEPOTS_URL;
    const tasksUrl = getEnv('EVAL_TASKS_URL') || DEFAULT_TASKS_URL;

    const [depots, tasks] = await Promise.all([
        fetchWithAuth(depotsUrl, token),
        fetchWithAuth(tasksUrl, token),
    ]);

    return {
        depots: extractList(depots, 'depots'),
        tasks: extractList(tasks, 'vehicles'),
    };
}

async function writeScheduleFile(schedule) {
    const outputDir = path.resolve(__dirname, '..', 'vehicle_scheduling');
    await fs.mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, 'output.json');
    await fs.writeFile(outputPath, JSON.stringify(schedule, null, 2));
    void Log('backend', 'info', 'service', `Wrote schedule output to ${outputPath}`);
    return outputPath;
}

module.exports = {
    buildSchedule,
    fetchDepotsAndTasks,
    writeScheduleFile,
};
