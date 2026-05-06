const express = require('express');
const app = express();
const cors = require('cors');
const { Log, requestLogger } = require('./logging_middleware/logger');
const { buildSchedule, fetchDepotsAndTasks, writeScheduleFile } = require('./vehicle_maintenance_scheduler/scheduler');
app.use(cors());
app.use(express.json());
app.use(requestLogger);


class DepotManager {
    constructor() {
        this.depots = [];
        this.currentId = 1;
        this.totalAvailableHours = 0; 
    }

    createDepot(mechanicHours) {
        const newTask = {
            id: this.currentId++,
            MechanicHours: mechanicHours,
        };
        this.depots.push(newTask);
        this.totalAvailableHours += mechanicHours;
        return newTask;
    }

    getAllDepots() {
        return this.depots;
    }

    getDepotById(id) {
        return this.depots.find(t => t.id === id);
    }

    deleteDepot(id) {
        const initialLength = this.depots.length;
        this.depots = this.depots.filter(t => t.id !== id);
        return this.depots.length !== initialLength;
    }

}

const depotManager = new DepotManager();

class VehicleManager {
    constructor() {
        this.vehicles = [];
    }

    createVehicle(id, Duration, Impact) {
        const newTask = {
            TaskID: id,
            Duration,
            Impact,
            score: Duration/Impact,/*Similar to knapsack problem, I am thinking the one which has highest score should be assigned first */
        };
        this.vehicles.push(newTask);
        return newTask;
    }

    getAllVehicles() {
        return this.vehicles;
    }

    getVehicleById(id) {
        return this.vehicles.find(t => t.TaskID === id);
    }

    updateVehicle(id, newDuration, newImpact) {
        const vehicle = this.getVehicleById(id);
        if (!vehicle) return null;

        if (newDuration !== undefined) {
            vehicle.Duration = newDuration;
        }
        if (newImpact !== undefined) {
            vehicle.Impact = newImpact;
        }

        return vehicle;
    }

    deleteVehicle(id) {
        const initialLength = this.vehicles.length;
        this.vehicles = this.vehicles.filter(t => t.TaskID !== id);
        return this.vehicles.length !== initialLength;
    }

    searchVehicles(keyword) {
        return this.vehicles.filter(t =>
            t.title.toLowerCase().includes(keyword.toLowerCase())
        );
    }
}

const vehicleManager = new VehicleManager();

class NotificationManager {
    constructor() {
        this.notifications = [];
    }

    createNotification(id, Type, Message, Timestamp) {
        const newnotification = {
            TaskID: id,
            type: Type,
            message: Message,
            timestamp: Timestamp,
        };
        this.notifications.push(newnotification);
        return newnotification;
    }

    getAllNotifications() {
        return this.notifications;
    }

    getNotificationById(id) {
        return this.notifications.find(t => t.TaskID === id);
    }

    updateNotification(id, newType, newMessage, newTimestamp) {
        const notification = this.getNotificationById(id);
        if (!notification) return null;

        if (newType !== undefined) {
            notification.type = newType;
        }
        if (newMessage !== undefined) {
            notification.message = newMessage;
        }
        if (newTimestamp !== undefined) {
            notification.timestamp = newTimestamp;
        }

        return notification;
    }

    deleteNotification(id) {
        const initialLength = this.notifications.length;
        this.notifications = this.notifications.filter(t => t.TaskID !== id);
        return this.notifications.length !== initialLength;
    }

    searchNotifications(keyword) {
        return this.notifications.filter(t =>
            t.message.toLowerCase().includes(keyword.toLowerCase())
        );
    }
}

const notificationManager = new NotificationManager();

/*
----------------------------------------
ROOT ROUTE
----------------------------------------
*/
app.get('/', (req, res) => {
    res.send('API is running');
});

/*
----------------------------------------
CREATE TASK (POST /tasks)
----------------------------------------
*/
app.post('/tasks', (req, res) => {
    const { mechanicHours } = req.body;

    if (mechanicHours === undefined) {
        void Log('backend', 'warn', 'route', 'Missing mechanicHours in POST /tasks');
        return res.status(400).json({ error: 'Mechanic hours is required' });
    }

    const depot = depotManager.createDepot(mechanicHours);
    void Log('backend', 'info', 'route', `Created depot ${depot.id} with ${mechanicHours} hours`);
    res.status(201).json(depot);
});

/*
----------------------------------------
GET ALL TASKS (GET /tasks)
----------------------------------------
*/
app.get('/depots', (req, res) => {
    res.json(depotManager.getAllDepots());
});

app.get('/vehicles', (req, res) => {
    res.json(vehicleManager.getAllVehicles());
});

app.get('/notifications', (req, res) => {
    res.json(notificationManager.getAllNotifications());
});
/*
----------------------------------------
UPDATE VEHICLE (PUT /vehicles/:id)
----------------------------------------
*/
app.put('/vehicles/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const { duration, impact } = req.body;

    const vehicle = vehicleManager.updateVehicle(id, duration, impact);

    if (!vehicle) {
        return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json(vehicle);
});

/*
----------------------------------------
DELETE VEHICLE (DELETE /vehicles/:id)
----------------------------------------
*/
app.delete('/vehicles/:id', (req, res) => {
    const id = parseInt(req.params.id);

    const success = vehicleManager.deleteVehicle(id);

    if (!success) {
        return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json({ message: 'Vehicle deleted successfully' });
});

/*
----------------------------------------
FILTER TASKS (GET /tasks?completed=true)
----------------------------------------
*/
app.get('/tasks/filter', (req, res) => {
    const { completed } = req.query;

    if (completed === undefined) {
        return res.status(400).json({ error: 'Query param "completed" required' });
    }

    const status = completed === 'true';
    const result = depotManager.filterTasksByCompletion(status);

    res.json(result);
});

/*
----------------------------------------
SEARCH TASKS (GET /tasks/search/:keyword)
----------------------------------------
*/
app.get('/tasks/search/:keyword', (req, res) => {
    const keyword = req.params.keyword;
    const result = depotManager.searchTasks(keyword);

    res.json(result);
});

/*
----------------------------------------
SCHEDULE VEHICLE MAINTENANCE (GET /schedule)
----------------------------------------
*/
app.get('/schedule', async (req, res, next) => {
    try {
        const { depots, tasks } = await fetchDepotsAndTasks();
        const schedule = buildSchedule(depots, tasks);

        await writeScheduleFile(schedule);
        void Log('backend', 'info', 'service', 'Generated maintenance schedule');

        res.json(schedule);
    } catch (error) {
        void Log('backend', 'error', 'service', `Schedule generation failed: ${error.message}`);
        next(error);
    }
});

app.use((err, req, res, next) => {
    const message = `Unhandled error on ${req.method} ${req.originalUrl}: ${err.message}`;
    void Log('backend', 'error', 'middleware', message);
    res.status(500).json({ error: 'Internal server error' });
});

/*
----------------------------------------
START SERVER
----------------------------------------
*/
app.listen(5000, () => {
    void Log('backend', 'info', 'service', 'Server running on http://localhost:5000');
});