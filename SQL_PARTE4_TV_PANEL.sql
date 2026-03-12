-- =============================================
-- PARTE 4: ALTERACOES PARA O PAINEL TV
-- Rode este DEPOIS das Partes 1-3
-- =============================================

-- 4A. TABELA DE FUNCIONARIOS (employees)
CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  matricula TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  department_id UUID REFERENCES departments(id),
  cargo TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employees_matricula ON employees(matricula);
CREATE INDEX IF NOT EXISTS idx_employees_department_id ON employees(department_id);

ALTER TABLE employees ENABLE ROW LEVEL SECURITY;

-- Leitura publica (TV sem auth usa anon)
CREATE POLICY "Allow anon read employees" ON employees FOR SELECT TO anon USING (true);
CREATE POLICY "Allow authenticated read employees" ON employees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage employees" ON employees FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')))
  WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- Trigger updated_at
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON employees FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4B. NOVAS COLUNAS EM request_items
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS supplied_quantity INTEGER;
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS observation TEXT;
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS is_checked BOOLEAN DEFAULT false;

-- 4C. NOVAS COLUNAS EM requests
ALTER TABLE requests ADD COLUMN IF NOT EXISTS received_by_employee_id UUID REFERENCES employees(id);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS received_by_employee_matricula TEXT;

-- 4D. POLITICAS RLS PARA ACESSO ANON (TV PANELS)

-- Requests: leitura anon
CREATE POLICY "Allow anon read requests" ON requests FOR SELECT TO anon USING (true);

-- Requests: update anon para delivery/completion
CREATE POLICY "Allow anon update request delivery" ON requests FOR UPDATE TO anon
  USING (status IN ('approved', 'processing', 'delivered'))
  WITH CHECK (status IN ('processing', 'delivered', 'completed'));

-- Request items: leitura anon
CREATE POLICY "Allow anon read request items" ON request_items FOR SELECT TO anon USING (true);

-- Request items: update anon (supplied_quantity, observation, is_checked)
CREATE POLICY "Allow anon update request items supplied" ON request_items FOR UPDATE TO anon USING (true);

-- Request status history: insert anon (para registrar mudancas de status do TV)
CREATE POLICY "Allow anon insert status history" ON request_status_history FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon read status history" ON request_status_history FOR SELECT TO anon USING (true);

-- Departments: leitura anon
CREATE POLICY "Allow anon read departments" ON departments FOR SELECT TO anon USING (true);

-- Pharmacy items: leitura anon (para pegar current_stock)
CREATE POLICY "Allow anon read pharmacy items" ON pharmacy_items FOR SELECT TO anon USING (true);

-- Warehouse items: leitura anon (para pegar current_stock)
CREATE POLICY "Allow anon read warehouse items" ON warehouse_items FOR SELECT TO anon USING (true);

-- Users: leitura anon (para pegar nome do solicitante)
CREATE POLICY "Allow anon read users" ON users FOR SELECT TO anon USING (true);

-- 4E. DADOS DE EXEMPLO (FUNCIONARIOS)
INSERT INTO employees (matricula, full_name, cargo) VALUES
  ('0001', 'Funcionario Exemplo 1', 'Tecnico de Enfermagem'),
  ('0002', 'Funcionario Exemplo 2', 'Enfermeiro(a)'),
  ('0003', 'Funcionario Exemplo 3', 'Auxiliar Administrativo');

SELECT 'PARTE 4 CONCLUIDA - Tabela employees criada, colunas adicionadas, RLS configurada!' as resultado;
