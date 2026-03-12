/*
  # Add department_id column to users table

  1. Changes
    - Add `department_id` column to users table as a foreign key to departments
    - Add index for better query performance
    
  2. Security
    - Maintain existing RLS policies
*/

-- Add department_id column to users table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'users'
    AND column_name = 'department_id'
  ) THEN
    ALTER TABLE public.users
    ADD COLUMN department_id uuid REFERENCES public.departments(id);
  END IF;
END $$;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_users_department_id ON public.users(department_id);
