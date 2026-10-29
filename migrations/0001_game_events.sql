-- Durable Object storage is authoritative; this is an idempotent archive.
CREATE TABLE IF NOT EXISTS game_events (
  room TEXT NOT NULL,
  event_id INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (room, event_id)
);
