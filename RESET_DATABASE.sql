/*
  # RESET COMPLETO DO BANCO DE DADOS

  Execute este SQL no Supabase SQL Editor para:
  1. Remover todas as tabelas existentes
  2. Criar o schema completo do sistema
  3. Configurar RLS em todas as tabelas
  4. Inserir dados iniciais
*/

-- =============================================
-- PARTE 1: REMOVER TABELAS EXISTENTES
-- =============================================
DROP TABLE IF EXISTS template_items CASCADE;
DROP TABLE IF EXISTS templates CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS request_comments CASCADE;
DROP TABLE IF EXISTS request_status_history CASCADE;
DROP TABLE IF EXISTS request_items CASCADE;
DROP TABLE IF EXISTS requests CASCADE;
DROP TABLE IF EXISTS stock_entries CASCADE;
DROP TABLE IF EXISTS pharmacy_items CASCADE;
DROP TABLE IF EXISTS warehouse_items CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS departments CASCADE;

-- =============================================
-- PARTE 2: CRIAR TABELAS
-- =============================================

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
  location text,
  is_active boolean DEFAULT true,
  expiry_date date,
  invoice_number text,
  supplier_cnpj text,
  supplier_name text,
  afm_number text,
  invoice_total_value numeric(12,2),
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
  location text,
  is_active boolean DEFAULT true,
  expiry_date date,
  invoice_number text,
  supplier_cnpj text,
  supplier_name text,
  afm_number text,
  invoice_total_value numeric(12,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE stock_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('pharmacy', 'warehouse')),
  pharmacy_item_id uuid REFERENCES pharmacy_items(id) ON DELETE CASCADE,
  warehouse_item_id uuid REFERENCES warehouse_items(id) ON DELETE CASCADE,
  quantity integer NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  expiry_date date,
  invoice_number text,
  supplier_cnpj text,
  supplier_name text,
  afm_number text,
  invoice_total_value numeric(12,2),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT stock_entries_item_check CHECK (
    (item_type = 'pharmacy' AND pharmacy_item_id IS NOT NULL AND warehouse_item_id IS NULL) OR
    (item_type = 'warehouse' AND warehouse_item_id IS NOT NULL AND pharmacy_item_id IS NULL)
  )
);

CREATE TABLE requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('pharmacy', 'warehouse')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'in_progress', 'completed', 'cancelled')),
  priority text DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  requester_id uuid NOT NULL REFERENCES users(id),
  department text,
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
  received_at timestamptz,
  received_by uuid REFERENCES users(id),
  delivery_notes text,
  receipt_notes text,
  created_at timestamptz DEFAULT now(),
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
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'partially_approved')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE request_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  content text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  type text NOT NULL CHECK (type IN ('pharmacy', 'warehouse')),
  department text,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now(),
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
  created_at timestamptz DEFAULT now()
);

-- =============================================
-- PARTE 3: INDICES
-- =============================================
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_department_id ON users(department_id);
CREATE INDEX idx_pharmacy_items_category ON pharmacy_items(category);
CREATE INDEX idx_pharmacy_items_is_active ON pharmacy_items(is_active);
CREATE INDEX idx_warehouse_items_category ON warehouse_items(category);
CREATE INDEX idx_warehouse_items_is_active ON warehouse_items(is_active);
CREATE INDEX idx_stock_entries_item_type ON stock_entries(item_type);
CREATE INDEX idx_stock_entries_pharmacy_item ON stock_entries(pharmacy_item_id);
CREATE INDEX idx_stock_entries_warehouse_item ON stock_entries(warehouse_item_id);
CREATE INDEX idx_requests_status ON requests(status);
CREATE INDEX idx_requests_type ON requests(type);
CREATE INDEX idx_requests_requester ON requests(requester_id);
CREATE INDEX idx_requests_created_at ON requests(created_at);
CREATE INDEX idx_request_items_request ON request_items(request_id);
CREATE INDEX idx_request_status_history_request ON request_status_history(request_id);
CREATE INDEX idx_request_comments_request ON request_comments(request_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- =============================================
-- PARTE 4: RLS (Row Level Security)
-- =============================================

ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE warehouse_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE request_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE template_items ENABLE ROW LEVEL SECURITY;

-- Policies para departments
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

-- Policies para users
CREATE POLICY "Users can read own profile"
  ON users FOR SELECT TO authenticated USING (id = auth.uid());

CREATE POLICY "Admins can read all users"
  ON users FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor')));

CREATE POLICY "Users can insert own profile"
  ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "Admins can update any user"
  ON users FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- Policies para pharmacy_items
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

-- Policies para warehouse_items
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

-- Policies para stock_entries
CREATE POLICY "Authenticated users can read stock entries"
  ON stock_entries FOR SELECT TO authenticated USING (true);

CREATE POLICY "Pharmacists and warehouse managers can insert stock entries"
  ON stock_entries FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')));

CREATE POLICY "Pharmacists and warehouse managers can update stock entries"
  ON stock_entries FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')));

CREATE POLICY "Admins can delete stock entries"
  ON stock_entries FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- Policies para requests
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

-- Policies para request_items
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

-- Policies para request_status_history
CREATE POLICY "Users can read status history of own requests"
  ON request_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_status_history.request_id AND requests.requester_id = auth.uid()));

