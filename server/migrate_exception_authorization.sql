-- Migration: Add Exception Authorization Fields
-- Date: 2026-02-10
-- Description: Adiciona campos para rastrear autorização de exceções por supervisor/admin

ALTER TABLE exceptions ADD COLUMN authorized_by TEXT REFERENCES users(id);
ALTER TABLE exceptions ADD COLUMN authorized_by_name TEXT;
ALTER TABLE exceptions ADD COLUMN authorized_at TEXT;
