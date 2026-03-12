/*
  ============================================================================
  SCRIPT CONSOLIDADO - EXECUTE TODO ESTE CONTEUDO NO SUPABASE SQL EDITOR
  ============================================================================

  URL: https://supabase.com/dashboard/project/ojcpmwjejituqvjappxy/sql/new

  Este script consolida TODAS as correcoes necessarias para o sistema funcionar.
  E seguro executar multiplas vezes (idempotente).

  ============================================================================
*/

-- ============================================================================
-- PARTE 1: COLUNAS PARA TABELAS DE ITENS
-- ============================================================================

-- 1.1 Adicionar is_active em pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'pharmacy_items' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.pharmacy_items ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

-- 1.2 Adicionar is_active em warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'warehouse_items' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.warehouse_items ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

-- 1.3 Atualizar itens existentes para is_active = true
UPDATE public.pharmacy_items SET is_active = true WHERE is_active IS NULL;
UPDATE public.warehouse_items SET is_active = true WHERE is_active IS NULL;

-- 1.4 Adicionar campos de fornecedor em pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_items' AND column_name = 'expiry_date') THEN
    ALTER TABLE pharmacy_items ADD COLUMN expiry_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_items' AND column_name = 'invoice_number') THEN
    ALTER TABLE pharmacy_items ADD COLUMN invoice_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_items' AND column_name = 'supplier_cnpj') THEN
    ALTER TABLE pharmacy_items ADD COLUMN supplier_cnpj text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_items' AND column_name = 'supplier_name') THEN
    ALTER TABLE pharmacy_items ADD COLUMN supplier_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_items' AND column_name = 'afm_number') THEN
    ALTER TABLE pharmacy_items ADD COLUMN afm_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_items' AND column_name = 'invoice_total_value') THEN
    ALTER TABLE pharmacy_items ADD COLUMN invoice_total_value numeric(10,2);
  END IF;
END $$;

-- 1.5 Adicionar campos de fornecedor em warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouse_items' AND column_name = 'expiry_date') THEN
    ALTER TABLE warehouse_items ADD COLUMN expiry_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouse_items' AND column_name = 'invoice_number') THEN
    ALTER TABLE warehouse_items ADD COLUMN invoice_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouse_items' AND column_name = 'supplier_cnpj') THEN
    ALTER TABLE warehouse_items ADD COLUMN supplier_cnpj text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouse_items' AND column_name = 'supplier_name') THEN
    ALTER TABLE warehouse_items ADD COLUMN supplier_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouse_items' AND column_name = 'afm_number') THEN
    ALTER TABLE warehouse_items ADD COLUMN afm_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouse_items' AND column_name = 'invoice_total_value') THEN
    ALTER TABLE warehouse_items ADD COLUMN invoice_total_value numeric(10,2);
  END IF;
END $$;

-- ============================================================================
-- PARTE 2: COLUNAS PARA TABELA REQUEST_ITEMS
-- ============================================================================

-- 2.1 Adicionar item_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_items' AND column_name = 'item_type'
  ) THEN
    ALTER TABLE public.request_items ADD COLUMN item_type text CHECK (item_type IN ('pharmacy', 'warehouse'));
  END IF;
END $$;

-- 2.2 Adicionar pharmacy_item_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_items' AND column_name = 'pharmacy_item_id'
  ) THEN
    ALTER TABLE public.request_items ADD COLUMN pharmacy_item_id uuid REFERENCES public.pharmacy_items(id);
  END IF;
END $$;

-- 2.3 Adicionar warehouse_item_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_items' AND column_name = 'warehouse_item_id'
  ) THEN
    ALTER TABLE public.request_items ADD COLUMN warehouse_item_id uuid REFERENCES public.warehouse_items(id);
  END IF;
END $$;

-- 2.4 Adicionar status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_items' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.request_items ADD COLUMN status text DEFAULT 'available' CHECK (status IN ('available', 'low_stock'));
  END IF;
END $$;

-- ============================================================================
-- PARTE 3: COLUNAS PARA TABELA REQUESTS
-- ============================================================================

-- 3.1 Atualizar constraint de status para incluir 'cancelled'
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'requests' AND constraint_name = 'requests_status_check'
  ) THEN
    ALTER TABLE public.requests DROP CONSTRAINT requests_status_check;
  END IF;

  ALTER TABLE public.requests
  ADD CONSTRAINT requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'delivered', 'cancelled'));
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Constraint already exists or error: %', SQLERRM;
END $$;

