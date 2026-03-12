/*
  ============================================================================
  SCRIPT COMPLETO DE SETUP DO BANCO - SGI-HECC
  ============================================================================

  Execute este SQL no Supabase SQL Editor do NOVO projeto.
  Cria todas as tabelas, indices, RLS, funcoes, triggers e dados iniciais.

  ============================================================================
*/

-- =============================================
-- PARTE 1: REMOVER TABELAS EXISTENTES (se houver)
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

-- =============================================
-- PARTE 2: CRIAR TABELAS
-- =============================================

-- 2.1 DEPARTMENTS
CREATE TABLE departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE NOT NULL,
  description text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2.2 USERS
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

-- 2.3 PHARMACY_ITEMS
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

-- 2.4 WAREHOUSE_ITEMS
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

-- 2.5 STOCK_ENTRIES
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

-- 2.6 EXPIRY_TRACKING
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

-- 2.7 REQUESTS
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

-- 2.8 REQUEST_ITEMS
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

-- 2.9 REQUEST_STATUS_HISTORY
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

-- 2.10 REQUEST_COMMENTS
CREATE TABLE request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  text text,
  content text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2.11 CONSUMPTION_ENTRIES
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

-- 2.12 WAREHOUSE_CONSUMPTION_ENTRIES
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

-- 2.13 AUDIT_LOGS
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

-- 2.14 NOTIFICATION_PREFERENCES
CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  channels json DEFAULT '{}'::json,
  types json DEFAULT '{}'::json,
  quiet_hours json,
  updated_at timestamptz DEFAULT now()
);

-- 2.15 TEMPLATES
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

-- 2.16 TEMPLATE_ITEMS
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

-- =============================================
-- PARTE 3: INDICES
-- =============================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_department_id ON users(department_id);

CREATE INDEX idx_pharmacy_items_category ON pharmacy_items(category);
CREATE INDEX idx_pharmacy_items_is_active ON pharmacy_items(is_active);
CREATE INDEX idx_pharmacy_items_code ON pharmacy_items(code);

CREATE INDEX idx_warehouse_items_category ON warehouse_items(category);
CREATE INDEX idx_warehouse_items_is_active ON warehouse_items(is_active);
CREATE INDEX idx_warehouse_items_code ON warehouse_items(code);

CREATE INDEX idx_stock_entries_item_id ON stock_entries(item_id);
CREATE INDEX idx_stock_entries_item_type ON stock_entries(item_type);
CREATE INDEX idx_stock_entries_created_at ON stock_entries(created_at DESC);
CREATE INDEX idx_stock_entries_invoice_number ON stock_entries(invoice_number);

CREATE INDEX idx_expiry_tracking_item_id ON expiry_tracking(item_id);
CREATE INDEX idx_expiry_tracking_expiry_date ON expiry_tracking(expiry_date);

CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_type ON requests(type);
CREATE INDEX idx_requests_requester ON requests(requester_id);
CREATE INDEX idx_requests_created_at ON requests(created_at);

CREATE INDEX idx_request_items_request ON request_items(request_id);
CREATE INDEX idx_request_items_item_type ON request_items(item_type);
CREATE INDEX idx_request_items_pharmacy_item_id ON request_items(pharmacy_item_id);
CREATE INDEX idx_request_items_warehouse_item_id ON request_items(warehouse_item_id);
CREATE INDEX idx_request_items_status ON request_items(status);

CREATE INDEX idx_request_status_history_request ON request_status_history(request_id);

CREATE INDEX idx_request_comments_request_id ON request_comments(request_id);
CREATE INDEX idx_request_comments_user_id ON request_comments(user_id);
CREATE INDEX idx_request_comments_created_at ON request_comments(created_at);

CREATE INDEX idx_consumption_entries_item ON consumption_entries(item_id);
CREATE INDEX idx_consumption_entries_department ON consumption_entries(department_id);
CREATE INDEX idx_consumption_entries_date ON consumption_entries(date);

CREATE INDEX idx_warehouse_consumption_entries_item ON warehouse_consumption_entries(item_id);
CREATE INDEX idx_warehouse_consumption_entries_department ON warehouse_consumption_entries(department_id);
CREATE INDEX idx_warehouse_consumption_entries_date ON warehouse_consumption_entries(date);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_table_record ON audit_logs(table_name, record_id);

-- =============================================
-- PARTE 4: ROW LEVEL SECURITY (RLS)
-- =============================================

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE expiry_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE consumption_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_consumption_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_items ENABLE ROW LEVEL SECURITY;

