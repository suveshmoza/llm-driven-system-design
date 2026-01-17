-- 007_add_deleted_at_to_drawings.sql
-- Add soft delete support for drawings

ALTER TABLE drawings ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

CREATE INDEX idx_drawings_deleted_at ON drawings(deleted_at);

-- Update queries to filter out deleted drawings by default
COMMENT ON COLUMN drawings.deleted_at IS 'Soft delete timestamp - NULL means not deleted';
