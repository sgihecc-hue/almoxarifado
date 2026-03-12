/*
  # Initialize Database Schema for Hospital Management System

  1. New Tables
    - `users` - User profiles and authentication data
      - `id` (uuid, primary key, references auth.users)
      - `email` (text, unique, not null)
      - `full_name` (text, not null)
      - `role` (text, not null) - 'solicitante', 'gestor', or 'administrador'
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz, default now())
      
    - `departments` - Hospital departments
      - `id` (uuid, primary key)
      - `name` (text, unique, not null)
      - `description` (text)
      - `created_at` (timestamptz, default now())
      
    - `pharmacy_items` - Pharmacy inventory items
      - `id` (uuid, primary key)
      - `name` (text, not null)
      - `category` (text)
      - `unit` (text, not null)
      - `current_stock` (integer, default 0)
      - `minimum_stock` (integer, default 0)
      - `consumption_history` (jsonb)
      - `last_consumption_update` (timestamptz)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz)
      
    - `warehouse_items` - Warehouse inventory items
      - `id` (uuid, primary key)
      - `name` (text, not null)
      - `category` (text)
      - `unit` (text, not null)
      - `current_stock` (integer, default 0)
      - `minimum_stock` (integer, default 0)
      - `consumption_history` (jsonb)
      - `last_consumption_update` (timestamptz)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz)
      
    - `requests` - Supply requests
      - `id` (uuid, primary key)
      - `request_number` (text, unique)
      - `type` (text, not null) - 'pharmacy' or 'warehouse'
      - `requester_id` (uuid, references users)
      - `department_id` (uuid, references departments)
      - `status` (text, default 'pending')
      - `notes` (text)
      - `approved_by` (uuid, references users)
      - `approved_at` (timestamptz)
      - `delivered_by` (uuid, references users)
      - `delivered_at` (timestamptz)
      - `delivery_confirmed` (boolean, default false)
      - `delivery_confirmed_at` (timestamptz)
      - `created_at` (timestamptz, default now())
      - `updated_at` (timestamptz)
      
    - `request_items` - Items in requests
      - `id` (uuid, primary key)
      - `request_id` (uuid, references requests)
      - `item_id` (uuid) - references pharmacy_items or warehouse_items
      - `item_name` (text, not null)
      - `quantity` (integer, not null)
      - `approved_quantity` (integer)
      - `unit` (text, not null)
      - `created_at` (timestamptz, default now())
      
    - `request_status_history` - Status change history for requests
      - `id` (uuid, primary key)
      - `request_id` (uuid, references requests)
      - `old_status` (text)
      - `new_status` (text, not null)
      - `changed_by` (uuid, references users)
      - `changed_at` (timestamptz, default now())
      - `notes` (text)
      
    - `consumption_entries` - Pharmacy consumption tracking
      - `id` (uuid, primary key)
      - `item_id` (uuid, references pharmacy_items)
      - `department_id` (uuid, references departments)
      - `date` (date, not null)
      - `quantity` (integer, not null)
      - `notes` (text)
      - `created_by` (uuid, references users)
      - `created_at` (timestamptz, default now())
      
    - `warehouse_consumption_entries` - Warehouse consumption tracking
      - `id` (uuid, primary key)
      - `item_id` (uuid, references warehouse_items)
      - `department_id` (uuid, references departments)
      - `date` (date, not null)
      - `quantity` (integer, not null)
      - `notes` (text)
      - `created_by` (uuid, references users)
      - `created_at` (timestamptz, default now())
      
    - `notification_preferences` - User notification settings
      - `user_id` (uuid, primary key, references users)
      - `channels` (json, default {})
      - `types` (json, default {})
      - `quiet_hours` (json)
      - `updated_at` (timestamptz, default now())
      
    - `audit_logs` - Audit trail for all changes
      - `id` (uuid, primary key)
      - `table_name` (text, not null)
      - `record_id` (uuid, not null)
      - `action` (text, not null)
      - `old_data` (jsonb)
      - `new_data` (jsonb)
      - `changed_by` (uuid, references auth.users)
      - `created_at` (timestamptz, default now())
  
  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users
    - Implement role-based access control
*/

-- Create users table
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('solicitante', 'gestor', 'administrador')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create departments table
CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create pharmacy_items table
CREATE TABLE IF NOT EXISTS public.pharmacy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  unit text NOT NULL,
  current_stock integer NOT NULL DEFAULT 0,
  minimum_stock integer NOT NULL DEFAULT 0,
  consumption_history jsonb DEFAULT '[]'::jsonb,
  last_consumption_update timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Create warehouse_items table
CREATE TABLE IF NOT EXISTS public.warehouse_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text,
  unit text NOT NULL,
  current_stock integer NOT NULL DEFAULT 0,
  minimum_stock integer NOT NULL DEFAULT 0,
  consumption_history jsonb DEFAULT '[]'::jsonb,
  last_consumption_update timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Create requests table
CREATE TABLE IF NOT EXISTS public.requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE NOT NULL,
  type text NOT NULL CHECK (type IN ('pharmacy', 'warehouse')),
  requester_id uuid NOT NULL REFERENCES public.users(id),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'delivered')),
  notes text,
  approved_by uuid REFERENCES public.users(id),
  approved_at timestamptz,
  delivered_by uuid REFERENCES public.users(id),
  delivered_at timestamptz,
  delivery_confirmed boolean DEFAULT false,
  delivery_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

