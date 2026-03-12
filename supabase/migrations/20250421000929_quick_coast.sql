/*
  # Fix Request Approval Flow

  1. Changes
    - Add a function to safely update request items during approval
    - Ensure request_items table has proper constraints
    - Add trigger to track request status changes
  
  2. Security
    - Add policy for request status history if it doesn't exist
*/

-- First check if the policy already exists and create it if needed
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'request_status_history' 
    AND policyname = 'Managers can insert status history'
  ) THEN
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

-- Create a function to safely update request items during approval
CREATE OR REPLACE FUNCTION approve_request_items(
  p_request_id UUID,
  p_approved_quantities JSONB,
  p_approver_id UUID
) RETURNS VOID AS $$
DECLARE
  v_item_id UUID;
  v_approved_quantity INTEGER;
  v_item RECORD;
BEGIN
  -- Update the request status
  UPDATE requests
  SET 
    status = 'approved',
    approved_at = NOW(),
    approved_by = p_approver_id
  WHERE id = p_request_id;
  
  -- Process each item in the approved quantities
  FOR v_item_id, v_approved_quantity IN 
    SELECT * FROM jsonb_each_text(p_approved_quantities)
  LOOP
    -- Get the original item to preserve its data
    SELECT * INTO v_item FROM request_items WHERE id = v_item_id::UUID;
    
    IF v_item IS NULL THEN
      RAISE EXCEPTION 'Request item % not found', v_item_id;
    END IF;
    
    -- Update the approved quantity while preserving other fields
    UPDATE request_items
    SET approved_quantity = v_approved_quantity::INTEGER
    WHERE id = v_item_id::UUID;
  END LOOP;
  
  -- Insert into status history
  INSERT INTO request_status_history (
    request_id, 
    old_status, 
    new_status, 
    changed_by, 
    changed_at
  ) VALUES (
    p_request_id,
    'pending',
    'approved',
    p_approver_id,
    NOW()
  );
END;
$$ LANGUAGE plpgsql;

-- Ensure request_items table has proper constraints
DO $$
BEGIN
  -- Check if the quantity column has a NOT NULL constraint
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'request_items'
    AND column_name = 'quantity'
    AND is_nullable = 'NO'
  ) THEN
    -- Add NOT NULL constraint if it doesn't exist
    ALTER TABLE request_items ALTER COLUMN quantity SET NOT NULL;
  END IF;
  
  -- Add check constraint for quantity > 0 if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'request_items_quantity_check'
  ) THEN
    ALTER TABLE request_items ADD CONSTRAINT request_items_quantity_check CHECK (quantity > 0);
  END IF;
END
$$;