-- 3.2 Adicionar campos de rejeicao
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'rejected_at') THEN
    ALTER TABLE public.requests ADD COLUMN rejected_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'rejected_by') THEN
    ALTER TABLE public.requests ADD COLUMN rejected_by uuid REFERENCES public.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'rejection_reason') THEN
    ALTER TABLE public.requests ADD COLUMN rejection_reason text;
  END IF;
END $$;

-- 3.3 Adicionar campos de conclusao
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'completed_at') THEN
    ALTER TABLE public.requests ADD COLUMN completed_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'completed_by') THEN
    ALTER TABLE public.requests ADD COLUMN completed_by uuid REFERENCES public.users(id);
  END IF;
END $$;

-- 3.4 Adicionar campos de cancelamento
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'cancelled_at') THEN
    ALTER TABLE public.requests ADD COLUMN cancelled_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'cancelled_by') THEN
    ALTER TABLE public.requests ADD COLUMN cancelled_by uuid REFERENCES public.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'cancellation_reason') THEN
    ALTER TABLE public.requests ADD COLUMN cancellation_reason text;
  END IF;
END $$;

-- 3.5 Adicionar campos de entrega/recebimento
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'received_at') THEN
    ALTER TABLE public.requests ADD COLUMN received_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'received_by') THEN
    ALTER TABLE public.requests ADD COLUMN received_by uuid REFERENCES public.users(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'delivery_notes') THEN
    ALTER TABLE public.requests ADD COLUMN delivery_notes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'requests' AND column_name = 'receipt_notes') THEN
    ALTER TABLE public.requests ADD COLUMN receipt_notes text;
  END IF;
END $$;

-- ============================================================================
-- PARTE 4: TABELA REQUEST_COMMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.requests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id),
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- PARTE 5: COLUNA REASON EM REQUEST_STATUS_HISTORY
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'request_status_history' AND column_name = 'reason'
  ) THEN
    ALTER TABLE public.request_status_history ADD COLUMN reason text;
  END IF;
END $$;

-- ============================================================================
-- PARTE 6: INDICES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_pharmacy_items_is_active ON public.pharmacy_items(is_active);
CREATE INDEX IF NOT EXISTS idx_warehouse_items_is_active ON public.warehouse_items(is_active);
CREATE INDEX IF NOT EXISTS idx_request_items_item_type ON public.request_items(item_type);
CREATE INDEX IF NOT EXISTS idx_request_items_pharmacy_item_id ON public.request_items(pharmacy_item_id);
CREATE INDEX IF NOT EXISTS idx_request_items_warehouse_item_id ON public.request_items(warehouse_item_id);
CREATE INDEX IF NOT EXISTS idx_request_items_status ON public.request_items(status);
CREATE INDEX IF NOT EXISTS idx_request_comments_request_id ON public.request_comments(request_id);
CREATE INDEX IF NOT EXISTS idx_request_comments_user_id ON public.request_comments(user_id);

-- ============================================================================
-- PARTE 7: RLS PARA REQUEST_COMMENTS
-- ============================================================================

ALTER TABLE public.request_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view comments on their requests" ON public.request_comments;
DROP POLICY IF EXISTS "Users can create comments on their requests" ON public.request_comments;
DROP POLICY IF EXISTS "Users can update their own comments" ON public.request_comments;
DROP POLICY IF EXISTS "Users can delete their own comments" ON public.request_comments;

CREATE POLICY "Users can view comments on their requests"
  ON public.request_comments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.requests
      WHERE requests.id = request_comments.request_id
      AND (
        requests.requester_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
        )
      )
    )
  );

CREATE POLICY "Users can create comments on their requests"
  ON public.request_comments FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.requests
      WHERE requests.id = request_comments.request_id
      AND (
        requests.requester_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.users
          WHERE id = auth.uid() AND role IN ('gestor', 'administrador')
        )
      )
    )
  );

CREATE POLICY "Users can update their own comments"
  ON public.request_comments FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete their own comments"
  ON public.request_comments FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'administrador'
    )
  );

-- ============================================================================
-- VERIFICACAO FINAL
-- ============================================================================

SELECT 'SUCESSO! Todas as correcoes foram aplicadas. Recarregue a pagina (F5).' as resultado;
