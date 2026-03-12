-- =============================================
-- PARTE 2: INDICES + RLS POLICIES
-- Rode este DEPOIS da Parte 1
-- =============================================

-- INDICES
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

-- RLS: HABILITAR EM TODAS AS TABELAS
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

-- DEPARTMENTS
CREATE POLICY "Authenticated users can read departments" ON departments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can insert departments" ON departments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));
CREATE POLICY "Admins can update departments" ON departments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));
CREATE POLICY "Admins can delete departments" ON departments FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- USERS
CREATE POLICY "Users can read own profile" ON users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Admins can read all users" ON users FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor')));
CREATE POLICY "Users can insert own profile" ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Anon can insert profile on signup" ON users FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY "Admins can update any user" ON users FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- PHARMACY_ITEMS
CREATE POLICY "Authenticated users can read pharmacy items" ON pharmacy_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Pharmacists and admins can insert pharmacy items" ON pharmacy_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'gestor')));
CREATE POLICY "Pharmacists and admins can update pharmacy items" ON pharmacy_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'gestor'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'gestor')));
CREATE POLICY "Admins can delete pharmacy items" ON pharmacy_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- WAREHOUSE_ITEMS
CREATE POLICY "Authenticated users can read warehouse items" ON warehouse_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Warehouse managers and admins can insert warehouse items" ON warehouse_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'warehouse_manager', 'gestor')));
CREATE POLICY "Warehouse managers and admins can update warehouse items" ON warehouse_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'warehouse_manager', 'gestor'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'warehouse_manager', 'gestor')));
CREATE POLICY "Admins can delete warehouse items" ON warehouse_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- STOCK_ENTRIES
CREATE POLICY "Authenticated users can read stock entries" ON stock_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert stock entries" ON stock_entries FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')));
CREATE POLICY "Managers can update stock entries" ON stock_entries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'pharmacist', 'warehouse_manager', 'gestor')));
CREATE POLICY "Admins can delete stock entries" ON stock_entries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- EXPIRY_TRACKING
CREATE POLICY "All authenticated users can view expiry tracking" ON expiry_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert expiry tracking" ON expiry_tracking FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Managers can update expiry tracking" ON expiry_tracking FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor', 'pharmacist', 'warehouse_manager'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Admins can delete expiry tracking" ON expiry_tracking FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- REQUESTS
CREATE POLICY "Users can read own requests" ON requests FOR SELECT TO authenticated USING (requester_id = auth.uid());
CREATE POLICY "Managers can read all requests" ON requests FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Authenticated users can create requests" ON requests FOR INSERT TO authenticated WITH CHECK (requester_id = auth.uid());
CREATE POLICY "Managers can update requests" ON requests FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Users can update own pending requests" ON requests FOR UPDATE TO authenticated USING (requester_id = auth.uid() AND status = 'pending') WITH CHECK (requester_id = auth.uid());

-- REQUEST_ITEMS
CREATE POLICY "Users can read request items of own requests" ON request_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_items.request_id AND requests.requester_id = auth.uid()));
CREATE POLICY "Managers can read all request items" ON request_items FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "Users can insert request items for own requests" ON request_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_items.request_id AND requests.requester_id = auth.uid()));
CREATE POLICY "Managers can update request items" ON request_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));

-- REQUEST_STATUS_HISTORY
CREATE POLICY "Users can read status history of own requests" ON request_status_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_status_history.request_id AND requests.requester_id = auth.uid()));
CREATE POLICY "Managers can read all status history" ON request_status_history FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor', 'pharmacist', 'warehouse_manager')));
CREATE POLICY "System can insert status history" ON request_status_history FOR INSERT TO authenticated WITH CHECK (true);

-- REQUEST_COMMENTS
CREATE POLICY "Users can view comments on their requests" ON request_comments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM requests WHERE requests.id = request_comments.request_id AND (requests.requester_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('gestor', 'administrador')))));
CREATE POLICY "Users can create comments on their requests" ON request_comments FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM requests WHERE requests.id = request_comments.request_id AND (requests.requester_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('gestor', 'administrador')))));
CREATE POLICY "Users can update their own comments" ON request_comments FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete their own comments" ON request_comments FOR DELETE TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'administrador'));

-- CONSUMPTION_ENTRIES
CREATE POLICY "All authenticated users can view consumption entries" ON consumption_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Administrators can insert consumption entries" ON consumption_entries FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can update consumption entries" ON consumption_entries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can delete consumption entries" ON consumption_entries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'administrador'));

-- WAREHOUSE_CONSUMPTION_ENTRIES
CREATE POLICY "All authenticated users can view warehouse consumption entries" ON warehouse_consumption_entries FOR SELECT TO authenticated USING (true);
CREATE POLICY "Administrators can insert warehouse consumption entries" ON warehouse_consumption_entries FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can update warehouse consumption entries" ON warehouse_consumption_entries FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role IN ('administrador', 'gestor')));
CREATE POLICY "Administrators can delete warehouse consumption entries" ON warehouse_consumption_entries FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'administrador'));

-- AUDIT_LOGS
CREATE POLICY "Admins can read audit logs" ON audit_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));
CREATE POLICY "System can insert audit logs" ON audit_logs FOR INSERT TO authenticated WITH CHECK (true);

-- NOTIFICATION_PREFERENCES
CREATE POLICY "Users can manage own notification preferences" ON notification_preferences FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- TEMPLATES
CREATE POLICY "Authenticated users can read templates" ON templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert templates" ON templates FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Managers can update templates" ON templates FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Admins can delete templates" ON templates FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador')));

-- TEMPLATE_ITEMS
CREATE POLICY "Authenticated users can read template items" ON template_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "Managers can insert template items" ON template_items FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Managers can update template items" ON template_items FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor'))) WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));
CREATE POLICY "Managers can delete template items" ON template_items FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'administrador', 'manager', 'gestor')));

SELECT 'PARTE 2 CONCLUIDA - Indices e RLS configurados com sucesso!' as resultado;
