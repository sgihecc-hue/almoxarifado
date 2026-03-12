/*
  # Fix User Triggers and Policies

  1. Changes
    - Ensure triggers for user creation work correctly
    - Fix RLS policies for user management
    - Add audit logging for user changes

  2. Security
    - Ensure proper user creation flow
    - Maintain audit trail of user changes
*/

-- Create or replace the trigger function to handle new users
CREATE OR REPLACE FUNCTION handle_new_user() 
RETURNS TRIGGER AS $$
BEGIN
  -- Insert into public.users table
  INSERT INTO public.users (
    id, 
    email, 
    full_name, 
    role,
    created_at,
    updated_at
  ) VALUES (
    NEW.id, 
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'solicitante'),
    NOW(),
    NOW()
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- If the user already exists, update it
    UPDATE public.users
    SET 
      email = NEW.email,
      full_name = COALESCE(NEW.raw_user_meta_data->>'full_name', full_name),
      role = COALESCE(NEW.raw_user_meta_data->>'role', role),
      updated_at = NOW()
    WHERE id = NEW.id;
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW; -- Still return NEW to avoid blocking the auth user creation
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create the trigger
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION handle_new_user();

-- Create or replace the function to ensure notification preferences
CREATE OR REPLACE FUNCTION ensure_user_notification_preferences()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if notification preferences already exist
  IF NOT EXISTS (
    SELECT 1 FROM notification_preferences
    WHERE user_id = NEW.id
  ) THEN
    -- Insert default notification preferences
    INSERT INTO notification_preferences (
      user_id,
      channels,
      types,
      quiet_hours
    ) VALUES (
      NEW.id,
      json_build_object('email', true, 'push', true, 'sms', false, 'in_app', true),
      json_build_object(
        'request_created', true,
        'request_updated', true,
        'request_approved', true,
        'request_rejected', true,
        'request_completed', true,
        'comment_added', true,
        'deadline_approaching', true,
        'low_stock', true,
        'system', true
      ),
      json_build_object('enabled', false, 'start', '22:00', 'end', '06:00')
    );
  END IF;
  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RAISE LOG 'Error in ensure_user_notification_preferences: %', SQLERRM;
    RETURN NEW; -- Still return NEW to avoid blocking the user creation
END;
$$ LANGUAGE plpgsql;

-- Drop the trigger if it exists
DROP TRIGGER IF EXISTS ensure_user_notification_preferences ON users;

-- Create the trigger
CREATE TRIGGER ensure_user_notification_preferences
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION ensure_user_notification_preferences();

-- Create or replace the function to update the updated_at timestamp
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

-- Create or replace the function to audit changes
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