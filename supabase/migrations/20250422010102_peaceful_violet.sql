/*
  # Create User Profile Function

  1. New Functions
    - `create_user_profile` - Function to create or update user profiles

  2. Security
    - Function uses SECURITY DEFINER to ensure it runs with appropriate permissions
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