-- 004_create_training_jobs.sql
-- Training job management

CREATE TABLE training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed')),
    config JSONB DEFAULT '{}',  -- hyperparameters, data filters, epochs
    error_message TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    metrics JSONB,  -- accuracy, loss, confusion matrix
    model_path VARCHAR(500),  -- Path in MinIO when completed
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_training_jobs_status ON training_jobs(status);
CREATE INDEX idx_training_jobs_created ON training_jobs(created_at DESC);
