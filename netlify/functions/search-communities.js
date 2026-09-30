/* Netlify Function: cari komunitas laundry di internet lewat Serper.dev
 * (search API pihak ketiga berbasis hasil Google Search), dipanggil dari
 * tombol "Cari" di bagian "Cari Komunitas Online" pada tab Riset Komunitas
 * di marketing.html (searchCommunitiesOnline()).
 *
 * Kenapa ini WAJIB lewat server (bukan langsung dari browser ke API
 * Serper): SERPER_API_KEY rahasia dipakai buat autentikasi ke Serper --
 * kalau ditaruh di kode browser, siapa saja bisa mencurinya lewat DevTools
 * dan menghabiskan kuota/biaya pencarian berbayar atas nama kita.
 *
 * Function ini juga memverifikasi token Supabase Auth pengirim request
 * (header Authorization: Bearer <access_token>) benar-benar akun admin
 * (ADMIN_EMAIL) -- bukan cuma mengandalkan marketing.html menyembunyikan
 * tombolnya di browser -- supaya orang lain yang menemukan URL function ini
 * langsung dari luar tidak bisa menghabiskan kuota Serper berbayar kita.
 *
 * Env var yang wajib diisi di Netlify (Site settings -> Environment variables):
 *   SERPER_API_KEY - API key dari dashboard serper.dev (serper.dev/api-key)
 *   SUPABASE_URL   - URL project Supabase (sama dipakai index.html/marketing.html)
 */
const SERPER_API_KEY = process.env.SERPER_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
// Anon/publishable key Supabase -- ini SUDAH publik (sama persis dengan yang
// tertanam di kode browser marketing.html), jadi aman ditaruh di sini. Dipakai
// cuma buat memvalidasi access_token pengguna lewat endpoint /auth/v1/user,
// BUKAN buat baca/tulis data (beda total dari SUPABASE_SERVICE_ROLE_KEY yang
// dipakai function Midtrans, yang harus tetap rahasia).
const SUPABASE_ANON_KEY = 'sb_publishable_TEP3jcXZqkhcBqRpaLSyPQ_1szM0vLB';
const ADMIN_EMAIL = 'mukhlispertama@gmail.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!SERPER_API_KEY || !SUPABASE_URL) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Konfigurasi server belum lengkap (env var SERPER_API_KEY belum diisi di Netlify)' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Belum login' }) };
  }
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sesi tidak valid, silakan login ulang' }) };
  }
  const user = await userRes.json().catch(() => ({}));
  if (String(user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Fitur ini khusus akun admin' }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Body request tidak valid' }) };
  }
  const q = String(payload.q || '').trim();
  if (!q) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Kata kunci pencarian wajib diisi' }) };
  }

  const serperRes = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, gl: 'id', hl: 'id', num: 10 }),
  });
  const serperData = await serperRes.json().catch(() => ({}));
  if (!serperRes.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Gagal mengambil hasil pencarian dari Serper', detail: serperData }) };
  }

  const results = Array.isArray(serperData.organic)
    ? serperData.organic.map((r) => ({
        title: String(r.title || ''),
        link: String(r.link || ''),
        snippet: String(r.snippet || ''),
      }))
    : [];

  return { statusCode: 200, body: JSON.stringify({ results }) };
};
