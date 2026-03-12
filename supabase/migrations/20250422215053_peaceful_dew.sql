/*
  # Fix User Creation Process

  1. Changes
    - Add trigger to automatically create user profiles when auth users are created
    - Add trigger to ensure notification preferences are created for new users
    - Add RLS policies for user management

  2. Security
    - Ensure proper user creation flow
*/

-- Create a trigger function to ensure user profiles are created when auth users are created
CREATE OR REPLACE FUNCTION handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
  v_full_name TEXT;
  v_role TEXT;
BEGIN
  -- Get metadata from the auth user
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', 'New User');
  v_role := COALESCE(NEW.raw_user_meta_data->>'role', 'solicitante');
  
  -- Insert into public.users table
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id, 
    NEW.email,
    v_full_name,
    v_role
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- If the user already exists, update it
    UPDATE public.users
    SET 
      email = NEW.email,
      full_name = v_full_name,
      role = v_role,
      updated_at = now()
    WHERE id = NEW.id;
    RETURN NEW;
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Error in handle_new_user: %', SQLERRM;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if the trigger already exists and create it if it doesn't
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user();
  END IF;
END
$$;

-- Ensure notification preferences are created for new users
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
END;
$$ LANGUAGE plpgsql;

-- Check if the trigger already exists and create it if it doesn't
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'ensure_user_notification_preferences'
  ) THEN
    CREATE TRIGGER ensure_user_notification_preferences
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION ensure_user_notification_preferences();
  END IF;
END
$$;

-- Add policy for user registration if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'users' 
    AND policyname = 'enable_insert_for_registration'
  ) THEN
    CREATE POLICY "enable_insert_for_registration"
      ON users
      FOR INSERT
      TO authenticated
      WITH CHECK (true);
  END IF;
END
$$;

-- Add policy for user profile updates if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'users' 
    AND policyname = 'enable_update_for_own_profile'
  ) THEN
    CREATE POLICY "enable_update_for_own_profile"
      ON users
      FOR UPDATE
      TO authenticated
      USING (
        (uid() = id) OR 
        (EXISTS (
          SELECT 1 FROM users
          WHERE users.id = uid()
          AND users.role = 'administrador'
        ))
      )
      WITH CHECK (
        CASE
          WHEN (uid() = id) THEN
            COALESCE((role = (
              SELECT users.role
              FROM users
              WHERE users.id = uid()
            )), true)
          ELSE
            (EXISTS (
              SELECT 1 FROM users
              WHERE users.id = uid()
              AND users.role = 'administrador'
            ))
        END
      );
  END IF;
END
$$;

-- Add policy for reading user profiles if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'users' 
    AND policyname = 'enable_read_access_for_authenticated_users'
  ) THEN
    CREATE POLICY "enable_read_access_for_authenticated_users"
      ON users
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END
$$;