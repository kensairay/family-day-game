CREATE TABLE question_banks (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 questions TEXT NOT NULL DEFAULT '[]',
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 published_revision INTEGER,
 published_title TEXT,
 published_questions TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 archived_at INTEGER
);
CREATE INDEX question_banks_active ON question_banks(archived_at, updated_at DESC);
