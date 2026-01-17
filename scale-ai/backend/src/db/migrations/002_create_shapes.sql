-- 002_create_shapes.sql
-- Shape definitions for the drawing game

CREATE TABLE shapes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    difficulty INT DEFAULT 1 CHECK (difficulty BETWEEN 1 AND 5),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed the 5 shapes
INSERT INTO shapes (name, description, difficulty) VALUES
    ('line', 'A straight line from one point to another', 1),
    ('circle', 'A round shape with no corners', 2),
    ('square', 'A shape with 4 equal sides and 4 right angles', 2),
    ('triangle', 'A shape with 3 sides and 3 corners', 2),
    ('heart', 'A classic heart shape symbolizing love', 3);