-- DEPARTMENTS policies
CREATE POLICY "Authenticated users can read departments"
  ON departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert departments"
  ON departments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));
CREATE POLICY "Admins can update departments"
  ON departments FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));
CREATE POLICY "Admins can delete departments"
  ON departments FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- USERS policies
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Admins can read all users"
  ON users FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor')));
CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Anon can insert profile on signup"
  ON users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Admins can update any user"
  ON users FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- PHARMACY_ITEMS policies
CREATE POLICY "Authenticated users can read pharmacy items"
  ON pharmacy_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pharmacists and admins can insert pharmacy items"
  ON pharmacy_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'gestor')));
CREATE POLICY "Pharmacists and admins can update pharmacy items"
  ON pharmacy_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'gestor')));
CREATE POLICY "Admins can delete pharmacy items"
  ON pharmacy_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- WAREHOUSE_ITEMS policies
CREATE POLICY "Authenticated users can read warehouse items"
  ON warehouse_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Warehouse managers and admins can insert warehouse items"
  ON warehouse_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'warehouse_manager', 'gestor')));
CREATE POLICY "Warehouse managers and admins can update warehouse items"
  ON warehouse_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'warehouse_manager', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'warehouse_manager', 'gestor')));
CREATE POLICY "Admins can delete warehouse items"
  ON warehouse_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- STOCK_ENTRIES policies
CREATE POLICY "Authenticated users can read stock entries"
  ON stock_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert stock entries"
  ON stock_entries FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')));
CREATE POLICY "Managers can update stock entries"
  ON stock_entries FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')));
CREATE POLICY "Admins can delete stock entries"
  ON stock_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- EXPIRY_TRACKING policies
CREATE POLICY "All authenticated users can view expiry tracking"
  ON expiry_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert expiry tracking"
  ON expiry_tracking FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Managers can update expiry tracking"
  ON expiry_tracking FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor', 'pharmacist', 'warehouse_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Admins can delete expiry tracking"
  ON expiry_tracking FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- REQUESTS policies
CREATE POLICY "Users can read own requests"
  ON requests FOR SELECT TO authenticated USING (requester_id = auth.uid());
CREATE POLICY "Managers can read all requests"
  ON requests FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Authenticated users can create requests"
  ON requests FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());
CREATE POLICY "Managers can update requests"
  ON requests FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Users can update own pending requests"
  ON requests FOR UPDATE TO authenticated
  USING (requester_id = auth.uid() AND status = 'pending')
  WITH CHECK (requester_id = auth.uid());

-- REQUEST_ITEMS policies
CREATE POLICY "Users can read request items of own requests"
  ON request_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_items.request_id AND requests.requester_id = auth.uid()));
CREATE POLICY "Managers can read all request items"
  ON request_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Users can insert request items for own requests"
  ON request_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_items.request_id AND requests.requester_id = auth.uid()));
CREATE POLICY "Managers can update request items"
  ON request_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));

-- REQUEST_STATUS_HISTORY policies
CREATE POLICY "Users can read status history of own requests"
  ON request_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_status_history.request_id AND requests.requester_id = auth.uid()));
CREATE POLICY "Managers can read all status history"
  ON request_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "System can insert status history"
  ON request_status_history FOR INSERT TO authenticated WITH CHECK (true);

-- REQUEST_COMMENTS policies
CREATE POLICY "Users can view comments on their requests"
  ON request_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_comments.request_id AND (requests.requester_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('gestor', 'administrador')))));
CREATE POLICY "Users can create comments on their requests"
  ON request_comments FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM requests WHERE requests.id = request_comments.request_id AND (requests.requester_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('gestor', 'administrador')))));
CREATE POLICY "Users can update their own comments"
  ON request_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete their own comments"
  ON request_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'administrador'));

-- CONSUMPTION_ENTRIES policies
CREATE POLICY "All authenticated users can view consumption entries"
  ON consumption_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Administrators can insert consumption entries"
  ON consumption_entries FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can update consumption entries"
  ON consumption_entries FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can delete consumption entries"
  ON consumption_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'administrador'));

-- WAREHOUSE_CONSUMPTION_ENTRIES policies
CREATE POLICY "All authenticated users can view warehouse consumption entries"
  ON warehouse_consumption_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Administrators can insert warehouse consumption entries"
  ON warehouse_consumption_entries FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can update warehouse consumption entries"
  ON warehouse_consumption_entries FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can delete warehouse consumption entries"
  ON warehouse_consumption_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'administrador'));

