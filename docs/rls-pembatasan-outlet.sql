-- Jalankan di Supabase SQL Editor SETELAH migrasi Multi-Outlet di docs/migrasi-database.md.
-- Policy RESTRICTIVE menggabungkan pembatasan outlet ini dengan policy akses toko
-- yang sudah ada (policy permissive tetap bertanggung jawab memberi akses toko).

-- Pemilik tetap melihat seluruh outlet toko; kasir hanya membaca outlet yang ditugaskan.
drop policy if exists "outlets_read_assigned_scope" on public.outlets;
create policy "outlets_read_assigned_scope" on public.outlets
  as restrictive for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.owner_id = outlets.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = outlets.id)
    )
  );

-- Kasir boleh membaca outlet yang ditugaskan, tetapi hanya pemilik yang dapat
-- membuat, mengubah, atau menghapus definisi outlet.
drop policy if exists "outlets_write_owner_only" on public.outlets;
create policy "outlets_write_owner_only" on public.outlets
  as restrictive for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "outlets_update_owner_only" on public.outlets;
create policy "outlets_update_owner_only" on public.outlets
  as restrictive for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists "outlets_delete_owner_only" on public.outlets;
create policy "outlets_delete_owner_only" on public.outlets
  as restrictive for delete to authenticated
  using (user_id = auth.uid());

-- Nota, pelanggan Paket Bulanan/Tempo, dan pengeluaran dibatasi ke outlet kasir.
drop policy if exists "transactions_outlet_scope" on public.transactions;
create policy "transactions_outlet_scope" on public.transactions
  as restrictive for all to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.owner_id = transactions.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = transactions.outlet_id)
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.owner_id = transactions.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = transactions.outlet_id)
    )
  );

drop policy if exists "subscriptions_outlet_scope" on public.subscriptions;
create policy "subscriptions_outlet_scope" on public.subscriptions
  as restrictive for all to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.owner_id = subscriptions.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = subscriptions.outlet_id)
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.owner_id = subscriptions.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = subscriptions.outlet_id)
    )
  );

drop policy if exists "expenses_outlet_scope" on public.expenses;
create policy "expenses_outlet_scope" on public.expenses
  as restrictive for all to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.owner_id = expenses.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = expenses.outlet_id)
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1 from public.team_members tm
      where tm.owner_id = expenses.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = expenses.outlet_id)
    )
  );

-- subscription_usage tidak menyimpan outlet_id; izinkan kasir hanya jika
-- baris induk subscriptions berada di outlet yang ditugaskan.
drop policy if exists "subscription_usage_outlet_scope" on public.subscription_usage;
create policy "subscription_usage_outlet_scope" on public.subscription_usage
  as restrictive for all to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.team_members tm
      join public.subscriptions s
        on s.user_id = tm.owner_id
       and s.id = subscription_usage.subscription_id
      where tm.owner_id = subscription_usage.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = s.outlet_id)
    )
  )
  with check (
    user_id = auth.uid()
    or exists (
      select 1
      from public.team_members tm
      join public.subscriptions s
        on s.user_id = tm.owner_id
       and s.id = subscription_usage.subscription_id
      where tm.owner_id = subscription_usage.user_id
        and tm.member_id = auth.uid()
        and tm.status = 'aktif'
        and (tm.outlet_id is null or tm.outlet_id = s.outlet_id)
    )
  );
