/*
  # Insert Sample Data for Hospital Management System

  1. Sample Data
    - Add default departments for hospital operations
    
  2. Notes
    - This migration is idempotent - it won't create duplicates
*/

-- Insert sample departments (using ON CONFLICT to avoid duplicates)
INSERT INTO public.departments (name, description) VALUES
  ('Emergência', 'Setor de atendimento de emergência'),
  ('UTI', 'Unidade de Terapia Intensiva'),
  ('Enfermaria', 'Enfermaria geral'),
  ('Centro Cirúrgico', 'Centro cirúrgico e procedimentos'),
  ('Pediatria', 'Atendimento pediátrico'),
  ('Maternidade', 'Atendimento obstétrico'),
  ('Administração', 'Setor administrativo')
ON CONFLICT (name) DO NOTHING;
