-- SYS5: o cadastro de item da farmácia oferece as classes "Curativo",
-- "Soluções de Grande Volume (SGV)" e "Anticoagulante", mas o CHECK só aceitava
-- uso_geral/antimicrobianos/controlados/mav — então salvar um curativo ou SGV
-- dava "valor inválido para o campo". Expandimos o CHECK para cobrir todas as
-- classes que a UI já usa (ver src/lib/services/items.ts).
alter table public.pharmacy_items
  drop constraint if exists pharmacy_items_medication_class_check;
alter table public.pharmacy_items
  add constraint pharmacy_items_medication_class_check
  check (
    medication_class is null
    or medication_class = any (array[
      'uso_geral','antimicrobianos','controlados','mav',
      'sgv','curativo','anticoagulante'
    ])
  );
