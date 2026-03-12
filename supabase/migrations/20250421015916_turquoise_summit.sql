/*
  # Add Warehouse Consumption Entries Table

  1. New Tables
    - `warehouse_consumption_entries`
      - `id` (uuid, primary key)
      - `item_id` (uuid, references warehouse_items)
      - `department_id` (uuid, references departments)
      - `date` (date)
      - `quantity` (integer)
      - `notes` (text, optional)
      - `created_by` (uuid, references users)
      - `created_at` (timestamp with time zone)

  2. Security
    - Enable RLS on `warehouse_consumption_entries` table
    - Add policy for authenticated users to read warehouse consumption entries
    - Add policy for administrators to insert, update, and delete warehouse consumption entries
*/

-- Create warehouse_consumption_entries table
CREATE TABLE IF NOT EXISTS warehouse_consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  date date NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS warehouse_consumption_entries_item_id_idx ON warehouse_consumption_entries(item_id);
CREATE INDEX IF NOT EXISTS warehouse_consumption_entries_department_id_idx ON warehouse_consumption_entries(department_id);
CREATE INDEX IF NOT EXISTS warehouse_consumption_entries_date_idx ON warehouse_consumption_entries(date);
CREATE INDEX IF NOT EXISTS warehouse_consumption_entries_created_by_idx ON warehouse_consumption_entries(created_by);

-- Enable Row Level Security
ALTER TABLE warehouse_consumption_entries ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "All authenticated users can view warehouse consumption entries"
  ON warehouse_consumption_entries
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Administrators can insert warehouse consumption entries"
  ON warehouse_consumption_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    )
  );

CREATE POLICY "Administrators can update warehouse consumption entries"
  ON warehouse_consumption_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    )
  );

CREATE POLICY "Administrators can delete warehouse consumption entries"
  ON warehouse_consumption_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    )
  );

-- Create trigger for audit logging
CREATE TRIGGER audit_warehouse_consumption_entries_changes
  AFTER INSERT OR UPDATE OR DELETE ON warehouse_consumption_entries
  FOR EACH ROW EXECUTE FUNCTION audit_log_changes();

-- Create function to update item consumption history based on consumption entries
CREATE OR REPLACE FUNCTION update_warehouse_item_consumption_from_entries()
RETURNS TRIGGER AS $$
DECLARE
  v_year_month TEXT;
  v_item_id UUID;
  v_quantity INTEGER;
  v_current_history JSONB;
  v_updated_history JSONB;
  v_found BOOLEAN := false;
BEGIN
  -- Extract year and month from the date
  v_year_month := to_char(NEW.date, 'YYYY-MM');
  v_item_id := NEW.item_id;
  v_quantity := NEW.quantity;
  
  -- Get current consumption history
  SELECT consumption_history INTO v_current_history
  FROM warehouse_items
  WHERE id = v_item_id;
  
  -- Initialize if null
  IF v_current_history IS NULL THEN
    v_current_history := '[]'::jsonb;
  END IF;
  
  -- Check if entry for this month already exists
  v_updated_history := v_current_history;
  
  FOR i IN 0..jsonb_array_length(v_current_history) - 1 LOOP
    IF v_current_history->i->>'month' = v_year_month THEN
      -- Update existing entry
      v_updated_history := jsonb_set(
        v_updated_history,
        ARRAY[i::text, 'quantity'],
        to_jsonb(
          (v_current_history->i->>'quantity')::integer + v_quantity
        )
      );
      v_found := true;
      EXIT;
    END IF;
  END LOOP;
  
  -- If no entry for this month, add a new one
  IF NOT v_found THEN
    v_updated_history := v_updated_history || jsonb_build_object(
      'month', v_year_month,
      'quantity', v_quantity,
      'type', 'consumption'
    )::jsonb;
  END IF;
  
  -- Update the item's consumption history
  UPDATE warehouse_items
  SET 
    consumption_history = v_updated_history,
    last_consumption_update = NOW()
  WHERE id = v_item_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update consumption history when a new entry is added
CREATE TRIGGER update_warehouse_consumption_history_from_entries
  AFTER INSERT ON warehouse_consumption_entries
  FOR EACH ROW
  EXECUTE FUNCTION update_warehouse_item_consumption_from_entries();