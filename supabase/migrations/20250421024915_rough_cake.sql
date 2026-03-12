/*
  # Fix expiry_tracking relationship with users

  1. Changes
    - Add foreign key constraint from expiry_tracking.created_by to users.id
    - Add index on expiry_tracking.created_by for better query performance

  2. Security
    - No changes to RLS policies
*/

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expiry_tracking_created_by_fkey'
  ) THEN
    ALTER TABLE expiry_tracking
    ADD CONSTRAINT expiry_tracking_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES users(id);
  END IF;
END
$$;

-- Add index for better performance if it doesn't exist
CREATE INDEX IF NOT EXISTS expiry_tracking_created_by_idx
ON expiry_tracking(created_by);