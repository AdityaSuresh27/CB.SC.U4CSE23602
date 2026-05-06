## Stage 1
Actions: create, list (filter by type/read), mark read/unread, delete, realtime.
API: `POST /notifications`, `GET /students/{id}/notifications?status=unread&type=placement&limit=20`, `PATCH /notifications/{id}`, `DELETE /notifications/{id}`.
Realtime: SSE/WebSocket at `/notifications/stream?studentId=...` pushing new items.

## Stage 2
DB: PostgreSQL. Table: `notifications(id, student_id, type, message, metadata, is_read, created_at)`.
Indexes: `(student_id, created_at DESC)` and `(student_id, is_read, created_at DESC)`.
Queries: list unread (paged) and update `is_read`.

## Stage 3
Slow because `SELECT *`, no composite index, and big sort. Fix with index on `(student_id, is_read, created_at DESC)` and select only needed columns.
Placement in last 7 days:
```sql
SELECT student_id
FROM notifications
WHERE type = 'placement'
  AND created_at >= NOW() - INTERVAL '7 days'
GROUP BY student_id;
```

## Stage 4
Reduce load: cache recent/unread, cursor pagination, batch updates, SSE to avoid polling. Tradeoff: cache invalidation and more open connections.

## Stage 5
Fix notify-all: use a queue + workers, idempotent DB insert, retries for email, track per-user status.

## Stage 6
Use API, score by type (placement > result > event) + recency, pick top 10.
Code: [notification_app_be/priority_inbox.js](notification_app_be/priority_inbox.js)
Run:
```powershell
$env:EVAL_ACCESS_TOKEN = "YOUR_TOKEN"
node .\notification_app_be\priority_inbox.js
```
Output: `notification_app_be/priority_inbox.json`
