/*
  # Fix audit_logs RLS policies

  1. Changes
    - Add INSERT policy for audit_logs to allow authenticated users to insert audit records
    - This is needed for database triggers that automatically log changes
    
  2. Security
    - Allow authenticated users to insert audit logs (triggered automatically by the database)
    - Maintain existing SELECT policy (only administrators can view audit logs)
*/

-- Drop the policy if it exists and recreate it
DO $$
BEGIN
  -- Drop existing INSERT policy if exists
  DROP POLICY IF EXISTS "Authenticated users can insert audit logs" ON audit_logs;
  
  -- Create INSERT policy for authenticated users
  -- This allows triggers to insert audit logs automatically
  CREATE POLICY "Authenticated users can insert audit logs"
    ON audit_logs
    FOR INSERT
    TO authenticated
    WITH CHECK (true);
END $$;
