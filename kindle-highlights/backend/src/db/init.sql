-- Kindle Highlights Database Schema
-- Social reading platform with real-time sync

-- ============================================================================
-- USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    avatar_url VARCHAR(500),
    bio TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ============================================================================
-- BOOKS TABLE
-- ============================================================================
-- Books catalog
CREATE TABLE IF NOT EXISTS books (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(500) NOT NULL,
    author VARCHAR(200),
    isbn VARCHAR(20),
    publisher VARCHAR(200),
    description TEXT,
    cover_url VARCHAR(500),
    total_locations INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn);
CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);

-- ============================================================================
-- USER_BOOKS TABLE
-- ============================================================================
-- Tracks which books a user has in their library
CREATE TABLE IF NOT EXISTS user_books (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    progress_location INTEGER DEFAULT 0,
    last_read_at TIMESTAMP DEFAULT NOW(),
    added_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, book_id)
);

CREATE INDEX IF NOT EXISTS idx_user_books_user ON user_books(user_id);
CREATE INDEX IF NOT EXISTS idx_user_books_book ON user_books(book_id);

-- ============================================================================
-- HIGHLIGHTS TABLE
-- ============================================================================
-- User highlights with sync support
CREATE TABLE IF NOT EXISTS highlights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    location_start INTEGER NOT NULL,
    location_end INTEGER NOT NULL,
    highlighted_text TEXT NOT NULL,
    note TEXT,
    color VARCHAR(20) DEFAULT 'yellow',
    visibility VARCHAR(20) DEFAULT 'private', -- private, friends, public
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    synced_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_highlights_user ON highlights(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_highlights_book ON highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_highlights_location ON highlights(book_id, location_start, location_end);
CREATE INDEX IF NOT EXISTS idx_highlights_visibility ON highlights(visibility) WHERE archived = false;

-- ============================================================================
-- DELETED_HIGHLIGHTS TABLE
-- ============================================================================
-- Soft deletes for cross-device sync
CREATE TABLE IF NOT EXISTS deleted_highlights (
    highlight_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    deleted_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deleted_highlights_user ON deleted_highlights(user_id);

-- ============================================================================
-- POPULAR_HIGHLIGHTS TABLE
-- ============================================================================
-- Aggregated popular highlights
CREATE TABLE IF NOT EXISTS popular_highlights (
    book_id UUID REFERENCES books(id) ON DELETE CASCADE,
    passage_id VARCHAR(50), -- normalized location range
    passage_text TEXT,
    highlight_count INTEGER DEFAULT 0,
    location_start INTEGER,
    location_end INTEGER,
    updated_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (book_id, passage_id)
);

CREATE INDEX IF NOT EXISTS idx_popular_count ON popular_highlights(book_id, highlight_count DESC);

-- ============================================================================
-- FOLLOWS TABLE
-- ============================================================================
-- Social follows
CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID REFERENCES users(id) ON DELETE CASCADE,
    followee_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (follower_id, followee_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_followee ON follows(followee_id);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);

-- ============================================================================
-- USER_PRIVACY_SETTINGS TABLE
-- ============================================================================
-- Privacy settings per user
CREATE TABLE IF NOT EXISTS user_privacy_settings (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    highlight_visibility VARCHAR(20) DEFAULT 'private',
    allow_followers BOOLEAN DEFAULT true,
    include_in_aggregation BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================================
-- SESSIONS TABLE
-- ============================================================================
-- User sessions
CREATE TABLE IF NOT EXISTS sessions (
    id VARCHAR(100) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
