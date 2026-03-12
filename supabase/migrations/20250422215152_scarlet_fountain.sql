/*
  # Fix User RLS Policies

  1. Changes
    - Add RLS policies for users table
    - Ensure proper access control for user management
    - Fix user creation and update policies

  2. Security
    - Enable RLS on users table
    - Add policies for insert, update, and select operations
*/

-- Enable RLS on users table if not already enabled
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "enable_insert_for_registration" ON users;
DROP POLICY IF EXISTS "enable_update_for_own_profile" ON users;
DROP POLICY IF EXISTS "enable_read_access_for_authenticated_users" ON users;

-- Create policies for user management
CREATE POLICY "enable_insert_for_registration"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "enable_update_for_own_profile"
  ON users
  FOR UPDATE
  TO authenticated
  USING (
    (auth.uid() = id) OR 
    (EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'administrador'
    ))
  )
  WITH CHECK (
    CASE
      WHEN (auth.uid() = id) THEN
        COALESCE((role = (
          SELECT users.role
          FROM users
          WHERE users.id = auth.uid()
        )), true)
      ELSE
        (EXISTS (
          SELECT 1 FROM users
          WHERE users.id = auth.uid()
          AND users.role = 'administrador'
        ))
    END
  );

CREATE POLICY "enable_read_access_for_authenticated_users"
  ON users
  FOR SELECT
  TO authenticated
  USING (true);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to update the updated_at timestamp
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'update_users_updated_at'
  ) THEN
    CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();
  END IF;
END
$$;

-- Create a function to audit user changes
CREATE OR REPLACE FUNCTION audit_log_changes()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO audit_logs (
      table_name,
      record_id,
      action,
      new_data,
      changed_by,
      created_at
    ) VALUES (
      TG_TABLE_NAME,
      NEW.id,
      'INSERT',
      to_jsonb(NEW),
      auth.uid(),
      now()
    );
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO audit_logs (
      table_name,
      record_id,
      action,
      old_data,
      new_data,
      changed_by,
      created_at
    ) VALUES (
      TG_TABLE_NAME,
      NEW.id,
      'UPDATE',
      to_jsonb(OLD),
      to_jsonb(NEW),
      auth.uid(),
      now()
    );
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO audit_logs (
      table_name,
      record_id,
      action,
      old_data,
      changed_by,
      created_at
    ) VALUES (
      TG_TABLE_NAME,
      OLD.id,
      'DELETE',
      to_jsonb(OLD),
      auth.uid(),
      now()
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger to audit user changes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'audit_users_changes'
  ) THEN
    CREATE TRIGGER audit_users_changes
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION audit_log_changes();
  END IF;
END
$$;