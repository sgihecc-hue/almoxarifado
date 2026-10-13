-- Cris (13/10/2026): relatorio de valor por Medicamento, Curativo, Inflamavel e
-- Higiene/Limpeza para a coordenacao. Inflamavel so existia como local de guarda
-- (item_stocks.shelf_location), nao como classe. Novas classes no cadastro.
alter table public.pharmacy_items
  drop constraint if exists pharmacy_items_medication_class_check;
alter table public.pharmacy_items
  add constraint pharmacy_items_medication_class_check
  check (
    medication_class is null
    or medication_class = any (array[
      'uso_geral','antimicrobianos','controlados','mav',
      'sgv','curativo','anticoagulante',
      'inflamavel','higiene_limpeza'
    ])
  );
