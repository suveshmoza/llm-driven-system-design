-- Cassandra schema for Instagram Direct Messages
-- Optimized for high-write, time-ordered message retrieval

-- Create keyspace with simple strategy for local development
-- In production, use NetworkTopologyStrategy with appropriate replication factor
CREATE KEYSPACE IF NOT EXISTS instagram_dm
WITH REPLICATION = {
  'class': 'SimpleStrategy',
  'replication_factor': 1
};

USE instagram_dm;

-- Messages by conversation
-- Partition key: conversation_id (all messages in a conversation together)
-- Clustering key: message_id (TimeUUID for time-ordered retrieval)
CREATE TABLE IF NOT EXISTS messages_by_conversation (
    conversation_id UUID,
    message_id TIMEUUID,
    sender_id UUID,
    content TEXT,
    content_type TEXT,          -- 'text', 'image', 'video', 'heart', 'story_reply'
    media_url TEXT,             -- URL for media content
    reply_to_message_id TIMEUUID, -- For message replies
    created_at TIMESTAMP,
    PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC)
  AND default_time_to_live = 31536000  -- 1 year TTL
  AND gc_grace_seconds = 86400;         -- 1 day grace period for tombstone cleanup

-- Conversations by user (inbox view)
-- Partition key: user_id (all conversations for a user together)
-- Clustering keys: last_message_at, conversation_id for ordering
CREATE TABLE IF NOT EXISTS conversations_by_user (
    user_id UUID,
    last_message_at TIMESTAMP,
    conversation_id UUID,
    other_user_id UUID,           -- For 1:1 DMs (the other participant)
    other_username TEXT,          -- Denormalized for fast display
    other_profile_picture TEXT,   -- Denormalized for fast display
    last_message_preview TEXT,    -- First 100 chars of last message
    last_message_sender_id UUID,
    unread_count INT,
    is_muted BOOLEAN,
    PRIMARY KEY (user_id, last_message_at, conversation_id)
) WITH CLUSTERING ORDER BY (last_message_at DESC, conversation_id ASC);

-- Conversation participants (for group DMs)
-- Allows looking up all participants in a conversation
CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id UUID,
    user_id UUID,
    username TEXT,
    profile_picture TEXT,
    joined_at TIMESTAMP,
    is_admin BOOLEAN,
    PRIMARY KEY (conversation_id, user_id)
);

-- User lookup for conversations (reverse lookup)
-- Find conversation between two users
CREATE TABLE IF NOT EXISTS user_conversation_lookup (
    user_id_pair TEXT,            -- Sorted concatenation of two user UUIDs
    conversation_id UUID,
    created_at TIMESTAMP,
    PRIMARY KEY (user_id_pair)
);

-- Message read receipts
-- Tracks when each user last read a conversation
CREATE TABLE IF NOT EXISTS message_read_receipts (
    conversation_id UUID,
    user_id UUID,
    last_read_message_id TIMEUUID,
    last_read_at TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
);

-- Typing indicators (ephemeral, short TTL)
CREATE TABLE IF NOT EXISTS typing_indicators (
    conversation_id UUID,
    user_id UUID,
    started_at TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
) WITH default_time_to_live = 5;  -- 5 second TTL

-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
    conversation_id UUID,
    message_id TIMEUUID,
    user_id UUID,
    reaction TEXT,                -- 'heart', 'laugh', 'surprised', etc.
    created_at TIMESTAMP,
    PRIMARY KEY ((conversation_id, message_id), user_id)
);
