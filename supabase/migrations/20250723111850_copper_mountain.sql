/*
  # Corrigir Políticas RLS e Erro 403

  1. Políticas de Usuários
    - Permitir que administradores vejam todos os usuários
    - Permitir que administradores criem/editem usuários
    - Permitir que administradores vejam departamentos

  2. Políticas de Departamentos  
    - Permitir que todos os usuários autenticados vejam departamentos
    - Permitir que gestores e administradores gerenciem departamentos

  3. Correções de Segurança
    - Políticas mais permissivas para operações administrativas
    - Garantir acesso aos dados necessários
*/

-- Remover políticas existentes problemáticas
DROP POLICY IF EXISTS "allow_profile_read" ON users;
DROP POLICY IF EXISTS "allow_profile_update" ON users;
DROP POLICY IF EXISTS "authenticated_users_can_read_departments" ON departments;

-- Política para leitura de usuários (mais permissiva)
CREATE POLICY "users_select_policy" ON users
  FOR SELECT
  TO authenticated
  USING (true);

-- Política para atualização de usuários (administradores podem editar qualquer usuário)
CREATE POLICY "users_update_policy" ON users
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = id OR 
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('administrador', 'gestor')
    )
  )
  WITH CHECK (
    auth.uid() = id OR 
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('administrador', 'gestor')
    )
  );

-- Política para inserção de usuários (administradores podem criar usuários)
CREATE POLICY "users_insert_policy" ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('administrador', 'gestor')
    )
  );

-- Política para leitura de departamentos (todos os usuários autenticados)
CREATE POLICY "departments_select_policy" ON departments
  FOR SELECT
  TO authenticated
  USING (true);

-- Política para gerenciamento de departamentos (gestores e administradores)
CREATE POLICY "departments_manage_policy" ON departments
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('administrador', 'gestor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users 
      WHERE id = auth.uid() 
      AND role IN ('administrador', 'gestor')
    )
  );

-- Garantir que a tabela users tem RLS habilitado
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Garantir que a tabela departments tem RLS habilitado  
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Criar índices para performance se não existirem
CREATE INDEX IF NOT EXISTS idx_users_role_auth ON users (role, id);
CREATE INDEX IF NOT EXISTS idx_users_auth_role ON users (id, role);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments (id) WHERE manager_id IS NOT NULL;