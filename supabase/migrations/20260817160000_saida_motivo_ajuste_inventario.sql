-- Motivo de saida "Ajuste de inventario": baixa da diferenca encontrada na
-- contagem fisica (o operador lanca a quantidade que faltou). Comporta-se como
-- 'quebra'/'vencimento' — saida simples, sem destino. Expande o CHECK de
-- stock_movements.reason, senao a tela quebra na hora de salvar.
alter table public.stock_movements
  drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements
  add constraint stock_movements_reason_check
  check (
    reason is null
    or reason = any (array[
      'emprestimo','devolucao_fornecedor','quebra','vencimento','outro',
      'obito_sem_reaproveitamento','defeito_fabricacao','embalagem_violada',
      'falha_fracionamento','doacao','permuta','consignado','troca_validade',
      'transferencia','ajuste_inventario'
    ])
  );
