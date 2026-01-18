-- Migration 001: Initial Schema
-- NOTE: Schema is applied by Docker via init.sql mounted to /docker-entrypoint-initdb.d/
-- This migration marks the initial schema as tracked in the migrations table.
-- Cassandra schema is handled separately via cassandra-init.cql.

DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users') THEN
        RAISE NOTICE 'Initial schema already exists (applied by Docker init.sql)';
    ELSE
        RAISE NOTICE 'Running initial schema setup...';
    END IF;
END $$;
