const express = require('express');
const app = express();
const cors = require('cors');
app.use(cors());
app.use(express.json());

/*
----------------------------------------
TASK MANAGER CLASS (OOP)
----------------------------------------
*/
class depotManager {
    constructor() {
        this.depots = [];
        this.currentId = 1;
    }

    createDepot(mechanicHours) {
        const newTask = {
            id: this.currentId++,
            mechanicHours,
        };
        this.depots.push(newTask);
        return newTask;
    }

    getAllTasks() {
        return this.depots;
    }

    getTaskById(id) {
        return this.depots.find(t => t.id === id);
    }

    updateTask(id, newMechanicHours) {
        const task = this.getTaskById(id);
        if (!task) return null;

        if (newMechanicHours) {
            task.mechanicHours = newMechanicHours;
        }

        return task;
    }

    deleteTask(id) {
        const initialLength = this.depots.length;
        this.depots = this.depots.filter(t => t.id !== id);
        return this.depots.length !== initialLength;
    }


    searchTasks(keyword) {
        return this.depots.filter(t =>
            t.title.toLowerCase().includes(keyword.toLowerCase())
        );
    }
}

const depotManager = new depotManager();

class vehicleManager {
    constructor() {
        this.vehicles = [];
        this.currentId = 1;
    }

    createVehicle(Duration, Impact) {
        const newTask = {
            id: this.currentId++,
            Duration,
            Impact,
            ratio: Duration/Impact,
        };
        this.vehicles.push(newTask);
        return newTask;
    }

    getAllTasks() {
        return this.vehicles;
    }

    getTaskById(id) {
        return this.vehicles.find(t => t.id === id);
    }

    updateTask(id, newDuration, newImpact) {
        const task = this.getTaskById(id);
        if (!task) return null;

        if (newDuration !== undefined) {
            task.Duration = newDuration;
        }
        if (newImpact !== undefined) {
            task.Impact = newImpact;
        }

        return task;
    }

    deleteTask(id) {
        const initialLength = this.vehicles.length;
        this.vehicles = this.vehicles.filter(t => t.id !== id);
        return this.vehicles.length !== initialLength;
    }

    filterTasksByCompletion(status) {
        return this.vehicles.filter(t => t.completed === status);
    }

    searchTasks(keyword) {
        return this.vehicles.filter(t =>
            t.title.toLowerCase().includes(keyword.toLowerCase())
        );
    }
}
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
        return res.status(400).json({ error: 'Mechanic hours is required' });
    }

    const depot = depotManager.createDepot(mechanicHours);
    res.status(201).json(depot);
});

/*
----------------------------------------
GET ALL TASKS (GET /tasks)
----------------------------------------
*/
app.get('/tasks', (req, res) => {
    res.json(depotManager.getAllTasks());
});

/*
----------------------------------------
UPDATE TASK (PUT /tasks/:id)
----------------------------------------
*/
app.put('/tasks/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const { mechanicHours } = req.body;

    const task = depotManager.updateTask(id, mechanicHours);

    if (!task) {
        return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task);
});

/*
----------------------------------------
DELETE TASK (DELETE /tasks/:id)
----------------------------------------
*/
app.delete('/tasks/:id', (req, res) => {
    const id = parseInt(req.params.id);

    const success = depotManager.deleteTask(id);

    if (!success) {
        return res.status(404).json({ error: 'Task not found' });
    }

    res.json({ message: 'Task deleted successfully' });
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
START SERVER
----------------------------------------
*/
app.listen(5000, () => {
    console.log('Server running on http://localhost:5000');
});