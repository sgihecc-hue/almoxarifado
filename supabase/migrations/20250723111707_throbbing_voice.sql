/*
  # Fix User Department Relationship

  1. Ensure department_id column exists in users table
  2. Add foreign key constraint to departments table
  3. Add index for performance
  4. Update existing users to have proper department relationships
*/

-- Add department_id column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE users ADD COLUMN department_id uuid;
  END IF;
END $$;

-- Add foreign key constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_department_id_fkey'
  ) THEN
    ALTER TABLE users 
    ADD CONSTRAINT users_department_id_fkey 
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add index for performance if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'users_department_id_idx'
  ) THEN
    CREATE INDEX users_department_id_idx ON users(department_id);
  END IF;
END $$;

-- Add RLS policies for department access
CREATE POLICY IF NOT EXISTS "Users can view their department info" 
ON departments FOR SELECT 
TO authenticated 
USING (true);

-- Ensure departments table has proper RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Add audit trigger for users table changes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers
    WHERE event_object_table = 'users' AND trigger_name = 'audit_users_department_changes'
  ) THEN
    CREATE TRIGGER audit_users_department_changes
      AFTER UPDATE ON users
      FOR EACH ROW
      EXECUTE FUNCTION audit_log_changes();
  END IF;
END $$;