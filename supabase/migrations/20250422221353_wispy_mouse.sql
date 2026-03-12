/*
  # Fix User Policies and Triggers

  1. Changes
    - Update RLS policies for users table
    - Ensure anon users can create profiles
    - Fix trigger function for user creation
    - Add policy for allowing profile creation during registration
  
  2. Security
    - Maintain proper access controls
    - Allow new user registration
*/

-- Enable RLS on users table if not already enabled
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Drop existing policies to avoid conflicts
DROP POLICY IF EXISTS "allow_profile_creation" ON users;
DROP POLICY IF EXISTS "allow_profile_read" ON users;
DROP POLICY IF EXISTS "allow_profile_update" ON users;

-- Create policies for user management
CREATE POLICY "allow_profile_creation"
  ON users
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "allow_profile_read"
  ON users
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "allow_profile_update"
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

-- Create or replace the trigger function to handle new users
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
    v_full_name,
    v_role,
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
      full_name = v_full_name,
      role = v_role,
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