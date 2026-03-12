/*
  # Add missing columns to items tables

  1. Changes
    - Add `description` column to both tables
    - Add `price` column to both tables
    - Add `reorder_status` column to both tables
    - Add `last_reorder_date` column to both tables
    - Add `lead_time_days` column to both tables
    - Rename `minimum_stock` to `min_stock` (via alias view if needed)
    
  2. Security
    - Maintain existing RLS policies
*/

-- Add description column to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'description'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN description text;
  END IF;
END $$;

-- Add description column to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'description'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN description text;
  END IF;
END $$;

-- Add price column to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'price'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN price numeric(10,2);
  END IF;
END $$;

-- Add price column to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'price'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN price numeric(10,2);
  END IF;
END $$;

-- Add reorder_status column to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'reorder_status'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN reorder_status text DEFAULT 'normal';
  END IF;
END $$;

-- Add reorder_status column to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'reorder_status'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN reorder_status text DEFAULT 'normal';
  END IF;
END $$;

-- Add last_reorder_date column to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'last_reorder_date'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN last_reorder_date timestamp with time zone;
  END IF;
END $$;

-- Add last_reorder_date column to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'last_reorder_date'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN last_reorder_date timestamp with time zone;
  END IF;
END $$;

-- Add lead_time_days column to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'lead_time_days'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN lead_time_days integer;
  END IF;
END $$;

-- Add lead_time_days column to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'lead_time_days'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN lead_time_days integer;
  END IF;
END $$;

-- Add min_stock as alias for minimum_stock
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'min_stock'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN min_stock integer;
    
    -- Copy data from minimum_stock to min_stock
    UPDATE public.pharmacy_items SET min_stock = minimum_stock;
    
    -- Set NOT NULL constraint
    ALTER TABLE public.pharmacy_items ALTER COLUMN min_stock SET NOT NULL;
    ALTER TABLE public.pharmacy_items ALTER COLUMN min_stock SET DEFAULT 0;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'min_stock'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN min_stock integer;
    
    -- Copy data from minimum_stock to min_stock
    UPDATE public.warehouse_items SET min_stock = minimum_stock;
    
    -- Set NOT NULL constraint
    ALTER TABLE public.warehouse_items ALTER COLUMN min_stock SET NOT NULL;
    ALTER TABLE public.warehouse_items ALTER COLUMN min_stock SET DEFAULT 0;
  END IF;
END $$;
