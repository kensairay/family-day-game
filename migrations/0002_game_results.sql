CREATE TABLE archived_games (
 id TEXT PRIMARY KEY,
 room_id TEXT NOT NULL,
 title TEXT NOT NULL,
 bank_id TEXT,
 bank_revision INTEGER,
 created_at INTEGER NOT NULL,
 started_at INTEGER,
 ended_at INTEGER NOT NULL,
 final_version INTEGER NOT NULL,
 reason TEXT NOT NULL CHECK(reason IN ('completed','ended','closed','expired')),
 question_count INTEGER NOT NULL,
 scored_question_count INTEGER NOT NULL,
 player_count INTEGER NOT NULL CHECK(player_count BETWEEN 0 AND 350),
 questions TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'writing' CHECK(status IN ('writing','ready')),
 archived_at INTEGER
);
CREATE INDEX archived_games_order ON archived_games(ended_at DESC,id DESC);
CREATE INDEX archived_games_room ON archived_games(room_id);
CREATE TABLE archived_players (
 game_id TEXT NOT NULL REFERENCES archived_games(id),
 player_id TEXT NOT NULL,
 nickname TEXT NOT NULL,
 rank INTEGER NOT NULL,
 score INTEGER NOT NULL,
 round1 INTEGER NOT NULL,
 round2 INTEGER NOT NULL,
 round3 INTEGER NOT NULL,
 answered INTEGER NOT NULL,
 answers TEXT NOT NULL,
 PRIMARY KEY(game_id,player_id)
);
CREATE INDEX archived_players_rank ON archived_players(game_id,rank,player_id);
