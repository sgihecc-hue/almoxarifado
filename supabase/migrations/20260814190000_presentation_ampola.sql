-- Apresentação do medicamento: adiciona "Ampola" como opção (a farmácia
-- pediu ampola/comprimido). Expande o CHECK de pharmacy_items.presentation.
alter table public.pharmacy_items
  drop constraint if exists pharmacy_items_presentation_check;
alter table public.pharmacy_items
  add constraint pharmacy_items_presentation_check
  check (
    presentation is null
    or presentation = any (array[
      'comprimidos','injetaveis','ampola','solucoes_orais','topicos',
      'aerosol','xarope','supositorio','gotas','outros'
    ])
  );
