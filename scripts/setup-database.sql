/*
  EXECUTE THIS SQL IN SUPABASE SQL EDITOR
  https://supabase.com/dashboard/project/ojcpmwjejituqvjappxy/sql/new

  This creates all missing tables and columns needed by the application.
*/

-- Add code column to departments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'code'
  ) THEN
    ALTER TABLE departments ADD COLUMN code text;
  END IF;
END $$;

-- Add status column to request_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'request_items' AND column_name = 'status'
  ) THEN
    ALTER TABLE request_items ADD COLUMN status text DEFAULT 'available';
  END IF;
END $$;

-- Create expiry_tracking table
CREATE TABLE IF NOT EXISTS expiry_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  batch_number text NOT NULL,
  expiry_date date,
  initial_quantity integer NOT NULL DEFAULT 0,
  current_quantity integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  invoice_number text,
  invoice_date date,
  delivery_date date,
  afm_number text,
  supplier_cnpj text,
  supplier_name text,
  invoice_total_value numeric(12,2)
);

-- Create warehouse_consumption_entries table
CREATE TABLE IF NOT EXISTS warehouse_consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  quantity integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Create pharmacy_consumption_entries table
CREATE TABLE IF NOT EXISTS pharmacy_consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  quantity integer NOT NULL DEFAULT 0,
  notes text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE expiry_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_consumption_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_consumption_entries ENABLE ROW LEVEL SECURITY;

-- Policies for expiry_tracking
DROP POLICY IF EXISTS "Auth users read expiry_tracking" ON expiry_tracking;
CREATE POLICY "Auth users read expiry_tracking" ON expiry_tracking FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users insert expiry_tracking" ON expiry_tracking;
CREATE POLICY "Auth users insert expiry_tracking" ON expiry_tracking FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Auth users update expiry_tracking" ON expiry_tracking;
CREATE POLICY "Auth users update expiry_tracking" ON expiry_tracking FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Auth users delete expiry_tracking" ON expiry_tracking;
CREATE POLICY "Auth users delete expiry_tracking" ON expiry_tracking FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Policies for warehouse_consumption_entries
DROP POLICY IF EXISTS "Auth users read warehouse_consumption" ON warehouse_consumption_entries;
CREATE POLICY "Auth users read warehouse_consumption" ON warehouse_consumption_entries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users insert warehouse_consumption" ON warehouse_consumption_entries;
CREATE POLICY "Auth users insert warehouse_consumption" ON warehouse_consumption_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Auth users update warehouse_consumption" ON warehouse_consumption_entries;
CREATE POLICY "Auth users update warehouse_consumption" ON warehouse_consumption_entries FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Auth users delete warehouse_consumption" ON warehouse_consumption_entries;
CREATE POLICY "Auth users delete warehouse_consumption" ON warehouse_consumption_entries FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Policies for pharmacy_consumption_entries
DROP POLICY IF EXISTS "Auth users read pharmacy_consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Auth users read pharmacy_consumption" ON pharmacy_consumption_entries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Auth users insert pharmacy_consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Auth users insert pharmacy_consumption" ON pharmacy_consumption_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Auth users update pharmacy_consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Auth users update pharmacy_consumption" ON pharmacy_consumption_entries FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Auth users delete pharmacy_consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Auth users delete pharmacy_consumption" ON pharmacy_consumption_entries FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_expiry_item ON expiry_tracking(item_id);
CREATE INDEX IF NOT EXISTS idx_wh_cons_item ON warehouse_consumption_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_wh_cons_dept ON warehouse_consumption_entries(department_id);
CREATE INDEX IF NOT EXISTS idx_ph_cons_item ON pharmacy_consumption_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_ph_cons_dept ON pharmacy_consumption_entries(department_id);
