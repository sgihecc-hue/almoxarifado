/*
  # Adicionar status de ativo/inativo e remover itens específicos

  1. Alterações
    - Adiciona coluna `is_active` (boolean) nas tabelas `warehouse_items` e `pharmacy_items`
    - Remove itens específicos do almoxarifado: Caneta esferográfica, detergente e teste

  2. Detalhes
    - Coluna `is_active` com valor padrão `true`
    - Itens inativos (is_active = false) não aparecem nas listagens
    - Remoção de itens por nome (case insensitive)
*/

-- Adicionar coluna is_active na tabela warehouse_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'warehouse_items' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.warehouse_items ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

-- Adicionar coluna is_active na tabela pharmacy_items
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'pharmacy_items' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.pharmacy_items ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

-- Remover itens específicos do Almoxarifado
DELETE FROM public.warehouse_items
WHERE LOWER(name) LIKE '%caneta%esferog%'
   OR LOWER(name) LIKE '%detergente%'
   OR LOWER(name) = 'teste';

-- Criar índice para melhorar performance de queries com is_active
CREATE INDEX IF NOT EXISTS idx_warehouse_items_is_active ON public.warehouse_items(is_active);
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_is_active ON public.pharmacy_items(is_active);
