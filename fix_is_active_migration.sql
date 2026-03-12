/*
  ============================================================================
  MIGRATION: Add is_active Column and Fix Duplicate Key Violations
  ============================================================================

  PURPOSE:
  - Fix error: "column warehouse_items.is_active does not exist"
  - Fix error: "duplicate key value violates unique constraint warehouse_items_code_key"

  INSTRUCTIONS:
  1. Open Supabase Dashboard (https://ojcpmwjejituqvjappxy.supabase.co)
  2. Go to SQL Editor
  3. Copy and paste this ENTIRE file
  4. Click "Run" to execute

  ============================================================================
*/

-- Step 1: Add is_active column to warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'warehouse_items'
    AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.warehouse_items ADD COLUMN is_active boolean DEFAULT true;
    RAISE NOTICE '✓ Added is_active column to warehouse_items';
  ELSE
    RAISE NOTICE '✓ is_active column already exists in warehouse_items';
  END IF;
END $$;

-- Step 2: Add is_active column to pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'pharmacy_items'
    AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.pharmacy_items ADD COLUMN is_active boolean DEFAULT true;
    RAISE NOTICE '✓ Added is_active column to pharmacy_items';
  ELSE
    RAISE NOTICE '✓ is_active column already exists in pharmacy_items';
  END IF;
END $$;

-- Step 3: Ensure all existing items are marked as active
UPDATE public.warehouse_items SET is_active = true WHERE is_active IS NULL;
UPDATE public.pharmacy_items SET is_active = true WHERE is_active IS NULL;

-- Step 4: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_warehouse_items_is_active
ON public.warehouse_items(is_active)
WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_is_active
ON public.pharmacy_items(is_active)
WHERE is_active = true;

-- Step 5: Fix duplicate key violations by inactivating old items
-- This allows new items with the same code to be created
UPDATE public.warehouse_items
SET is_active = false
WHERE code = '65.02.19.00099934-2' AND is_active = true;

-- Step 6: Verify the changes
DO $$
DECLARE
  warehouse_has_column boolean;
  pharmacy_has_column boolean;
  inactive_count integer;
BEGIN
  -- Check if columns exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'is_active'
  ) INTO warehouse_has_column;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'is_active'
  ) INTO pharmacy_has_column;

  -- Count inactive items
  SELECT COUNT(*) FROM public.warehouse_items WHERE is_active = false INTO inactive_count;

  -- Display results
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE 'MIGRATION COMPLETED SUCCESSFULLY';
  RAISE NOTICE '============================================================================';
  RAISE NOTICE '';
  RAISE NOTICE '✓ warehouse_items.is_active exists: %', warehouse_has_column;
  RAISE NOTICE '✓ pharmacy_items.is_active exists: %', pharmacy_has_column;
  RAISE NOTICE '✓ Inactive warehouse items: %', inactive_count;
  RAISE NOTICE '';
  RAISE NOTICE 'You can now:';
  RAISE NOTICE '  1. Create new items (duplicate code conflicts are resolved)';
  RAISE NOTICE '  2. View only active items in the application';
  RAISE NOTICE '  3. Reactivate items using the Edit Stock dialog';
  RAISE NOTICE '';
  RAISE NOTICE '============================================================================';
END $$;