-- AUDIT_LOGS policies
CREATE POLICY "Admins can read audit logs"
  ON audit_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));
CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- NOTIFICATION_PREFERENCES policies
CREATE POLICY "Users can manage own notification preferences"
  ON notification_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- TEMPLATES policies
CREATE POLICY "Authenticated users can read templates"
  ON templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert templates"
  ON templates FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Managers can update templates"
  ON templates FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Admins can delete templates"
  ON templates FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- TEMPLATE_ITEMS policies
CREATE POLICY "Authenticated users can read template items"
  ON template_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert template items"
  ON template_items FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Managers can update template items"
  ON template_items FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Managers can delete template items"
  ON template_items FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));

-- =============================================
-- PARTE 5: FUNCOES E TRIGGERS
-- =============================================

-- 5.1 Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_pharmacy_items_updated_at BEFORE UPDATE ON pharmacy_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_warehouse_items_updated_at BEFORE UPDATE ON warehouse_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_requests_updated_at BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_request_items_updated_at BEFORE UPDATE ON request_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_request_comments_updated_at BEFORE UPDATE ON request_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5.2 Auto-generate request number
CREATE OR REPLACE FUNCTION generate_request_number()
RETURNS TRIGGER AS $$
DECLARE
  year_month text;
  seq_num integer;
BEGIN
  year_month := to_char(NOW(), 'YYYYMM');
  SELECT COALESCE(MAX(CAST(SUBSTRING(request_number FROM 8) AS INTEGER)), 0) + 1
  INTO seq_num
  FROM requests
  WHERE request_number LIKE 'REQ' || year_month || '%';
  NEW.request_number := 'REQ' || year_month || LPAD(seq_num::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_request_number BEFORE INSERT ON requests FOR EACH ROW EXECUTE FUNCTION generate_request_number();

-- 5.3 Log request status changes
CREATE OR REPLACE FUNCTION log_request_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO request_status_history (request_id, status, old_status, new_status, changed_by)
    VALUES (NEW.id, NEW.status, OLD.status, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER log_status_change AFTER UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION log_request_status_change();

-- 5.4 Audit log changes
CREATE OR REPLACE FUNCTION audit_log_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_logs (table_name, record_id, action, new_data, changed_by, created_at)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), auth.uid(), now());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data, new_data, changed_by, created_at)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), auth.uid(), now());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO audit_logs (table_name, record_id, action, old_data, changed_by, created_at)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), auth.uid(), now());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5.5 Handle new user from auth
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE(NEW.raw_user_meta_data->>'role', 'solicitante')
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, users.full_name),
    updated_at = now();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE LOG 'Error in handle_new_user: %', SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 5.6 Ensure notification preferences
CREATE OR REPLACE FUNCTION ensure_user_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO notification_preferences (user_id, channels, types, updated_at)
  VALUES (
    NEW.id,
    '{"email": true, "push": true, "sms": false, "in_app": true}'::json,
    '{"request_created": true, "request_updated": true, "request_approved": true, "request_rejected": true, "request_completed": true, "comment_added": true, "deadline_approaching": true, "low_stock": true, "system": true}'::json,
    now()
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER ensure_user_notification_preferences
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION ensure_user_notification_preferences();

-- =============================================
-- PARTE 6: DADOS INICIAIS
-- =============================================

INSERT INTO departments (name, code, description) VALUES
  ('Administracao', 'ADM', 'Setor administrativo'),
  ('Enfermagem', 'ENF', 'Setor de enfermagem'),
  ('Recepcao', 'REC', 'Setor de recepcao'),
  ('Laboratorio', 'LAB', 'Setor de laboratorio'),
  ('Radiologia', 'RAD', 'Setor de radiologia'),
  ('Farmacia', 'FAR', 'Setor de farmacia'),
  ('Almoxarifado', 'ALM', 'Setor de almoxarifado'),
  ('UTI', 'UTI', 'Unidade de Terapia Intensiva'),
  ('Centro Cirurgico', 'CC', 'Centro cirurgico'),
  ('Pronto Socorro', 'PS', 'Pronto socorro');

-- =============================================
-- VERIFICACAO FINAL
-- =============================================
SELECT 'SUCESSO! Banco de dados configurado com sucesso.' as resultado;
