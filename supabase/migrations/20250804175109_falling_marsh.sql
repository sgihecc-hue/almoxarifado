/*
  # Add supplier and unit_price fields to expiry_tracking table

  1. New Columns
    - `supplier` (text) - Supplier name
    - `unit_price` (numeric) - Unit price of the item

  2. Changes
    - Add supplier column to store supplier name directly
    - Add unit_price column to store the unit price
    - Both columns are nullable for backward compatibility
*/

DO $$
BEGIN
  -- Add supplier column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'supplier'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN supplier text;
  END IF;

  -- Add unit_price column if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expiry_tracking' AND column_name = 'unit_price'
  ) THEN
    ALTER TABLE expiry_tracking ADD COLUMN unit_price numeric(10,2);
  END IF;
END $$;