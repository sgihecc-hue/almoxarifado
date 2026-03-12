/*
  # Fix Missing Columns for Requests System

  Migration name: fix_missing_columns_for_requests

  This migration is idempotent and can be run multiple times safely.

  1. Schema Changes
    - Add `is_active` column to `pharmacy_items` table (DEFAULT true)
    - Add `is_active` column to `warehouse_items` table (DEFAULT true)
    - Add `item_type` column to `request_items` table (CHECK IN ('pharmacy', 'warehouse'))
    - Add `pharmacy_item_id` column to `request_items` table (REFERENCES pharmacy_items(id))
    - Add `warehouse_item_id` column to `request_items` table (REFERENCES warehouse_items(id))
    - Add `status` column to `request_items` table (DEFAULT 'available', CHECK IN ('available', 'low_stock'))
    - Update requests table status CHECK constraint to include 'cancelled'
    - Add rejection fields to requests: rejected_at, rejected_by, rejection_reason
    - Add completion fields to requests: completed_at, completed_by
    - Add cancellation fields to requests: cancelled_at, cancelled_by, cancellation_reason
    - Add delivery receipt fields to requests: received_at, received_by, delivery_notes, receipt_notes
    - Add reason column to request_status_history table

  2. New Tables
    - Create request_comments table if it doesn't exist

  3. Indexes
    - Create appropriate indexes for new columns

  4. Security
    - Enable RLS on request_comments and add policies
*/

-- ============================================================================
-- 1. Add is_active column to pharmacy_items table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.pharmacy_items
    ADD COLUMN is_active boolean DEFAULT true NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 2. Add is_active column to warehouse_items table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.warehouse_items
    ADD COLUMN is_active boolean DEFAULT true NOT NULL;
  END IF;
END $$;

-- ============================================================================
-- 3. Add item_type column to request_items table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'request_items'
    AND column_name = 'item_type'
  ) THEN
    ALTER TABLE public.request_items
    ADD COLUMN item_type text CHECK (item_type IN ('pharmacy', 'warehouse'));
  END IF;
END $$;

-- ============================================================================
-- 4. Add pharmacy_item_id column to request_items table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'request_items'
    AND column_name = 'pharmacy_item_id'
  ) THEN
    ALTER TABLE public.request_items
    ADD COLUMN pharmacy_item_id uuid REFERENCES public.pharmacy_items(id);
  END IF;
END $$;

-- ============================================================================
-- 5. Add warehouse_item_id column to request_items table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'request_items'
    AND column_name = 'warehouse_item_id'
  ) THEN
    ALTER TABLE public.request_items
    ADD COLUMN warehouse_item_id uuid REFERENCES public.warehouse_items(id);
  END IF;
END $$;

-- ============================================================================
-- 6. Add status column to request_items table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'request_items'
    AND column_name = 'status'
  ) THEN
    ALTER TABLE public.request_items
    ADD COLUMN status text DEFAULT 'available' CHECK (status IN ('available', 'low_stock'));
  END IF;
END $$;

-- ============================================================================
-- 7. Update requests table status CHECK constraint to include 'cancelled'
-- ============================================================================
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND constraint_name = 'requests_status_check'
  ) THEN
    ALTER TABLE public.requests DROP CONSTRAINT requests_status_check;
  END IF;

  -- Add updated constraint with 'cancelled' status
  ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'delivered', 'cancelled'));
END $$;

-- ============================================================================
-- 8. Add rejection fields to requests table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'rejected_at'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN rejected_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'rejected_by'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN rejected_by uuid REFERENCES public.users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN rejection_reason text;
  END IF;
END $$;

-- ============================================================================
-- 9. Add completion fields to requests table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'completed_at'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN completed_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'completed_by'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN completed_by uuid REFERENCES public.users(id);
  END IF;
END $$;

-- ============================================================================
-- 10. Add cancellation fields to requests table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'cancelled_at'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN cancelled_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'cancelled_by'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN cancelled_by uuid REFERENCES public.users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'cancellation_reason'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN cancellation_reason text;
  END IF;
END $$;

