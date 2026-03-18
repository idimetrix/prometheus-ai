-- Enable pgvector extension for embedding storage
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable pg_trgm for text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
