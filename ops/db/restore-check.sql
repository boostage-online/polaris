-- Contrôles d'une base restaurée (restore-drill.sh) : exécutés sur la source et la cible, puis comparés.
-- Volumétrie des tables clés, dernières écritures, invariants financiers (ADR-0005).
select 'migrations', count(*), max(name) from schema_migrations;
select 'tenants', count(*) from tenants;
select 'users', count(*) from users;
select 'students', count(*) from students;
select 'guardians', count(*) from guardians;
select 'sessions', count(*) from sessions;
select 'attendance_records', count(*) from attendance_records;
select 'student_fees', count(*), coalesce(sum(total_amount), 0), coalesce(sum(amount_allocated), 0) from student_fees;
select 'payments', count(*), coalesce(sum(amount), 0) from payments;
select 'receipts', count(*), max(number) from receipts;
select 'payment_attempts', count(*) from payment_attempts;
select 'notifications', count(*) from notifications;
select 'audit_logs', count(*), max(occurred_at) from audit_logs;
select 'outbox_unpublished', count(*) from outbox_events where published_at is null;
-- Invariant : les allocations d'un paiement n'excèdent jamais son montant.
select 'invariant_allocations_le_amount',
       count(*) filter (where allocated > amount) as violations
from (select p.id, p.amount, coalesce(sum(a.amount), 0) as allocated
      from payments p left join payment_allocations a on a.payment_id = p.id group by p.id, p.amount) x;
-- Invariant : montant alloué d'une créance = somme de ses allocations.
select 'invariant_fee_allocated',
       count(*) filter (where f.amount_allocated <> coalesce(s.total, 0)) as violations
from student_fees f
left join (select i.student_fee_id, sum(a.amount) as total
           from payment_allocations a join installments i on i.id = a.installment_id group by i.student_fee_id) s
  on s.student_fee_id = f.id;
