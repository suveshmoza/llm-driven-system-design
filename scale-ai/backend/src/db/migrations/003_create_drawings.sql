-- 003_create_drawings.sql
-- Drawing submissions from users

CREATE TABLE drawings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    shape_id INT REFERENCES shapes(id) ON DELETE CASCADE,
    stroke_data_path VARCHAR(500) NOT NULL,  -- Path in MinIO
    metadata JSONB DEFAULT '{}',  -- canvas size, duration, stroke count, device type
    quality_score FLOAT CHECK (quality_score IS NULL OR quality_score BETWEEN 0 AND 1),
    is_flagged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_drawings_shape ON drawings(shape_id);
CREATE INDEX idx_drawings_user ON drawings(user_id);
CREATE INDEX idx_drawings_created ON drawings(created_at DESC);
CREATE INDEX idx_drawings_quality ON drawings(quality_score) WHERE quality_score IS NOT NULL;
CREATE INDEX idx_drawings_flagged ON drawings(is_flagged) WHERE is_flagged = TRUE;
