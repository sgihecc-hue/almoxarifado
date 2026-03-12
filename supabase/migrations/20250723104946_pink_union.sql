/*
  # Add department_id to users table

  1. Changes
    - Add department_id column to users table as optional foreign key
    - Add foreign key constraint to departments table
    - Update existing RLS policies to work with new column
  
  2. Security
    - Maintain existing RLS policies
    - Department_id is optional to maintain backwards compatibility
*/

-- Add department_id column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id uuid;

-- Add foreign key constraint to departments table
ALTER TABLE users 
ADD CONSTRAINT IF NOT EXISTS users_department_id_fkey 
FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS users_department_id_idx ON users(department_id);