-- 005_create_models.sql
-- Trained model versions

CREATE TABLE models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    training_job_id UUID REFERENCES training_jobs(id) ON DELETE CASCADE,
    version VARCHAR(50) NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    accuracy FLOAT CHECK (accuracy IS NULL OR accuracy BETWEEN 0 AND 1),
    model_path VARCHAR(500) NOT NULL,  -- Path in MinIO
    config JSONB DEFAULT '{}',  -- Model architecture details
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ensure only one active model at a time
CREATE UNIQUE INDEX idx_models_active ON models(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_models_version ON models(version);
CREATE INDEX idx_models_created ON models(created_at DESC);
