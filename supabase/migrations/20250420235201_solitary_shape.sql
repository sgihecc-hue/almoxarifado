/*
  # Add insert policy for request status history

  1. Changes
    - Add RLS policy to allow managers and administrators to insert new status history records
    - Policy ensures only authorized users can track status changes

  2. Security
    - Enable RLS on request_status_history table (already enabled)
    - Add policy for INSERT operations
    - Only managers and administrators can insert new status records
*/

CREATE POLICY "Managers can insert status history"
ON public.request_status_history
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM users
    WHERE users.id = auth.uid()
    AND users.role IN ('gestor', 'administrador')
  )
);