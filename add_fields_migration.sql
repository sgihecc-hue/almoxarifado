-- Migration: Add invoice and supplier fields to items tables
-- Execute this SQL in your Supabase SQL Editor

-- Add expiry_date to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'expiry_date'
  ) THEN
    ALTER TABLE pharmacy_items ADD COLUMN expiry_date date;
  END IF;
END $$;

-- Add invoice_number to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'invoice_number'
  ) THEN
    ALTER TABLE pharmacy_items ADD COLUMN invoice_number text;
  END IF;
END $$;

-- Add supplier_cnpj to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'supplier_cnpj'
  ) THEN
    ALTER TABLE pharmacy_items ADD COLUMN supplier_cnpj text;
  END IF;
END $$;

-- Add supplier_name to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'supplier_name'
  ) THEN
    ALTER TABLE pharmacy_items ADD COLUMN supplier_name text;
  END IF;
END $$;

-- Add afm_number to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'afm_number'
  ) THEN
    ALTER TABLE pharmacy_items ADD COLUMN afm_number text;
  END IF;
END $$;

-- Add invoice_total_value to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'invoice_total_value'
  ) THEN
    ALTER TABLE pharmacy_items ADD COLUMN invoice_total_value numeric(10,2);
  END IF;
END $$;

-- Add expiry_date to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'expiry_date'
  ) THEN
    ALTER TABLE warehouse_items ADD COLUMN expiry_date date;
  END IF;
END $$;

-- Add invoice_number to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'invoice_number'
  ) THEN
    ALTER TABLE warehouse_items ADD COLUMN invoice_number text;
  END IF;
END $$;

-- Add supplier_cnpj to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'supplier_cnpj'
  ) THEN
    ALTER TABLE warehouse_items ADD COLUMN supplier_cnpj text;
  END IF;
END $$;

-- Add supplier_name to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'supplier_name'
  ) THEN
    ALTER TABLE warehouse_items ADD COLUMN supplier_name text;
  END IF;
END $$;

-- Add afm_number to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'afm_number'
  ) THEN
    ALTER TABLE warehouse_items ADD COLUMN afm_number text;
  END IF;
END $$;

-- Add invoice_total_value to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'invoice_total_value'
  ) THEN
    ALTER TABLE warehouse_items ADD COLUMN invoice_total_value numeric(10,2);
  END IF;
END $$;

-- Add supplier_cnpj to expiry_tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'supplier_cnpj'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN supplier_cnpj text;
  END IF;
END $$;

-- Add supplier_name to expiry_tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'supplier_name'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN supplier_name text;
  END IF;
END $$;

-- Add invoice_total_value to expiry_tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'invoice_total_value'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN invoice_total_value numeric(10,2);
  END IF;
END $$;
