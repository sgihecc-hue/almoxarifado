/*
  # Fix users table RLS policies

  1. Changes
    - Add policy to allow new user profile creation
    - Update existing policies for better security

  2. Security
    - Enable RLS on users table
    - Add policies for profile creation and management
*/

-- Drop existing policies
DROP POLICY IF EXISTS "enable_insert_for_registration" ON users;
DROP POLICY IF EXISTS "enable_read_access_for_authenticated_users" ON users;
DROP POLICY IF EXISTS "enable_update_for_own_profile" ON users;

-- Create new policies
CREATE POLICY "allow_profile_creation"
ON users
FOR INSERT
TO authenticated
WITH CHECK (
  -- Allow users to create their own profile
  auth.uid() = id
  -- Or allow administrators to create profiles
  OR EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'administrador'
  )
);

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
  -- Users can update their own profile
  auth.uid() = id
  -- Or administrators can update any profile
  OR EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid()
    AND role = 'administrador'
  )
)
WITH CHECK (
  -- Users can't change their role
  CASE
    WHEN auth.uid() = id THEN
      COALESCE(role = (SELECT role FROM users WHERE id = auth.uid()), true)
    ELSE
      EXISTS (
        SELECT 1 FROM users
        WHERE id = auth.uid()
        AND role = 'administrador'
      )
  END
);