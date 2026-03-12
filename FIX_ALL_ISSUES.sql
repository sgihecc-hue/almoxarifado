/*
  # Fix Missing Tables and Columns

  This migration adds all missing tables, columns, and foreign keys
  required by the application.

  1. New Tables
    - `expiry_tracking` - Tracks batch/lot expiry dates for items
    - `warehouse_consumption_entries` - Records warehouse item consumption
    - `pharmacy_consumption_entries` - Records pharmacy item consumption

  2. Modified Tables
    - `departments` - Add `code` column
    - `request_items` - Add `status` column
    - `audit_logs` - Add foreign key to users

  3. Security
    - Enable RLS on all new tables
    - Add appropriate policies for authenticated users
*/

-- Add code column to departments if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'code'
  ) THEN
    ALTER TABLE departments ADD COLUMN code text;
  END IF;
END $$;

-- Add status column to request_items if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'request_items' AND column_name = 'status'
  ) THEN
    ALTER TABLE request_items ADD COLUMN status text DEFAULT 'available';
  END IF;
END $$;

-- Create expiry_tracking table if not exists
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

-- Create warehouse_consumption_entries table if not exists
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

-- Create pharmacy_consumption_entries table if not exists
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

-- Add foreign key constraint to audit_logs for changed_by if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'audit_logs_changed_by_fkey'
    AND table_name = 'audit_logs'
  ) THEN
    ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_changed_by_fkey
    FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

-- Add foreign key constraint to expiry_tracking for created_by if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'expiry_tracking_created_by_fkey'
    AND table_name = 'expiry_tracking'
  ) THEN
    ALTER TABLE expiry_tracking
    ADD CONSTRAINT expiry_tracking_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

-- Add foreign key constraint to warehouse_consumption_entries for created_by
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'warehouse_consumption_entries_created_by_fkey'
    AND table_name = 'warehouse_consumption_entries'
  ) THEN
    ALTER TABLE warehouse_consumption_entries
    ADD CONSTRAINT warehouse_consumption_entries_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

-- Add foreign key constraint to pharmacy_consumption_entries for created_by
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'pharmacy_consumption_entries_created_by_fkey'
    AND table_name = 'pharmacy_consumption_entries'
  ) THEN
    ALTER TABLE pharmacy_consumption_entries
    ADD CONSTRAINT pharmacy_consumption_entries_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN others THEN
    NULL;
END $$;

-- Enable RLS on new tables
ALTER TABLE expiry_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_consumption_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_consumption_entries ENABLE ROW LEVEL SECURITY;

-- Policies for expiry_tracking
DROP POLICY IF EXISTS "Authenticated users can read expiry tracking" ON expiry_tracking;
CREATE POLICY "Authenticated users can read expiry tracking"
  ON expiry_tracking FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can insert expiry tracking" ON expiry_tracking;
CREATE POLICY "Managers can insert expiry tracking"
  ON expiry_tracking FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));

DROP POLICY IF EXISTS "Managers can update expiry tracking" ON expiry_tracking;
CREATE POLICY "Managers can update expiry tracking"
  ON expiry_tracking FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));

DROP POLICY IF EXISTS "Admins can delete expiry tracking" ON expiry_tracking;
CREATE POLICY "Admins can delete expiry tracking"
  ON expiry_tracking FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- Policies for warehouse_consumption_entries
DROP POLICY IF EXISTS "Authenticated users can read warehouse consumption" ON warehouse_consumption_entries;
CREATE POLICY "Authenticated users can read warehouse consumption"
  ON warehouse_consumption_entries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can insert warehouse consumption" ON warehouse_consumption_entries;
CREATE POLICY "Managers can insert warehouse consumption"
  ON warehouse_consumption_entries FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'warehouse_manager')));

DROP POLICY IF EXISTS "Managers can update warehouse consumption" ON warehouse_consumption_entries;
CREATE POLICY "Managers can update warehouse consumption"
  ON warehouse_consumption_entries FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'warehouse_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'warehouse_manager')));

DROP POLICY IF EXISTS "Admins can delete warehouse consumption" ON warehouse_consumption_entries;
CREATE POLICY "Admins can delete warehouse consumption"
  ON warehouse_consumption_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- Policies for pharmacy_consumption_entries
DROP POLICY IF EXISTS "Authenticated users can read pharmacy consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Authenticated users can read pharmacy consumption"
  ON pharmacy_consumption_entries FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Managers can insert pharmacy consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Managers can insert pharmacy consumption"
  ON pharmacy_consumption_entries FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist')));

DROP POLICY IF EXISTS "Managers can update pharmacy consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Managers can update pharmacy consumption"
  ON pharmacy_consumption_entries FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist')));

DROP POLICY IF EXISTS "Admins can delete pharmacy consumption" ON pharmacy_consumption_entries;
CREATE POLICY "Admins can delete pharmacy consumption"
  ON pharmacy_consumption_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_expiry_tracking_item_id ON expiry_tracking(item_id);
CREATE INDEX IF NOT EXISTS idx_expiry_tracking_expiry_date ON expiry_tracking(expiry_date);
CREATE INDEX IF NOT EXISTS idx_warehouse_consumption_item_id ON warehouse_consumption_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_consumption_department_id ON warehouse_consumption_entries(department_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_consumption_date ON warehouse_consumption_entries(date);
CREATE INDEX IF NOT EXISTS idx_pharmacy_consumption_item_id ON pharmacy_consumption_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_consumption_department_id ON pharmacy_consumption_entries(department_id);
CREATE INDEX IF NOT EXISTS idx_pharmacy_consumption_date ON pharmacy_consumption_entries(date);
