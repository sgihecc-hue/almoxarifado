/*
  # Adicionar Ateste de Recebimento

  1. Alterações na Tabela requests
    - `delivered_at` (timestamptz) - Data/hora da entrega/disponibilização
    - `delivered_by` (uuid) - ID do usuário que marcou como entregue
    - `received_at` (timestamptz) - Data/hora do ateste de recebimento
    - `received_by` (uuid) - ID do solicitante que confirmou recebimento
    - `delivery_notes` (text) - Observações sobre a entrega
    - `receipt_notes` (text) - Observações do solicitante ao receber

  2. Novo Status
    - Adicionar status 'delivered' (entregue, aguardando confirmação)

  3. Mudanças
    - Fluxo: pending → approved → processing → delivered → completed
    - Solicitante deve confirmar recebimento para status 'completed'
*/

-- Adicionar novas colunas na tabela requests
ALTER TABLE requests
ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES users(id),
ADD COLUMN IF NOT EXISTS received_at timestamptz,
ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES users(id),
ADD COLUMN IF NOT EXISTS delivery_notes text,
ADD COLUMN IF NOT EXISTS receipt_notes text;

-- Atualizar constraint de status para incluir 'delivered'
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'requests_status_check'
    AND table_name = 'requests'
  ) THEN
    ALTER TABLE requests DROP CONSTRAINT requests_status_check;
  END IF;

  -- Add new constraint with 'delivered' status
  ALTER TABLE requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'delivered', 'completed', 'cancelled'));
END $$;

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_requests_delivered_at ON requests(delivered_at);
CREATE INDEX IF NOT EXISTS idx_requests_received_at ON requests(received_at);

-- Adicionar comentários para documentação
COMMENT ON COLUMN requests.delivered_at IS 'Data/hora em que os itens foram entregues/disponibilizados';
COMMENT ON COLUMN requests.delivered_by IS 'Usuário (gestor) que marcou a solicitação como entregue';
COMMENT ON COLUMN requests.received_at IS 'Data/hora em que o solicitante confirmou o recebimento';
COMMENT ON COLUMN requests.received_by IS 'Usuário (solicitante) que confirmou o recebimento';
COMMENT ON COLUMN requests.delivery_notes IS 'Observações sobre a entrega feitas pelo gestor';
COMMENT ON COLUMN requests.receipt_notes IS 'Observações sobre o recebimento feitas pelo solicitante';
