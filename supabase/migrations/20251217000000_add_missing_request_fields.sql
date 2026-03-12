/*
  # Add Missing Request Fields and Auto-generate Request Number

  1. Schema Changes
    - Add `priority` column to `requests` table (low, medium, high)
    - Add `justification` column to `requests` table
    - Make `request_number` auto-generated with default value

  2. Functions
    - `generate_request_number()` - Auto-generate unique request numbers

  3. Triggers
    - Auto-generate request_number before insert
*/

-- Add priority column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'priority'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high'));
  END IF;
END $$;

-- Add justification column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'requests'
    AND column_name = 'justification'
  ) THEN
    ALTER TABLE public.requests
    ADD COLUMN justification text;
  END IF;
END $$;

-- Function to generate unique request number
CREATE OR REPLACE FUNCTION generate_request_number()
RETURNS text AS $$
DECLARE
  v_year text;
  v_month text;
  v_sequence integer;
  v_request_number text;
  v_exists boolean;
BEGIN
  v_year := to_char(CURRENT_DATE, 'YYYY');
  v_month := to_char(CURRENT_DATE, 'MM');

  -- Get the next sequence number for this year-month
  SELECT COALESCE(MAX(
    CASE
      WHEN request_number ~ ('^REQ-' || v_year || v_month || '-[0-9]+$')
      THEN CAST(substring(request_number from '[0-9]+$') AS integer)
      ELSE 0
    END
  ), 0) + 1
  INTO v_sequence
  FROM public.requests
  WHERE request_number LIKE 'REQ-' || v_year || v_month || '-%';

  -- Generate request number
  v_request_number := 'REQ-' || v_year || v_month || '-' || lpad(v_sequence::text, 4, '0');

  -- Ensure uniqueness (in case of race condition)
  LOOP
    SELECT EXISTS(SELECT 1 FROM public.requests WHERE request_number = v_request_number) INTO v_exists;
    EXIT WHEN NOT v_exists;
    v_sequence := v_sequence + 1;
    v_request_number := 'REQ-' || v_year || v_month || '-' || lpad(v_sequence::text, 4, '0');
  END LOOP;

  RETURN v_request_number;
END;
$$ LANGUAGE plpgsql;

-- Function to auto-generate request number before insert
CREATE OR REPLACE FUNCTION set_request_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.request_number IS NULL OR NEW.request_number = '' THEN
    NEW.request_number := generate_request_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS set_request_number_trigger ON public.requests;

-- Create trigger to auto-generate request number
CREATE TRIGGER set_request_number_trigger
  BEFORE INSERT ON public.requests
  FOR EACH ROW
  EXECUTE FUNCTION set_request_number();

-- Make request_number nullable temporarily for existing records
ALTER TABLE public.requests
ALTER COLUMN request_number DROP NOT NULL;

-- Generate request numbers for existing records that don't have one
DO $$
DECLARE
  v_request RECORD;
BEGIN
  FOR v_request IN
    SELECT id FROM public.requests WHERE request_number IS NULL OR request_number = ''
  LOOP
    UPDATE public.requests
    SET request_number = generate_request_number()
    WHERE id = v_request.id;
  END LOOP;
END $$;

-- Make request_number required again
ALTER TABLE public.requests
ALTER COLUMN request_number SET NOT NULL;
