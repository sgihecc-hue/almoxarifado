-- =============================================
-- PARTE 3: FUNCOES, TRIGGERS E DADOS INICIAIS
-- Rode este DEPOIS da Parte 2
-- =============================================

-- Auto-update updated_at
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

-- Auto-generate request number
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

-- Log request status changes
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

-- Audit log changes
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

-- Handle new user from auth
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

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Ensure notification preferences on user creation
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

-- DADOS INICIAIS: DEPARTAMENTOS
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

SELECT 'PARTE 3 CONCLUIDA - Funcoes, triggers e dados iniciais criados!' as resultado;
SELECT 'BANCO DE DADOS 100% CONFIGURADO!' as resultado_final;