-- ============================================================================
-- 11. Add delivery receipt fields to requests table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'received_at'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN received_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'received_by'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN received_by uuid REFERENCES public.users(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'delivery_notes'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN delivery_notes text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'receipt_notes'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN receipt_notes text;
  END IF;
END $$;

-- ============================================================================
-- 12. Create request_comments table if it doesn't exist
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 13. Add reason column to request_status_history table
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'request_status_history'
    AND column_name = 'reason'
  ) THEN
    ALTER TABLE public.request_status_history
    ADD COLUMN reason text;
  END IF;
END $$;

-- ============================================================================
-- 14. Create appropriate indexes for new columns
-- ============================================================================

-- Indexes for pharmacy_items
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_is_active
ON public.pharmacy_items(is_active);

-- Indexes for warehouse_items
CREATE INDEX IF NOT EXISTS idx_warehouse_items_is_active
ON public.warehouse_items(is_active);

-- Indexes for request_items
CREATE INDEX IF NOT EXISTS idx_request_items_item_type
ON public.request_items(item_type);

CREATE INDEX IF NOT EXISTS idx_request_items_pharmacy_item_id
ON public.request_items(pharmacy_item_id);

CREATE INDEX IF NOT EXISTS idx_request_items_warehouse_item_id
ON public.request_items(warehouse_item_id);

CREATE INDEX IF NOT EXISTS idx_request_items_status
ON public.request_items(status);

-- Indexes for requests table (new fields)
CREATE INDEX IF NOT EXISTS idx_requests_rejected_at
ON public.requests(rejected_at);

CREATE INDEX IF NOT EXISTS idx_requests_rejected_by
ON public.requests(rejected_by);

CREATE INDEX IF NOT EXISTS idx_requests_completed_at
ON public.requests(completed_at);

CREATE INDEX IF NOT EXISTS idx_requests_completed_by
ON public.requests(completed_by);

CREATE INDEX IF NOT EXISTS idx_requests_cancelled_at
ON public.requests(cancelled_at);

CREATE INDEX IF NOT EXISTS idx_requests_cancelled_by
ON public.requests(cancelled_by);

CREATE INDEX IF NOT EXISTS idx_requests_received_at
ON public.requests(received_at);

CREATE INDEX IF NOT EXISTS idx_requests_received_by
ON public.requests(received_by);

-- Indexes for request_comments
CREATE INDEX IF NOT EXISTS idx_request_comments_request_id
ON public.request_comments(request_id);

CREATE INDEX IF NOT EXISTS idx_request_comments_user_id
ON public.request_comments(user_id);

CREATE INDEX IF NOT EXISTS idx_request_comments_created_at
ON public.request_comments(created_at);

-- ============================================================================
-- 15. Enable RLS on request_comments and add policies
-- ============================================================================

-- Enable RLS
DO $$
BEGIN
  ALTER TABLE public.request_comments ENABLE ROW LEVEL SECURITY;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Drop existing policies if they exist (to make migration idempotent)
DROP POLICY IF EXISTS "Users can view comments on their requests" ON public.request_comments;
DROP POLICY IF EXISTS "Users can create comments on their requests" ON public.request_comments;
DROP POLICY IF EXISTS "Users can update their own comments" ON public.request_comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.request_comments;
DROP POLICY IF EXISTS "Managers can view all comments" ON public.request_comments;

-- RLS Policy: Users can view comments on requests they have access to
CREATE POLICY "Users can view comments on their requests"
  ON public.request_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.requests
      WHERE requests.id = request_comments.request_id
      AND (
        requests.requester_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
        )
      )
    )
  );

-- RLS Policy: Users can create comments on requests they have access to
CREATE POLICY "Users can create comments on their requests"
  ON public.request_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.requests
      WHERE requests.id = request_comments.request_id
      AND (
        requests.requester_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
        )
      )
    )
  );

-- RLS Policy: Users can update their own comments
CREATE POLICY "Users can update their own comments"
  ON public.request_comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policy: Users can delete their own comments (or admins can delete any)
CREATE POLICY "Users can delete their own comments"
  ON public.request_comments FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'administrador'
    )
  );
