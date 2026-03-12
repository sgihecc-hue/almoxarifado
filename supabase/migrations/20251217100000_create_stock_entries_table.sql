/*
  # Create Stock Entries Table

  This migration creates a dedicated table to track all stock entries (additions)
  with detailed invoice and supplier information.

  1. New Tables
    - `stock_entries` - Records all stock additions with invoice details
      - `id` (uuid, primary key)
      - `item_id` (uuid, references pharmacy_items or warehouse_items)
      - `item_type` (text, 'pharmacy' or 'warehouse')
      - `quantity` (integer, quantity added)
      - `invoice_number` (text, invoice number)
      - `invoice_date` (date, invoice emission date)
      - `invoice_total_value` (numeric, total invoice value)
      - `expiry_date` (date, product expiry date)
      - `afm_number` (text, AFM number)
      - `supplier_cnpj` (text, supplier CNPJ)
      - `supplier_name` (text, supplier name)
      - `unit_price` (numeric, unit price)
      - `batch_number` (text, batch/lot number)
      - `delivery_date` (date, delivery date)
      - `notes` (text, additional notes)
      - `created_by` (uuid, references users)
      - `created_at` (timestamptz, default now())

  2. Security
    - Enable RLS on stock_entries table
    - Add policies for authenticated users based on role
*/

-- Create stock_entries table
CREATE TABLE IF NOT EXISTS public.stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('pharmacy', 'warehouse')),
  quantity integer NOT NULL CHECK (quantity > 0),
  invoice_number text NOT NULL,
  invoice_date date NOT NULL,
  invoice_total_value numeric(12,2),
  expiry_date date,
  afm_number text NOT NULL,
  supplier_cnpj text NOT NULL,
  supplier_name text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  batch_number text,
  delivery_date date,
  notes text,
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_stock_entries_item_id ON public.stock_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_entries_item_type ON public.stock_entries(item_type);
CREATE INDEX IF NOT EXISTS idx_stock_entries_created_at ON public.stock_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_entries_invoice_number ON public.stock_entries(invoice_number);

-- Enable RLS
ALTER TABLE public.stock_entries ENABLE ROW LEVEL SECURITY;

-- Policy: Gestores and Administradores can view all stock entries
CREATE POLICY "Gestores and admins can view stock entries"
  ON public.stock_entries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('gestor', 'administrador')
    )
  );

-- Policy: Gestores and Administradores can insert stock entries
CREATE POLICY "Gestores and admins can insert stock entries"
  ON public.stock_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role IN ('gestor', 'administrador')
    )
  );

-- Policy: Only Administradores can update stock entries
CREATE POLICY "Admins can update stock entries"
  ON public.stock_entries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    )
  );

-- Policy: Only Administradores can delete stock entries
CREATE POLICY "Admins can delete stock entries"
  ON public.stock_entries
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    )
  );

-- Create trigger for audit logging
DROP TRIGGER IF EXISTS audit_stock_entries_changes ON public.stock_entries;
CREATE TRIGGER audit_stock_entries_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_entries
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_changes();
