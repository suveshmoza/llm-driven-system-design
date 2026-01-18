-- =============================================================================
-- Airbnb Database Schema
-- =============================================================================
-- This file contains the complete database schema for the Airbnb clone.
-- It includes all tables, indexes, constraints, triggers, and functions.
--
-- Prerequisites:
--   - PostgreSQL 14+ with PostGIS extension
--
-- Usage:
--   psql -U postgres -d airbnb -f init.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- PostGIS provides geographic data types and spatial indexing for location-based
-- queries (e.g., "find listings within 25km of this point")
CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- TABLES
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Users Table
-- -----------------------------------------------------------------------------
-- Central user table for both guests and hosts. A user becomes a host when
-- they create their first listing (is_host flag is set to TRUE).
--
-- Design decisions:
--   - Single table for both roles (most users are both)
--   - response_rate tracks host communication reliability
--   - role field for admin access control
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100) NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  phone VARCHAR(20),
  is_host BOOLEAN DEFAULT FALSE,            -- Set TRUE when user creates first listing
  is_verified BOOLEAN DEFAULT FALSE,        -- Email/phone verification status
  role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  response_rate DECIMAL(3, 2) DEFAULT 1.00, -- Host response rate (0.00 - 1.00)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- Listings Table
-- -----------------------------------------------------------------------------
-- Core property listing table with PostGIS geography for spatial queries.
--
-- Design decisions:
--   - GEOGRAPHY(POINT, 4326) uses WGS84 coordinate system (lat/long)
--   - amenities stored as TEXT[] for flexible filtering
--   - Denormalized rating/review_count updated by trigger for read performance
--   - cancellation_policy determines refund rules
CREATE TABLE listings (
  id SERIAL PRIMARY KEY,
  host_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  description TEXT,

  -- Geographic location (PostGIS)
  location GEOGRAPHY(POINT, 4326),          -- Stored as (longitude, latitude)

  -- Address components (for display)
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),

  -- Property details
  property_type VARCHAR(50) CHECK (property_type IN (
    'apartment', 'house', 'room', 'studio', 'villa', 'cabin', 'cottage', 'loft'
  )),
  room_type VARCHAR(50) CHECK (room_type IN (
    'entire_place', 'private_room', 'shared_room'
  )),
  max_guests INTEGER NOT NULL DEFAULT 1,
  bedrooms INTEGER DEFAULT 0,
  beds INTEGER DEFAULT 0,
  bathrooms DECIMAL(2, 1) DEFAULT 1,        -- Supports half baths (1.5, 2.5)
  amenities TEXT[] DEFAULT '{}',            -- Array for flexible filtering
  house_rules TEXT,

  -- Pricing
  price_per_night DECIMAL(10, 2) NOT NULL,
  cleaning_fee DECIMAL(10, 2) DEFAULT 0,
  service_fee_percent DECIMAL(4, 2) DEFAULT 10.00,

  -- Reviews (denormalized for read performance)
  rating DECIMAL(2, 1),                     -- Calculated average, updated by trigger
  review_count INTEGER DEFAULT 0,           -- Count of public guest reviews

  -- Booking settings
  instant_book BOOLEAN DEFAULT FALSE,       -- TRUE = no host approval needed
  minimum_nights INTEGER DEFAULT 1,
  maximum_nights INTEGER DEFAULT 365,
  cancellation_policy VARCHAR(50) DEFAULT 'flexible' CHECK (
    cancellation_policy IN ('flexible', 'moderate', 'strict')
  ),

  -- Status
  is_active BOOLEAN DEFAULT TRUE,           -- FALSE = listing hidden from search
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Spatial index for geographic queries (ST_DWithin, ST_Distance)
CREATE INDEX idx_listings_location ON listings USING GIST(location);

-- Common query indexes
CREATE INDEX idx_listings_host ON listings(host_id);
CREATE INDEX idx_listings_price ON listings(price_per_night);
CREATE INDEX idx_listings_active ON listings(is_active);

