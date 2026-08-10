-- =====================================================================
-- Farmácia — trava contra LOTE DUPLICADO em request_item_lots.
-- Causa raiz do bug "o mesmo lote foi gerado N vezes" na tela de Confirmar
-- Recebimento: onChange + onBlur disparavam saveLots concorrentes, cada um
-- faz delete+insert → corrida → linhas duplicadas. O frontend agora serializa
-- o salvamento; este índice é a trava extra no banco. Só afeta farmácia.
-- =====================================================================
create unique index if not exists ux_request_item_lots_item_lote
  on public.request_item_lots(request_item_id, expiry_tracking_id);
