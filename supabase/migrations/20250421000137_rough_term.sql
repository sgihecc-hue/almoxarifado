/*
  # Check and create policy for request status history

  1. Security
    - Add policy to allow managers to insert into request_status_history table (if it doesn't exist)
*/

DO $$
BEGIN
  -- Check if the policy already exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'request_status_history' 
    AND policyname = 'Managers can insert status history'
  ) THEN
    -- Create the policy only if it doesn't exist
    EXECUTE 'CREATE POLICY "Managers can insert status history"
      ON public.request_status_history
      FOR INSERT
      TO authenticated
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role IN (''gestor'', ''administrador'')
        )
      )';
  END IF;
END
$$;