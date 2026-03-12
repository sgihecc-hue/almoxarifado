-- =============================================
-- PARTE 1: REMOVER + CRIAR TABELAS
-- Rode este primeiro no SQL Editor do Supabase
-- =============================================

DROP TABLE IF EXISTS template_items CASCADE;
DROP TABLE IF EXISTS templates CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS request_comments CASCADE;
DROP TABLE IF EXISTS request_status_history CASCADE;
DROP TABLE IF EXISTS request_items CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS stock_entries CASCADE;
DROP TABLE IF EXISTS expiry_tracking CASCADE;
DROP TABLE IF EXISTS consumption_entries CASCADE;
DROP TABLE IF EXISTS warehouse_consumption_entries CASCADE;
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS pharmacy_items CASCADE;
DROP TABLE IF EXISTS warehouse_items CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL DEFAULT 'solicitante' CHECK (role IN ('admin', 'manager', 'pharmacist', 'warehouse_manager', 'user', 'solicitante', 'gestor', 'administrador')),
  department text,
  department_id uuid REFERENCES departments(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE pharmacy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  description text,
  unit text NOT NULL DEFAULT 'UN',
  category text,
  min_stock integer DEFAULT 0,
  max_stock integer DEFAULT 100,
  current_stock integer DEFAULT 0,
  price numeric(10,2),
  location text,
  is_active boolean DEFAULT true,
  expiry_date date,
  invoice_number text,
  supplier_cnpj text,
  supplier_name text,
  afm_number text,
  invoice_total_value numeric(12,2),
  consumption_history jsonb DEFAULT '[]'::jsonb,
  last_consumption_update timestamptz,
  reorder_status text DEFAULT 'normal',
  last_reorder_date timestamptz,
  lead_time_days integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE warehouse_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text,
  description text,
  unit text NOT NULL DEFAULT 'UN',
  category text,
  min_stock integer DEFAULT 0,
  max_stock integer DEFAULT 100,
  current_stock integer DEFAULT 0,
  price numeric(10,2),
  location text,
  is_active boolean DEFAULT true,
  expiry_date date,
  invoice_number text,
  supplier_cnpj text,
  supplier_name text,
  afm_number text,
  invoice_total_value numeric(12,2),
  consumption_history jsonb DEFAULT '[]'::jsonb,
  last_consumption_update timestamptz,
  reorder_status text DEFAULT 'normal',
  last_reorder_date timestamptz,
  lead_time_days integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE stock_entries (
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
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expiry_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  batch_number text NOT NULL,
  expiry_date date,
  initial_quantity integer NOT NULL DEFAULT 0,
  current_quantity integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  invoice_number text,
  invoice_date date,
  delivery_date date,
  afm_number text,
  supplier_cnpj text,
  supplier_name text,
  invoice_total_value numeric(12,2)
);

CREATE TABLE requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('pharmacy', 'warehouse')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'delivered', 'cancelled')),
  priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'normal', 'urgent')),
  requester_id uuid NOT NULL REFERENCES users(id),
  department text,
  department_id uuid REFERENCES departments(id),
  justification text,
  notes text,
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  rejected_at timestamptz,
  rejected_by uuid REFERENCES users(id),
  rejection_reason text,
  completed_at timestamptz,
  completed_by uuid REFERENCES users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES users(id),
  cancellation_reason text,
  delivered_by uuid REFERENCES users(id),
  delivered_at timestamptz,
  delivery_notes text,
  received_at timestamptz,
  received_by uuid REFERENCES users(id),
  receipt_notes text,
  delivery_confirmed boolean DEFAULT false,
  delivery_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('pharmacy', 'warehouse')),
  pharmacy_item_id uuid REFERENCES pharmacy_items(id),
  warehouse_item_id uuid REFERENCES warehouse_items(id),
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  approved_quantity integer,
  delivered_quantity integer DEFAULT 0,
  unit text DEFAULT 'UN',
  notes text,
  status text DEFAULT 'pending' CHECK (status IN ('available', 'low_stock', 'pending', 'approved', 'rejected', 'partially_approved')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE request_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status text NOT NULL,
  old_status text,
  new_status text,
  reason text,
  changed_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  text text,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  date date NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE warehouse_consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES warehouse_items(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity > 0),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text,
  record_id uuid,
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  changed_by uuid REFERENCES users(id),
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  channels json DEFAULT '{}'::json,
  types json DEFAULT '{}'::json,
  quiet_hours json,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL CHECK (type IN ('pharmacy', 'warehouse')),
  department text,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('pharmacy', 'warehouse')),
  pharmacy_item_id uuid REFERENCES pharmacy_items(id),
  warehouse_item_id uuid REFERENCES warehouse_items(id),
  item_name text NOT NULL,
  default_quantity integer DEFAULT 1,
  unit text DEFAULT 'UN',
  created_at timestamptz NOT NULL DEFAULT now()
);

SELECT 'PARTE 1 CONCLUIDA - 16 tabelas criadas com sucesso!' as resultado;
