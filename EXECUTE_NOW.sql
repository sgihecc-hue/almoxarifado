-- EXECUTE ESTE SQL NO SUPABASE DASHBOARD > SQL EDITOR
-- URL: https://supabase.com/dashboard/project/ojcpmwjejituqvjappxy/sql/new

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouse_items' AND column_name = 'is_active') THEN
    ALTER TABLE public.warehouse_items ADD COLUMN is_active boolean DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_items' AND column_name = 'is_active') THEN
    ALTER TABLE public.pharmacy_items ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

UPDATE public.warehouse_items SET is_active = true WHERE is_active IS NULL;
UPDATE public.pharmacy_items SET is_active = true WHERE is_active IS NULL;

CREATE INDEX IF NOT EXISTS idx_warehouse_items_is_active ON public.warehouse_items(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_pharmacy_items_is_active ON public.pharmacy_items(is_active) WHERE is_active = true;

UPDATE public.warehouse_items SET is_active = false WHERE code = '65.02.19.00099934-2' AND is_active = true;

SELECT 'SUCESSO! Recarregue a pagina do app (F5)' as resultado;