CREATE POLICY "Managers can read all status history"
  ON request_status_history FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));

CREATE POLICY "System can insert status history"
  ON request_status_history FOR INSERT TO authenticated WITH CHECK (true);

-- Policies para request_comments
CREATE POLICY "Users can read comments on own requests"
  ON request_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_comments.request_id AND requests.requester_id = auth.uid()));

CREATE POLICY "Managers can read all comments"
  ON request_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));

CREATE POLICY "Authenticated users can insert comments"
  ON request_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own comments"
  ON request_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own comments"
  ON request_comments FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Policies para audit_logs
CREATE POLICY "Admins can read audit logs"
  ON audit_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- Policies para templates
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

-- Policies para template_items
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
CREATE TRIGGER update_stock_entries_updated_at BEFORE UPDATE ON stock_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_requests_updated_at BEFORE UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_request_items_updated_at BEFORE UPDATE ON request_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_request_comments_updated_at BEFORE UPDATE ON request_comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

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

CREATE OR REPLACE FUNCTION log_request_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO request_status_history (request_id, status, changed_by)
    VALUES (NEW.id, NEW.status, auth.uid());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER log_status_change AFTER UPDATE ON requests FOR EACH ROW EXECUTE FUNCTION log_request_status_change();

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

INSERT INTO pharmacy_items (name, code, unit, category, min_stock, max_stock, current_stock) VALUES
  ('Paracetamol 500mg', 'MED001', 'CP', 'Analgesicos', 100, 1000, 500),
  ('Dipirona 500mg', 'MED002', 'CP', 'Analgesicos', 100, 1000, 450),
  ('Amoxicilina 500mg', 'MED003', 'CP', 'Antibioticos', 50, 500, 200),
  ('Omeprazol 20mg', 'MED004', 'CP', 'Gastricos', 50, 500, 300),
  ('Soro Fisiologico 500ml', 'MED005', 'FR', 'Solucoes', 200, 2000, 1000),
  ('Seringa 10ml', 'MED006', 'UN', 'Descartaveis', 500, 5000, 2500),
  ('Luva Procedimento M', 'MED007', 'CX', 'Descartaveis', 100, 500, 250),
  ('Gaze Esteril', 'MED008', 'PCT', 'Curativos', 200, 2000, 1000),
  ('Esparadrapo', 'MED009', 'RL', 'Curativos', 50, 500, 200),
  ('Alcool 70%', 'MED010', 'LT', 'Antissepticos', 100, 1000, 500);

INSERT INTO warehouse_items (name, code, unit, category, min_stock, max_stock, current_stock) VALUES
  ('Papel A4', 'ALM001', 'RS', 'Papelaria', 50, 500, 200),
  ('Caneta Azul', 'ALM002', 'UN', 'Papelaria', 100, 1000, 500),
  ('Toner Impressora', 'ALM003', 'UN', 'Informatica', 10, 50, 20),
  ('Detergente 500ml', 'ALM004', 'UN', 'Limpeza', 50, 500, 200),
  ('Agua Sanitaria 1L', 'ALM005', 'UN', 'Limpeza', 50, 500, 200),
  ('Papel Higienico', 'ALM006', 'FD', 'Higiene', 100, 1000, 500),
  ('Sabonete Liquido', 'ALM007', 'UN', 'Higiene', 50, 500, 200),
  ('Saco de Lixo 100L', 'ALM008', 'PCT', 'Limpeza', 100, 1000, 500),
  ('Lampada LED', 'ALM009', 'UN', 'Manutencao', 20, 200, 100),
  ('Pilha AA', 'ALM010', 'UN', 'Eletronicos', 50, 500, 200);
