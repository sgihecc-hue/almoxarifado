/*
  # Fix request status history RLS policies

  1. Changes
    - Update RLS policies for request_status_history table
    - Add policy for inserting status history entries
    - Add policy for managers to update status history
    - Add policy for viewing status history

  2. Security
    - Enable RLS on request_status_history table
    - Add policies to control access based on user role and request ownership
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view status history of their requests" ON request_status_history;
DROP POLICY IF EXISTS "Managers can insert status history" ON request_status_history;

-- Create new policies
CREATE POLICY "view_request_status_history" ON request_status_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM requests
      WHERE requests.id = request_status_history.request_id
      AND (
        -- User can view their own requests
        requests.created_by = auth.uid()
        OR
        -- Managers and administrators can view all requests
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN ('gestor', 'administrador')
        )
      )
    )
  );

CREATE POLICY "insert_request_status_history" ON request_status_history
  FOR INSERT TO authenticated
  WITH CHECK (
    -- Check if user is a manager/admin
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role IN ('gestor', 'administrador')
    )
    OR
    -- Or if they are the request creator (for certain status changes)
    EXISTS (
      SELECT 1 FROM requests
      WHERE requests.id = request_id
      AND requests.created_by = auth.uid()
      AND new_status IN ('cancelled')
    )
  );

CREATE POLICY "update_request_status_history" ON request_status_history
  FOR UPDATE TO authenticated
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