-- Lindungi RPC SECURITY DEFINER yang tidak boleh dipanggil secara publik.
-- Fungsi pendaftaran yang memang dipakai sebelum login (check_registration_code
-- dan get_registration_code_referrer) tetap dapat dipanggil anon.

-- Bonus referral hanya boleh diklaim oleh webhook service_role atau admin platform.
create or replace function public.apply_referral_bonus_if_pending(p_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_referrer_id uuid;
  v_claimed boolean;
  v_status text;
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role'
     and lower(coalesce(auth.jwt()->>'email', '')) not in (
       'mukhlispertama@gmail.com',
       'dokterlaundromat@gmail.com'
     ) then
    raise exception 'Akses admin saja' using errcode = '42501';
  end if;

  select referred_by_owner_id, referral_bonus_claimed, status
    into v_referrer_id, v_claimed, v_status
  from public.app_subscriptions
  where owner_id = p_owner_id
  for update;

  if v_referrer_id is null or v_claimed then
    return;
  end if;
  if v_status is distinct from 'aktif' then
    return;
  end if;
  if v_referrer_id = p_owner_id then
    return;
  end if;

  update public.app_subscriptions
    set paid_until = greatest(coalesce(paid_until, now()), now()) + interval '15 days',
        referral_bonus_claimed = true
    where owner_id = p_owner_id;

  update public.app_subscriptions
    set paid_until = greatest(coalesce(paid_until, now()), now()) + interval '15 days'
    where owner_id = v_referrer_id;
end;
$function$;

-- Hanya pengguna login yang boleh menukar kode pendaftaran menjadi langganan.
revoke all on function public.claim_registration_code_and_activate(text) from public, anon;
grant execute on function public.claim_registration_code_and_activate(text) to authenticated, service_role;

-- Nomor nota dibuat oleh pengguna aplikasi yang login, bukan anon.
revoke all on function public.next_transaction_kode() from public, anon;
grant execute on function public.next_transaction_kode() to authenticated, service_role;

-- Pemanggil browser hanya perlu mengetahui apakah dirinya kasir toko tersebut.
-- SECURITY INVOKER membuat pemeriksaan mengikuti RLS team_members.
create or replace function public.is_active_member_of(shop_owner uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select exists (
    select 1
    from public.team_members
    where owner_id = shop_owner
      and member_id = auth.uid()
      and status = 'aktif'
  );
$function$;

-- Fungsi trigger dijalankan oleh trigger yang terpasang, bukan sebagai RPC browser.
revoke all on function public.notify_new_account() from public, anon, authenticated;
revoke all on function public.notify_new_payment_request() from public, anon, authenticated;
revoke all on function public.payment_requests_rate_limit() from public, anon, authenticated;

-- Fungsi notifikasi memakai objek di public dan pemanggilan net.http_post yang berkualifikasi.
alter function public.notify_new_account() set search_path = public;
alter function public.notify_new_payment_request() set search_path = public;

-- Pemeriksaan kode ini memang publik saat pendaftaran, tetapi seluruh tabelnya
-- berkualifikasi eksplisit sehingga search_path dapat dikosongkan.
alter function public.check_registration_code(text) set search_path = '';
