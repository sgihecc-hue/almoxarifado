/*
  # Fix User Creation Process

  1. Changes
    - Create a function to properly create user profiles
    - Add trigger to ensure notification preferences are created for new users
    - Add RLS policies for user management

  2. Security
    - Function uses SECURITY DEFINER to ensure it runs with appropriate permissions
    - Ensure proper user creation flow
*/

-- Create a function to create user profiles
CREATE OR REPLACE FUNCTION create_user_profile(
  user_id UUID,
  user_email TEXT,
  user_full_name TEXT,
  user_role TEXT
) RETURNS VOID AS $$
BEGIN
  -- Check if user already exists in the users table
  IF EXISTS (SELECT 1 FROM users WHERE id = user_id) THEN
    -- Update existing user
    UPDATE users
    SET 
      email = user_email,
      full_name = user_full_name,
      role = user_role,
      updated_at = now()
    WHERE id = user_id;
  ELSE
    -- Insert new user
    INSERT INTO users (
      id,
      email,
      full_name,
      role,
      created_at,
      updated_at
    ) VALUES (
      user_id,
      user_email,
      user_full_name,
      user_role,
      now(),
      now()
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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