-- Create request_items table
CREATE TABLE IF NOT EXISTS public.request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  approved_quantity integer,
  unit text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create request_status_history table
CREATE TABLE IF NOT EXISTS public.request_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  old_status text,
  new_status text NOT NULL,
  changed_by uuid REFERENCES public.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- Create consumption_entries table
CREATE TABLE IF NOT EXISTS public.consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.pharmacy_items(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  date date NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create warehouse_consumption_entries table
CREATE TABLE IF NOT EXISTS public.warehouse_consumption_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.warehouse_items(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  date date NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  notes text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create notification_preferences table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  channels json DEFAULT '{}'::json,
  types json DEFAULT '{}'::json,
  quiet_hours json,
  updated_at timestamptz DEFAULT now()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  changed_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users(role);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_name ON public.pharmacy_items(name);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_name ON public.warehouse_items(name);
CREATE INDEX IF NOT EXISTS idx_requests_requester ON public.requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_type ON public.requests(type);
CREATE INDEX IF NOT EXISTS idx_request_items_request ON public.request_items(request_id);
CREATE INDEX IF NOT EXISTS idx_request_status_history_request ON public.request_status_history(request_id);
CREATE INDEX IF NOT EXISTS idx_consumption_entries_item ON public.consumption_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_consumption_entries_department ON public.consumption_entries(department_id);
CREATE INDEX IF NOT EXISTS idx_consumption_entries_date ON public.consumption_entries(date);
CREATE INDEX IF NOT EXISTS idx_warehouse_consumption_entries_item ON public.warehouse_consumption_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_consumption_entries_department ON public.warehouse_consumption_entries(department_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_consumption_entries_date ON public.warehouse_consumption_entries(date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON public.audit_logs(table_name, record_id);

-- Enable Row Level Security on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_consumption_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users table
CREATE POLICY "Users can view all user profiles"
  ON public.users FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can insert during registration"
  ON public.users FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ))
  WITH CHECK (auth.uid() = id OR EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

-- RLS Policies for departments table
CREATE POLICY "All authenticated users can view departments"
  ON public.departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only administrators can insert departments"
  ON public.departments FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

CREATE POLICY "Only administrators can update departments"
  ON public.departments FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

CREATE POLICY "Only administrators can delete departments"
  ON public.departments FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

-- RLS Policies for pharmacy_items table
CREATE POLICY "All authenticated users can view pharmacy items"
  ON public.pharmacy_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers and admins can insert pharmacy items"
  ON public.pharmacy_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

CREATE POLICY "Managers and admins can update pharmacy items"
  ON public.pharmacy_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

CREATE POLICY "Only administrators can delete pharmacy items"
  ON public.pharmacy_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

-- RLS Policies for warehouse_items table
CREATE POLICY "All authenticated users can view warehouse items"
  ON public.warehouse_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Managers and admins can insert warehouse items"
  ON public.warehouse_items FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

CREATE POLICY "Managers and admins can update warehouse items"
  ON public.warehouse_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

CREATE POLICY "Only administrators can delete warehouse items"
  ON public.warehouse_items FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

-- RLS Policies for requests table
CREATE POLICY "Users can view their own requests and managers can view all"
  ON public.requests FOR SELECT
  TO authenticated
  USING (
    requester_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
    )
  );

CREATE POLICY "All authenticated users can create requests"
  ON public.requests FOR INSERT
  TO authenticated
  WITH CHECK (requester_id = auth.uid());

CREATE POLICY "Managers and admins can update requests"
  ON public.requests FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

-- RLS Policies for request_items table
CREATE POLICY "Users can view items from their requests"
  ON public.request_items FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.requests
      WHERE requests.id = request_items.request_id
      AND (requests.requester_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
      ))
    )
  );

CREATE POLICY "Users can insert items in their own requests"
  ON public.request_items FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.requests
      WHERE requests.id = request_items.request_id
      AND requests.requester_id = auth.uid()
    )
  );

CREATE POLICY "Managers can update request items"
  ON public.request_items FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

-- RLS Policies for request_status_history table
CREATE POLICY "Users can view status history of their requests"
  ON public.request_status_history FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.requests
      WHERE requests.id = request_status_history.request_id
      AND (requests.requester_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
      ))
    )
  );

CREATE POLICY "Managers can insert status history"
  ON public.request_status_history FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

-- RLS Policies for consumption_entries table
CREATE POLICY "Managers and admins can view consumption entries"
  ON public.consumption_entries FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

CREATE POLICY "Administrators can insert consumption entries"
  ON public.consumption_entries FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

CREATE POLICY "Administrators can update consumption entries"
  ON public.consumption_entries FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

CREATE POLICY "Administrators can delete consumption entries"
  ON public.consumption_entries FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

-- RLS Policies for warehouse_consumption_entries table
CREATE POLICY "Managers and admins can view warehouse consumption entries"
  ON public.warehouse_consumption_entries FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
  ));

CREATE POLICY "Administrators can insert warehouse consumption entries"
  ON public.warehouse_consumption_entries FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

CREATE POLICY "Administrators can update warehouse consumption entries"
  ON public.warehouse_consumption_entries FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

CREATE POLICY "Administrators can delete warehouse consumption entries"
  ON public.warehouse_consumption_entries FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));

-- RLS Policies for notification_preferences table
CREATE POLICY "Users can view and update their own notification preferences"
  ON public.notification_preferences FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for audit_logs table
CREATE POLICY "Only administrators can view audit logs"
  ON public.audit_logs FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'administrador'
  ));