-- -----------------------------------------------------------------------------
-- Listing Photos Table
-- -----------------------------------------------------------------------------
-- Separate table for photos to allow multiple images per listing.
-- display_order determines the sequence in the gallery (0 = primary).
CREATE TABLE listing_photos (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption VARCHAR(255),
  display_order INTEGER DEFAULT 0,          -- 0 = primary/cover photo
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_photos_listing ON listing_photos(listing_id);

-- -----------------------------------------------------------------------------
-- Availability Blocks Table
-- -----------------------------------------------------------------------------
-- Date range approach for availability (more efficient than day-by-day rows).
--
-- Design decisions:
--   - Date ranges reduce row count by ~18x compared to day-by-day
--   - status: 'available' = open, 'blocked' = host blocked, 'booked' = reserved
--   - price_per_night allows custom pricing for specific periods
--   - booking_id links booked blocks to their reservation
--
-- Trade-offs:
--   - Fewer rows = faster queries
--   - Requires split/merge logic when updating partial ranges
CREATE TABLE availability_blocks (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('available', 'blocked', 'booked')),
  price_per_night DECIMAL(10, 2),           -- NULL = use listing default price
  booking_id INTEGER,                       -- Links to booking when status='booked'
  created_at TIMESTAMP DEFAULT NOW(),

  -- Ensure end_date is after start_date
  CONSTRAINT valid_dates CHECK (end_date > start_date)
);

-- Composite index for date range queries
CREATE INDEX idx_availability_listing_dates ON availability_blocks(listing_id, start_date, end_date);
CREATE INDEX idx_availability_status ON availability_blocks(status);

-- -----------------------------------------------------------------------------
-- Bookings Table
-- -----------------------------------------------------------------------------
-- Core reservation table linking guests to listings for specific dates.
--
-- Design decisions:
--   - listing_id SET NULL on delete to preserve booking history
--   - guest_id SET NULL on delete to preserve booking records
--   - Price components stored separately for transparency
--   - nights stored (not calculated) for denormalization
CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  guest_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Dates
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,

  -- Guest details
  guests INTEGER NOT NULL DEFAULT 1,

  -- Pricing (captured at booking time, won't change if listing updates)
  nights INTEGER NOT NULL,
  price_per_night DECIMAL(10, 2) NOT NULL,
  cleaning_fee DECIMAL(10, 2) DEFAULT 0,
  service_fee DECIMAL(10, 2) DEFAULT 0,
  total_price DECIMAL(10, 2) NOT NULL,

  -- Status workflow: pending -> confirmed/declined -> completed/cancelled
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
    'pending',    -- Awaiting host approval (request-to-book)
    'confirmed',  -- Approved by host or instant-booked
    'cancelled',  -- Cancelled by guest or host
    'completed',  -- Stay finished
    'declined'    -- Host declined the request
  )),

  -- Communication
  guest_message TEXT,                       -- Initial message from guest
  host_response TEXT,                       -- Host's response

  -- Cancellation tracking
  cancelled_by VARCHAR(10) CHECK (cancelled_by IN ('guest', 'host', NULL)),
  cancelled_at TIMESTAMP,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Ensure check_out is after check_in
  CONSTRAINT valid_booking_dates CHECK (check_out > check_in)
);

-- Common query indexes
CREATE INDEX idx_bookings_listing ON bookings(listing_id);
CREATE INDEX idx_bookings_guest ON bookings(guest_id);
CREATE INDEX idx_bookings_dates ON bookings(check_in, check_out);
CREATE INDEX idx_bookings_status ON bookings(status);

-- Add foreign key for availability_blocks.booking_id after bookings table exists
ALTER TABLE availability_blocks
ADD CONSTRAINT fk_availability_booking
FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Reviews Table
-- -----------------------------------------------------------------------------
-- Two-sided review system: guests review hosts/listings, hosts review guests.
--
-- Design decisions:
--   - UNIQUE(booking_id, author_type) ensures one review per party per booking
--   - is_public = FALSE until both parties submit (enforced by trigger)
--   - Sub-ratings (cleanliness, etc.) only applicable to guest reviews of listings
CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_type VARCHAR(10) NOT NULL CHECK (author_type IN ('host', 'guest')),

  -- Ratings (1-5 scale)
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),

  -- Sub-ratings (guest reviews only, nullable for host reviews of guests)
  cleanliness_rating INTEGER CHECK (cleanliness_rating >= 1 AND cleanliness_rating <= 5),
  communication_rating INTEGER CHECK (communication_rating >= 1 AND communication_rating <= 5),
  location_rating INTEGER CHECK (location_rating >= 1 AND location_rating <= 5),
  value_rating INTEGER CHECK (value_rating >= 1 AND value_rating <= 5),

  content TEXT,
  is_public BOOLEAN DEFAULT FALSE,          -- Becomes TRUE when both submit
  created_at TIMESTAMP DEFAULT NOW(),

  -- One review per author type per booking
  UNIQUE(booking_id, author_type)
);

CREATE INDEX idx_reviews_booking ON reviews(booking_id);
CREATE INDEX idx_reviews_author ON reviews(author_id);

