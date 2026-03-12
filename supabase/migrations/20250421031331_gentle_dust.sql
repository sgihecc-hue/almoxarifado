/*
  # Add RLS policies for expiry tracking

  1. Changes
    - Add RLS policy to allow managers and administrators to insert into expiry_tracking table
    - Add RLS policy to allow managers and administrators to update expiry_tracking table
    - Add RLS policy to allow all authenticated users to view expiry_tracking records

  2. Security
    - Enable RLS on expiry_tracking table (if not already enabled)
    - Restrict insert/update operations to managers and administrators
    - Allow read access to all authenticated users
*/

-- Enable RLS
ALTER TABLE expiry_tracking ENABLE ROW LEVEL SECURITY;

-- Allow managers and administrators to insert records
CREATE POLICY "Managers can insert expiry tracking records"
ON expiry_tracking
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('gestor', 'administrador')
  )
);

-- Allow managers and administrators to update records
CREATE POLICY "Managers can update expiry tracking records"
ON expiry_tracking
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('gestor', 'administrador')
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('gestor', 'administrador')
  )
);

-- Allow all authenticated users to view records
CREATE POLICY "All authenticated users can view expiry tracking records"
ON expiry_tracking
FOR SELECT
TO authenticated
USING (true);