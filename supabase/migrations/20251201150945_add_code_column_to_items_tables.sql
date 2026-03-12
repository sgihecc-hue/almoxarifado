/*
  # Add code column to items tables

  1. Changes
    - Add `code` column to pharmacy_items table
    - Add `code` column to warehouse_items table
    - Add unique constraint on code column for both tables
    - Add indexes for better query performance
    
  2. Security
    - Maintain existing RLS policies
*/

-- Add code column to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'code'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN code text;
  END IF;
END $$;

-- Add code column to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'code'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN code text;
  END IF;
END $$;

-- Add unique constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'pharmacy_items_code_key'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD CONSTRAINT pharmacy_items_code_key UNIQUE (code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'warehouse_items_code_key'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD CONSTRAINT warehouse_items_code_key UNIQUE (code);
  END IF;
END $$;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_code ON public.pharmacy_items(code);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_code ON public.warehouse_items(code);
