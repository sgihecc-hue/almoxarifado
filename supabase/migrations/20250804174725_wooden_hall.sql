/*
  # Add invoice and delivery fields to expiry_tracking table

  1. New Columns
    - `invoice_number` (text) - Número da nota fiscal
    - `invoice_date` (date) - Data da emissão da nota fiscal  
    - `delivery_date` (date) - Data de entrega
    - `afm_number` (text) - Número AFM

  2. Changes
    - Add new columns to expiry_tracking table to support invoice tracking
    - All fields are optional to maintain compatibility with existing data
*/

-- Add invoice number column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'invoice_number'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN invoice_number text;
  END IF;
END $$;

-- Add invoice date column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'invoice_date'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN invoice_date date;
  END IF;
END $$;

-- Add delivery date column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'delivery_date'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN delivery_date date;
  END IF;
END $$;

-- Add AFM number column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'afm_number'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN afm_number text;
  END IF;
END $$;