-- -----------------------------------------------------------------------------
-- Conversations Table
-- -----------------------------------------------------------------------------
-- Groups messages between a host and guest, optionally linked to a booking.
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id) ON DELETE SET NULL,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  host_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_conversations_host ON conversations(host_id);
CREATE INDEX idx_conversations_guest ON conversations(guest_id);

-- -----------------------------------------------------------------------------
-- Messages Table
-- -----------------------------------------------------------------------------
-- Individual messages within a conversation thread.
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);

-- -----------------------------------------------------------------------------
-- Sessions Table
-- -----------------------------------------------------------------------------
-- Server-side session storage for authentication.
-- Used alongside Redis for faster lookups; PostgreSQL is the persistent store.
CREATE TABLE sessions (
  id VARCHAR(255) PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  data JSONB,                               -- Session data (flexible)
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- -----------------------------------------------------------------------------
-- Audit Logs Table
-- -----------------------------------------------------------------------------
-- Comprehensive audit trail for all sensitive operations.
-- Supports dispute resolution, fraud detection, and compliance.
--
-- Design decisions:
--   - before_state/after_state capture full change history
--   - request_id links to distributed traces
--   - outcome distinguishes success/failure/denied
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,         -- e.g., 'booking.created', 'listing.updated'
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resource_type VARCHAR(50) NOT NULL,       -- e.g., 'booking', 'listing', 'user'
  resource_id INTEGER,
  action VARCHAR(50) NOT NULL,              -- e.g., 'create', 'update', 'cancel'
  outcome VARCHAR(20) NOT NULL DEFAULT 'success' CHECK (
    outcome IN ('success', 'failure', 'denied')
  ),
  ip_address VARCHAR(45),                   -- IPv4 or IPv6
  user_agent TEXT,
  session_id VARCHAR(255),
  request_id VARCHAR(255),                  -- For distributed tracing correlation
  metadata JSONB DEFAULT '{}',              -- Additional context
  before_state JSONB,                       -- State before change
  after_state JSONB,                        -- State after change
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_request_id ON audit_logs(request_id);

-- =============================================================================
-- FUNCTIONS AND TRIGGERS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Automatic updated_at Timestamp
-- -----------------------------------------------------------------------------
-- Updates the updated_at column whenever a row is modified.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply to tables with updated_at column
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_listings_updated_at
    BEFORE UPDATE ON listings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_conversations_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- -----------------------------------------------------------------------------
-- Automatic Listing Rating Update
-- -----------------------------------------------------------------------------
-- Recalculates listing rating and review_count when a guest review is added.
-- Only counts public guest reviews (after both parties have submitted).
CREATE OR REPLACE FUNCTION update_listing_rating()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE listings
    SET
        rating = (
            SELECT ROUND(AVG(r.rating)::numeric, 1)
            FROM reviews r
            JOIN bookings b ON r.booking_id = b.id
            WHERE b.listing_id = (SELECT listing_id FROM bookings WHERE id = NEW.booking_id)
            AND r.author_type = 'guest'
            AND r.is_public = TRUE
        ),
        review_count = (
            SELECT COUNT(*)
            FROM reviews r
            JOIN bookings b ON r.booking_id = b.id
            WHERE b.listing_id = (SELECT listing_id FROM bookings WHERE id = NEW.booking_id)
            AND r.author_type = 'guest'
            AND r.is_public = TRUE
        )
    WHERE id = (SELECT listing_id FROM bookings WHERE id = NEW.booking_id);
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_listing_rating_trigger
    AFTER INSERT OR UPDATE ON reviews
    FOR EACH ROW
    WHEN (NEW.author_type = 'guest' AND NEW.is_public = TRUE)
    EXECUTE FUNCTION update_listing_rating();

-- -----------------------------------------------------------------------------
-- Automatic Review Publication
-- -----------------------------------------------------------------------------
-- Makes both reviews public when both host and guest have submitted.
-- This prevents either party from seeing the other's review before writing theirs.
CREATE OR REPLACE FUNCTION check_and_publish_reviews()
RETURNS TRIGGER AS $$
DECLARE
    both_reviewed BOOLEAN;
BEGIN
    SELECT COUNT(DISTINCT author_type) = 2
    INTO both_reviewed
    FROM reviews
    WHERE booking_id = NEW.booking_id;

    IF both_reviewed THEN
        UPDATE reviews
        SET is_public = TRUE
        WHERE booking_id = NEW.booking_id;
    END IF;

    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER check_publish_reviews_trigger
    AFTER INSERT ON reviews
    FOR EACH ROW
    EXECUTE FUNCTION check_and_publish_reviews();
