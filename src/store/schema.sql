CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  subject TEXT,
  key TEXT,
  content TEXT,
  data TEXT,
  turn_id INTEGER REFERENCES turns(id)
);

CREATE TABLE IF NOT EXISTS event_tags (
  event_id INTEGER NOT NULL REFERENCES events(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (event_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_event_tags_tag ON event_tags(tag);
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
CREATE INDEX IF NOT EXISTS idx_events_subj_key ON events(subject, key);

CREATE TABLE IF NOT EXISTS facts_current (
  subject TEXT NOT NULL,
  key TEXT NOT NULL,
  latest_event_id INTEGER NOT NULL,
  updated_seq INTEGER NOT NULL,
  PRIMARY KEY (subject, key)
);

CREATE TABLE IF NOT EXISTS seq_counter (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS agent_cursors (
  agent_id TEXT PRIMARY KEY,
  last_seen_event_id INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  status TEXT
);

-- Persistent simulation time. Wall-clock time is only sampled when the world is read or ticked,
-- so a server restart does not stop the world and no per-second writes are required.
CREATE TABLE IF NOT EXISTS world_clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  world_time TEXT NOT NULL,
  time_scale REAL NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused')),
  last_wall_time TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_at TEXT NOT NULL,
  type TEXT NOT NULL,
  subject TEXT,
  payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due
  ON scheduled_jobs(status, run_at);

CREATE TABLE IF NOT EXISTS world_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at TEXT NOT NULL,
  intensity REAL NOT NULL DEFAULT 0.5,
  scope TEXT,
  data TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_world_events_schedule
  ON world_events(status, scheduled_at);

CREATE TABLE IF NOT EXISTS decision_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_key TEXT,
  agent_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options TEXT NOT NULL,
  context TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'expired')),
  due_at TEXT,
  chosen_option_id TEXT,
  resolution_reason TEXT,
  advice_outcome TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_decision_points_open
  ON decision_points(status, due_at);

CREATE TABLE IF NOT EXISTS world_will_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id INTEGER NOT NULL REFERENCES decision_points(id) ON DELETE CASCADE,
  option_id TEXT,
  content TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS simulation_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS environment_state (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS agent_life_state (
  agent_id TEXT PRIMARY KEY,
  needs TEXT NOT NULL,
  current_action TEXT,
  action_data TEXT,
  last_action_at TEXT,
  updated_at TEXT NOT NULL
);
