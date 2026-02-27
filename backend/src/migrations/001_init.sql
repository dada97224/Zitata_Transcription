CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE TABLE IF NOT EXISTS emissions (
    id SERIAL PRIMARY KEY,
    youtube_video_id VARCHAR(20) UNIQUE NOT NULL,
    titre TEXT NOT NULL,
    date_diffusion TIMESTAMPTZ,
    duree_sec INTEGER,
    youtube_url TEXT NOT NULL,
    thumbnail_url TEXT,
    status_transcription VARCHAR(20) DEFAULT 'pending',
    mots_cles TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS segments (
    id SERIAL PRIMARY KEY,
    emission_id INTEGER NOT NULL REFERENCES emissions(id) ON DELETE CASCADE,
    segment_number INTEGER NOT NULL,
    start_sec FLOAT NOT NULL,
    end_sec FLOAT NOT NULL,
    texte TEXT NOT NULL,
    texte_fts TSVECTOR GENERATED ALWAYS AS (to_tsvector('french', texte)) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_segments_fts ON segments USING GIN (texte_fts);
CREATE INDEX IF NOT EXISTS idx_segments_emission ON segments (emission_id);
CREATE INDEX IF NOT EXISTS idx_segments_trgm ON segments USING GIN (texte gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_emissions_video_id ON emissions (youtube_video_id);
CREATE INDEX IF NOT EXISTS idx_emissions_status ON emissions (status_transcription);
