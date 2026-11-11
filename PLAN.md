# One Desk — PLAN (MVP)

> Classification: **INTERNAL** · Goals & arsitektur: [DESIGN.md](./DESIGN.md)
> File ini adalah **patokan eksekusi**. Tidak ada pekerjaan di luar tiket di sini.

## Rules eksekusi (wajib)

1. **Satu tiket per eksekusi.** Kerjakan tiket berurutan sesuai dependency; jangan mengerjakan beberapa tiket sekaligus kecuali diminta.
2. **Tidak ada eksekusi tanpa tiket.** Jika butuh pekerjaan baru, tambahkan tiket (status `TODO`, lengkap dengan deskripsi) dan minta persetujuan dulu.
3. **Konfirmasi sebelum mulai.** Sebelum mengeksekusi sebuah tiket, sebutkan ID tiketnya dan tunggu "lanjut" dari user.
4. **Update status di file ini setiap kali status tiket berubah**: `TODO` → `IN PROGRESS` → `DONE` (atau `BLOCKED` beserta alasannya). Tambahkan catatan singkat hasil/verifikasi di bagian *Log* tiket.
5. **Kerjakan sesuai Description & Acceptance criteria.** Jika ternyata perlu menyimpang, update deskripsi tiket dulu dan konfirmasi ke user.
6. **DONE = acceptance criteria terverifikasi** (test/typecheck/build/manual check sesuai yang tertulis), bukan sekadar kode ditulis.
7. Patuhi DESIGN.md: struktur per module di Elysia, komponen UI pakai Mekari Pixel, tanpa secret di repo.

Status: `TODO` · `IN PROGRESS` · `DONE` · `BLOCKED`

**Definisi DONE:** kode ada di repo `~/Works/one-desk` **dan** acceptance criteria sudah terverifikasi.

> **Catatan status (koreksi):** OD-01 … OD-30 awalnya dikerjakan & diverifikasi di workspace cloud sesi Claude, lalu dipindah ke laptop lewat OD-32. Sebelum OD-32 selesai, status DONE untuk tiket-tiket tersebut keliru karena kodenya belum ada di laptop. Verifikasi ulang di laptop dilakukan di OD-34.

## Ringkasan

| Fase | Tiket | Status |
|------|-------|--------|
| 0. Fondasi | OD-01 … OD-04 | DONE |
| 1. Auth (Mekari OAuth2) | OD-05 … OD-07, OD-51 … OD-53, OD-64 | DONE · OD-07 BLOCKED (butuh info SSO) · OD-51 … OD-53 DONE |
| 2. Connect Jira & Bitbucket | OD-08 … OD-11 | DONE (diverifikasi dengan mock) |
| 3. PGP | OD-12 … OD-20 | DONE · OD-19 OUT OF SCOPE (digantikan usulan OD-65) |
| 3b. Direct leader & PGP bawahan (2 arah) | OD-45 … OD-50 | DONE |
| 4. Kanban | OD-21 … OD-23 | DONE (mock) |
| 5. Pull Requests | OD-24 … OD-26 | DONE (mock) |
| 6. Frontend shell & polish | OD-27 … OD-31 | DONE |
| 7. Pindah ke laptop & run lokal | OD-32 … OD-35 | OD-32 … OD-35 DONE |
| 8. Hardening & integrasi nyata | OD-36 … OD-42 | TODO |
| 9. Rilis MVP internal | OD-43 … OD-44 | TODO |
| 10. Confluence (read-only) | OD-54 | IN PROGRESS |
| 11. Create PGP per tahun+kuartal & evidence otomatis | OD-71 … OD-73 (create), OD-68 … OD-70 (saran) | OD-71 … OD-73 dan OD-68 DONE, OD-69 … OD-70 dan OD-74 TODO |

**Urutan kerja berikutnya (disarankan):** OD-32 → OD-33 → OD-34 → OD-35 → OD-31 → OD-45 … OD-50 → OD-36 → sisanya.

---

## Fase 0 — Fondasi

### OD-01 · Scaffold monorepo · `DONE`
**Description:** Bun workspaces `apps/server` + `apps/web`, `bunfig.toml` dengan `linker = "hoisted"` (dibutuhkan Pixel postcss), `.gitignore`, `.env.example` (placeholder saja), `docker-compose.yml` (Postgres 16, service `app` di profile `full`), `Dockerfile` multi-stage (build Vue → run Bun).
**Acceptance:** `bun install` sukses dari root; script root `dev/build/start/typecheck/test/db:*` tersedia.
**Log:** Selesai. Versi dipin: elysia 1.4.31, @elysiajs/eden 1.4.9, drizzle-orm 0.45.4, vue 3.5.45, vue-router 4.6.4, pinia 3.0.4, vite 8.3.7, typescript 5.9.3, @mekari/pixel3 1.0.16.

### OD-02 · Config env terpusat · `DONE`
**Description:** `apps/server/src/config/env.ts` membaca & memvalidasi env (required: `DATABASE_URL`). Group: app, oauth, jira, bitbucket (`BITBUCKET_API_URL` overridable untuk test), google, `ADMIN_EMAILS`, `ALLOWED_EMAIL_DOMAINS`, `DEV_LOGIN_EMAIL`.
**Acceptance:** Server gagal start dengan pesan jelas bila env wajib kosong.
**Log:** Selesai.

### OD-03 · Schema DB + migration · `DONE`
**Description:** Drizzle schema (`users`, `sessions`, `connections`, `pgp_templates`, `pgp_template_items`, `pgp_plans`, `pgp_plan_items`, enum role/status) di `src/db/schema.ts`; migration `drizzle/0000_init.sql`; runner `bun run db:migrate`.
**Acceptance:** Migration jalan di Postgres kosong.
**Log:** Diverifikasi di Postgres 16 lokal (cloud).

### OD-04 · Shared server utilities · `DONE`
**Description:** `shared/errors.ts` (AppError, NotFound, Forbidden, BadRequest, IntegrationError, NotConnectedError), global `onError` di `app.ts` (AppError → status+code, VALIDATION → 422 ringkas, lain → 500 tanpa bocor detail), `shared/cache.ts` (TTL in-memory), `shared/adf.ts` (Jira ADF → plain text), `integrations/http.ts` (JSON client + timeout 20s + mapping error).
**Acceptance:** Error integrasi tidak membocorkan token; 503 jelas bila integrasi belum dikonfigurasi.
**Log:** Diverifikasi via curl (JIRA_NOT_CONFIGURED, NOT_CONNECTED, VALIDATION, BAD_REQUEST).

## Fase 1 — Auth (Mekari OAuth2)

### OD-05 · Module auth: OAuth2 + PKCE + session · `DONE`
**Description:** `modules/auth/{index,service,model}.ts`. `GET /auth/login` (state + PKCE S256 di cookie 10 menit, redirect relatif aman), `GET /auth/callback` (validasi state, tukar code, ambil userinfo, upsert user, cek domain, buat session), `POST /api/auth/logout`, `GET /api/auth/me`, `GET /api/auth/config`. Session: token random 256-bit di cookie httpOnly `od_session`, hash SHA-256 disimpan di DB, TTL `SESSION_TTL_DAYS`.
**Acceptance:** Login end-to-end dengan OAuth server tiruan; state palsu ditolak; logout menghapus session.
**Log:** Diverifikasi dengan mock OAuth server (PKCE wajib, userinfo bentuk `{data:{...}}`).

### OD-06 · Auth guard macro · `DONE`
**Description:** `shared/auth.plugin.ts` Elysia macro `auth: true` (inject `user`) dan `admin: true`. Dipakai semua module.
**Acceptance:** Endpoint terlindungi → 401 tanpa session, 403 untuk non-admin di route admin.
**Log:** Selesai.

### OD-07 · Konfigurasi Mekari OAuth2 nyata · `BLOCKED`
**Description:** Daftarkan client One Desk di Mekari SSO; isi `MEKARI_OAUTH_AUTHORIZE_URL/TOKEN_URL/USERINFO_URL/CLIENT_ID/CLIENT_SECRET/SCOPE`, redirect URI `{APP_URL}/sso-callback` (OD-52). Cek bentuk userinfo; bila field berbeda, sesuaikan `AuthService.fetchProfile` (mapping `pick(...)`). Set `MEKARI_OAUTH_PKCE=false` bila SSO tidak mendukung PKCE.
**Acceptance:** Login dengan akun @mekari.com sungguhan berhasil di lokal.
**Blocked by:** butuh endpoint + client credential dari tim Mekari SSO (lihat DESIGN §9.1). Sementara pakai `DEV_LOGIN_EMAIL` (lokal saja).

### OD-51 · Host lokal `one-desk.local` untuk OAuth redirect · `DONE`
**Description:** Mekari SSO tidak menerima `localhost` sebagai redirect URI. Dev server mengikuti `APP_URL`: bila `APP_URL=http://one-desk.local`, Vite memakai host & port dari URL itu (port 80 → bind wildcard karena macOS tanpa root hanya mengizinkan itu untuk port < 1024; `allowedHosts` dibatasi ke hostname tsb) dan redirect URI OAuth menjadi `http://one-desk.local/auth/callback`. Script `dev:web` memuat `.env` root. README: langkah `/etc/hosts` (dilakukan user, butuh sudo).
**Acceptance:** Dengan `APP_URL=http://one-desk.local`: `bun run dev` melayani UI di host itu, `/auth/login` mengarahkan ke SSO dengan `redirect_uri=http://one-desk.local/auth/callback`, Origin guard (OD-36) menerima request dari host itu; tanpa `APP_URL` perilaku lama (localhost:5173) tidak berubah.
**Depends:** OD-36. Mendukung OD-07.
**Log:** 2026-11-10 — `apps/web/vite.config.ts` mengambil host & port dari `APP_URL` (`strictPort`, port < 1024 → `host: true`, `allowedHosts: [hostname]`); `dev:web` memuat `.env` root; README bagian "Host one-desk.local" + `.env.example`. Diverifikasi dengan `APP_URL=http://one-desk.local` di port 80 (Host header, karena `/etc/hosts` perlu sudo dan dilakukan user): UI 200, proxy API 200, `/auth/login` → `redirect_uri=http://one-desk.local/auth/callback`, POST dengan Origin host itu 200 dan Origin `localhost:5173` 403, Host `evil.example` 403; default `localhost:5173` tetap jalan; `typecheck` lulus, `test` 42 pass. Catatan keamanan: bind wildcard di port 80 membuat dev server terjangkau via IP di jaringan lokal (Vite selalu mengizinkan Host berupa IP) → kosongkan `DEV_LOGIN_EMAIL` setelah OAuth jalan. Belum diuji: login SSO sungguhan (OD-07, butuh client credential) dan `/etc/hosts` di Mac user. Commit: lihat git log.

### OD-52 · Callback OAuth `/sso-callback` + konfigurasi scope · `DONE`
**Description:** Redirect URI yang didaftarkan di Mekari SSO adalah `http://one-desk.local/sso-callback` (scope `esign`, authorization code). Callback pindah dari `/auth/callback` ke `/sso-callback`: env baru `MEKARI_OAUTH_REDIRECT_URI` (default `{APP_URL}/sso-callback`), route callback didaftarkan pada path URI itu, `redirect_uri` di authorize & token exchange memakai nilai yang sama, proxy Vite meneruskan path tsb. `MEKARI_OAUTH_SCOPE` diisi `esign` di `.env` lokal.
**Acceptance:** `/auth/login` mengarahkan ke SSO dengan `redirect_uri=http://one-desk.local/sso-callback`; `GET /sso-callback` menjalankan alur callback (state salah → `/login?error=invalid_state`) baik langsung ke server maupun lewat Vite; test untuk route callback; typecheck & test hijau.
**Depends:** OD-51. Mendukung OD-07 (endpoint SSO & credential tetap dibutuhkan untuk login sungguhan).
**Log:** 2026-11-10 — env `MEKARI_OAUTH_REDIRECT_URI` (default `{APP_URL}/sso-callback`); `AuthService.redirectUri` memakainya; route callback dipindah keluar dari grup `/auth` dan didaftarkan pada path URI itu; proxy Vite ikut path tsb; `.env` lokal `MEKARI_OAUTH_SCOPE=esign`; README & `.env.example` diperbarui; `test/auth-callback.test.ts` (5 test). Diverifikasi dengan endpoint & credential **dummy** (`sso.example.test`): `/auth/login` → `redirect_uri=http%3A%2F%2Fone-desk.local%2Fsso-callback&scope=esign`; `/sso-callback` lewat Vite dan langsung ke API → 302 `/login?error=invalid_state`; `/auth/callback` lama → 404; `typecheck` lulus, `test` 47 pass. Belum diuji: login SSO sungguhan — URL authorize/token/userinfo, client id & secret belum ada (OD-07); asumsi yang masih perlu dikonfirmasi: client auth di token endpoint (saat ini `client_id`/`client_secret` di body), dukungan PKCE, bentuk userinfo untuk scope `esign` (butuh `email`). Commit: lihat git log.

### OD-53 · Sesuaikan OAuth ke Mekari Account (endpoint & token JSON) · `DONE`
**Description:** Sumber: https://developers.mekari.com/docs/kb/authentication/oauth2. Authorize `https://account.mekari.com/auth` (`client_id`, `response_type=code`, `scope`); token `POST https://account.mekari.com/auth/oauth2/token` dengan body **JSON** (`client_id`, `client_secret`, `grant_type`, `code`, `scope`), respons `access_token`, `token_type`, `expires_in`, `refresh_token`. Ubah `AuthService.exchangeCode` dari form-urlencoded ke JSON (+ `scope`), isi URL authorize/token di `.env.example`, `MEKARI_OAUTH_PKCE=false` (PKCE tidak disebut di dokumen). Userinfo/profile **tidak terdokumentasi** → `MEKARI_OAUTH_USERINFO_URL` dikosongkan sampai tim SSO/portal developer menjawab (endpoint + scope yang memberi `email`).
**Acceptance:** Test memverifikasi token request berupa JSON dengan field di atas terhadap token server palsu; `/auth/login` mengarah ke `https://account.mekari.com/auth` dengan `redirect_uri=http://one-desk.local/sso-callback` dan `scope=esign`; typecheck & test hijau.
**Depends:** OD-52. Mendukung OD-07.
**Log:** 2026-11-10 — `exchangeCode` kini JSON (`grant_type`, `code`, `redirect_uri`, `client_id`, `client_secret`, `scope`, + `code_verifier` bila PKCE); `.env.example` & `.env` lokal berisi URL authorize/token Mekari dan `MEKARI_OAUTH_PKCE=false`; README diperbarui. `test/auth-exchange.test.ts` (4 test, token server palsu): body JSON & field, verifier hanya bila ada, error tidak membocorkan secret, 200 tanpa token ditolak. `/auth/login` (credential dummy) → `https://account.mekari.com/auth?...redirect_uri=http%3A%2F%2Fone-desk.local%2Fsso-callback&scope=esign`. `typecheck` lulus, `test` 51 pass. Keputusan masih terbuka (tidak terdokumentasi): endpoint userinfo & scope yang memberi `email` (`MEKARI_OAUTH_USERINFO_URL` kosong → `/auth/login` 503 sampai terisi), apakah `state`/`redirect_uri` di authorize dan `redirect_uri` di token diterima/dikembalikan (dokumen hanya menyebut `client_id`, `response_type`, `scope`), refresh token (30 hari, sekali pakai) belum dipakai. Semua baru bisa dipastikan dengan client credential sungguhan (OD-07). Commit: lihat git log.
**Log (lanjutan, 2026-11-10):** Endpoint userinfo ditemukan user dari koleksi Postman "Mekari SSO API": `GET https://api.mekari.com/v1/users/me` + `Authorization: Bearer <access_token>`; respons `{ data: { id, type, attributes: { sso_id, email, first_name, last_name, full_name, avatar, ... } } }`. `fetchProfile` memetakan `data.attributes.{sso_id,email,full_name|first_name+last_name,avatar}` (+ bentuk OIDC datar tetap diterima); error "no email" menyebut nama field di `fields/data/attributes` tanpa nilai; `.env`/`.env.example`/README memakai URL itu. `test/auth-profile.test.ts` (6 test, userinfo server palsu). `typecheck` lulus, `test` 57 pass. Belum terbukti: scope yang dipakai app (`esign`) mengizinkan `/v1/users/me` — scope di Mekari dipetakan ke endpoint API, cek scope yang dipakai di Postman "Getting Access Token".

## Fase 2 — Connect Jira & Bitbucket

### OD-08 · Jira client (service account) · `DONE`
**Description:** `integrations/jira.client.ts`: searchUsers, getUser, listBoards, getBoard, boardConfig, boardIssues, search (`/rest/api/3/search/jql`), getIssue, getComments. Basic auth `JIRA_EMAIL:JIRA_API_TOKEN`.
**Acceptance:** Semua method dipanggil sukses terhadap mock.
**Log:** Mock OK. Real Jira → OD-37.

### OD-09 · Bitbucket client (service account) · `DONE`
**Description:** `integrations/bitbucket.client.ts`: members (paginated), userPullRequests (workspace-wide by author), repoPullRequests (BBQL), pullRequest, diffstat, commits, comments, statuses, diff. Bearer `BITBUCKET_ACCESS_TOKEN` atau Basic `BITBUCKET_EMAIL:BITBUCKET_API_TOKEN`.
**Acceptance:** Semua method sukses terhadap mock.
**Log:** Mock OK. Real Bitbucket → OD-38.

### OD-10 · Module connections (API) · `DONE`
**Description:** `modules/connections`: `GET /api/connections`; Jira: `POST /jira/auto` (match email), `GET /jira/users?q`, `PUT /jira`, `DELETE /jira`, `GET /jira/boards?q`, `PUT /jira/board`; Bitbucket: `POST /bitbucket/auto` (match Atlassian account_id dari Jira, fallback nama unik), `GET /bitbucket/members?q`, `PUT /bitbucket`, `DELETE /bitbucket`. Helper `requireJira/requireBitbucket` → 409 `NOT_CONNECTED`.
**Acceptance:** Auto-connect Jira lalu Bitbucket berhasil; endpoint lain 409 bila belum connect.
**Log:** Mock OK.

### OD-11 · Halaman Connections (UI) · `DONE`
**Description:** `views/ConnectionsView.vue`: kartu Jira & Bitbucket (status badge, auto-connect, cari manual, putuskan), pilih board untuk kanban.
**Acceptance:** Flow connect/disconnect di UI berjalan.
**Log:** Screenshot OK (mock).

## Fase 3 — PGP

### OD-12 · Parser sheet PGP + unit test · `DONE`
**Description:** `modules/pgp/sheet-parser.ts`: cari header by label (Objective + Key Results), map kolom by nama, baca meta (Division, Name, SBU, Leader, Period), carry-forward Objective/KR (merged cell), skip baris `Example:`, stop di `Total`/`Team Members`, parse persen (`2%`, `0.3`, `30`), warnings (total ≠ 100%).
**Acceptance:** `bun test` hijau (fixture meniru tab Q4-26).
**Log:** 11 test pass.

### OD-13 · Template service & API · `DONE`
**Description:** `template.service.ts` + route `/api/pgp/templates`: list (member: published saja), get, create (opsional dengan items), patch (title/period/status), replace items (upsert by id agar link plan tetap), delete (ditolak bila sudah ada plan), list plans per template (admin).
**Acceptance:** CRUD via curl; item count & total weight di list benar.
**Log:** Bug subquery tidak ter-qualify (itemCount = 0) sudah diperbaiki.

### OD-14 · Plan service & API · `DONE`
**Description:** `plan.service.ts` + route `/api/pgp/plans`: list milik saya (score & total weight), create dari template published (copy item, prefill header dari plan sebelumnya, idempotent), get (owner/admin read), patch header, replace items (validasi achievement ≤ weight; plan submitted → hanya kolom monitoring), submit (wajib 100%), reopen, delete.
**Acceptance:** Skenario create → isi → submit → reopen via curl lulus.
**Log:** Lulus.

### OD-15 · Export Excel · `DONE`
**Description:** `excel.service.ts#exportPlan` (exceljs): header info, tabel format management, merge Objective/KR berurutan, kolom persen, baris Total + Score, freeze header. Route `GET /api/pgp/plans/:id/export`.
**Acceptance:** File .xlsx terunduh & bisa di-import ulang lewat OD-16.
**Log:** Round-trip export → import OK.

### OD-16 · Import template dari .xlsx · `DONE`
**Description:** `POST /api/pgp/templates/import/xlsx/preview` (multipart, maks 10 MB): baca semua sheet (merged cell hanya nilai kiri-atas, persen → `x%`), pilih tab, parse → preview (tidak menyimpan). Client lalu POST template dengan item hasil review.
**Acceptance:** Preview mengembalikan tabs, items, warnings.
**Log:** OK.

### OD-17 · UI ItemsEditor (shared) · `DONE`
**Description:** `components/ItemsEditor.vue` (+ `RowActions.vue`, `EvidenceLinks.vue`): tabel ala spreadsheet, mode template/plan, tambah item / tambah initiative di KR yang sama, naik/turun, hapus, total weight & score live, kolom planning terkunci saat submitted.
**Acceptance:** vue-tsc lulus; edit di UI tersimpan.
**Log:** Workaround bug scope vue-tsc dengan memecah komponen.

### OD-18 · UI PGP (home, plan editor, templates) · `DONE`
**Description:** `PgpHomeView` (template tersedia + PGP saya), `PlanEditorView` (header, score, ringkasan SP Jira 3 bulan, simpan, submit/reopen, export, guard unsaved changes), `TemplatesView` (list, publish/archive), `TemplateEditorView` (scratch / Google Sheet / upload xlsx, edit item, daftar plan pengguna).
**Acceptance:** Semua halaman render tanpa error console (selain icon CDN di sandbox).
**Log:** Screenshot OK.

### OD-19 · Import dari Google Sheet (Sheets API) · `OUT OF SCOPE`
**Description:** Kode sudah ada: `integrations/google-sheets.client.ts` + `GET /templates/import/sheet/tabs?url=` dan `/sheet/preview?url=&tab=`. Sisa pekerjaan: buat service account Google (Sheets API readonly), isi `GOOGLE_SERVICE_ACCOUNT_JSON`, share sheet contoh (Viewer), uji import tab "Q4 - 26" dan "Q3 - 2026"; perbaiki parser bila format tab lama berbeda (mis. Q3 yang kolom Objective berisi label pendek "DORA/SLO").
**Acceptance:** Import kedua tab menghasilkan item dengan total weight sesuai sheet, warnings masuk akal.
**Depends:** credential Google (user/admin).
**Keputusan (2026-11-10):** out of scope — tidak akan membuat Google service account. Alternatif tanpa credential diusulkan di OD-65 (sheet publik diunduh sebagai .xlsx). Kode `integrations/google-sheets.client.ts` dan env `GOOGLE_SERVICE_ACCOUNT_JSON` dihapus saat OD-65 dikerjakan.

### OD-20 · Ringkasan delivery Jira di PGP · `DONE`
**Description:** `GET /api/kanban/stats`: story point & jumlah tiket resolved per bulan (3 bulan) untuk evidence KR delivery; ditampilkan di PlanEditor.
**Acceptance:** Angka sesuai data mock.
**Log:** OK.

## Fase 3b — Direct leader & PGP bawahan (2 arah)

> Keputusan (lihat DESIGN §4 "Direct leader — 2 arah"): `users.manager_id → users.id` untuk relasi aktif; permintaan bisa diajukan dari bawahan **atau** atasan dan aktif setelah pihak lain mengonfirmasi; hanya direct report; leader read-only; admin bisa set langsung.

### OD-45 · Schema reporting line · `DONE`
**Description:** Di `apps/server/src/db/schema.ts`:
- `users`: tambah `managerId uuid references users.id on delete set null` + index `users_manager_idx` + check constraint `manager_id <> id`.
- Tabel baru `reporting_requests`: `id uuid pk`, `reportId uuid not null → users.id on delete cascade`, `leaderId uuid not null → users.id on delete cascade`, `requestedBy uuid not null → users.id on delete cascade`, `createdAt timestamptz default now()`. Unique index pada `report_id` (satu pending per bawahan). Check `report_id <> leader_id` dan `requested_by in (report_id, leader_id)`.
- Relation Drizzle: `users.manager` / `users.reports` (self-relation), `reportingRequests.report|leader`.
Generate migration `bunx drizzle-kit generate --name reporting_line` → `drizzle/0001_reporting_line.sql`, jalankan `bun run db:migrate`.
**Acceptance:** Migration jalan di DB yang sudah berisi data; `bun run typecheck` lulus; insert manager = diri sendiri dan `requested_by` pihak ketiga ditolak DB.
**Depends:** OD-34 (DB lokal jalan).
**Log:** 2026-11-10 — `users.manager_id` (+ index, check `manager_id <> id`), tabel `reporting_requests` (unique `report_id`, check bukan diri sendiri & `requested_by in (report, leader)`), relation `users.manager|reports` dan `reportingRequests.report|leader`. Migration `0001_reporting_line.sql` diterapkan ke DB `one-desk` yang sudah berisi 1 user (data utuh). Constraint diuji di psql (transaksi, di-rollback): manager = diri sendiri, `requested_by` pihak ketiga, report = leader, dan pending ganda per bawahan semuanya ditolak; request valid diterima. `bun run typecheck` lulus, `bun run test` 11 pass. Commit: lihat git log.

### OD-46 · Module `org` (API reporting line, 2 arah) · `DONE`
**Description:** Buat `apps/server/src/modules/org/{index,service,model}.ts` (pola module lain, guard `auth: true`), daftarkan di `app.ts`. Endpoint:
- `GET /api/org/me` → `{ leader, reports[], incoming[], outgoing[] }`. `incoming` = permintaan yang menunggu konfirmasi **saya** (dari calon leader atau calon bawahan), `outgoing` = permintaan yang saya ajukan. Tiap item: `requestId`, `direction: 'as_report' | 'as_leader'`, user (id, name, email, avatarUrl), `createdAt`.
- `GET /api/org/users?q=` → cari user terdaftar (nama/email, maks 20, exclude diri sendiri).
- `POST /api/org/requests/leader` `{ userId }` → **bawahan mengajukan atasan**: upsert `reporting_requests(report=me, leader=userId, requested_by=me)`.
- `POST /api/org/requests/report` `{ userId }` → **atasan menambah bawahan**: upsert `reporting_requests(report=userId, leader=me, requested_by=me)`.
  Validasi keduanya: bukan diri sendiri; relasi yang sama belum aktif; tidak saling (calon leader tidak sedang melapor ke calon bawahan) → 400.
- `POST /api/org/requests/:id/accept` → hanya pihak yang **bukan** `requested_by` (dan merupakan report/leader di request tsb); set `report.manager_id = leader_id`, hapus request (dalam transaksi).
- `POST /api/org/requests/:id/reject` → pihak yang harus konfirmasi; hapus request.
- `DELETE /api/org/requests/:id` → pengaju membatalkan.
- `DELETE /api/org/reports/:userId` → leader melepas direct report aktif. `DELETE /api/org/leader` → bawahan melepas leader-nya.
- Admin (`admin: true`): `PUT /api/org/users/:id/manager` `{ managerId | null }` → set langsung (aktif), hapus request pending user tsb, validasi sama.
- `GET /api/org/team?period=` → daftar direct report aktif + plan mereka per period (`planId`, status, score, totalWeight, updatedAt; `null` bila belum membuat plan).
**Acceptance:** Skenario curl kedua arah: (a) B ajukan A sebagai leader → A accept → `GET /team` A berisi B; (b) A tambah C → C accept → aktif; (c) pengaju tidak bisa accept permintaannya sendiri → 403; reject, batal, lepas, admin set berfungsi; validasi diri sendiri & saling → 400.
**Depends:** OD-45.
**Log:** 2026-11-10 — `modules/org/{index,service,model}.ts` + registrasi di `app.ts`; semua endpoint di Description ada. `direction` = peran **saya** di request (`as_leader` = saya calon leader). Request baru menggantikan pending lama; `accept` memvalidasi ulang (saling/aktif) di dalam transaksi; `team` default ke period template published terbaru. Diverifikasi dengan skrip sementara (4 user sintetis di DB `one-desk-e2e`): 34 pengecekan lulus — kedua arah accept, pengaju tidak bisa accept/reject sendiri (403), pihak ketiga 403, reject, batal, lepas leader/report, admin set langsung (menghapus pending), diri sendiri/saling/sudah aktif → 400, user tidak ada → 404, tanpa session → 401, search. `typecheck` lulus, `test` 11 pass. Test permanen → OD-50. Commit: lihat git log.

### OD-47 · Aturan akses plan untuk leader · `DONE`
**Description:** Di `PlanService.get` (`modules/pgp/plan.service.ts`) izinkan mode `read` bila `plan.user.managerId === viewer.id` (relasi **aktif**; request pending tidak memberi akses); `canEdit` tetap hanya owner. Export Excel ikut aturan yang sama (memakai `get`). Tambahkan field `viewerRole: 'owner' | 'leader' | 'admin'` di response. Saat `PlanService.create`, prefill `directLeader` dari nama manager aktif bila belum ada dari plan sebelumnya.
**Acceptance:** Leader aktif bisa GET & export plan bawahan; PUT/PATCH/submit oleh leader → 403; pihak dengan request pending → 403; user lain → 403.
**Depends:** OD-46.
**Log:** 2026-11-10 — `PlanService.get`: mode `read` kini juga untuk leader aktif (`users.manager_id = viewer`); `canEdit` tetap owner; response + `viewerRole` (`owner` > `leader` > `admin`). Export ikut `get`. `create`: `directLeader` = plan sebelumnya, kalau kosong nama manager aktif. Diverifikasi (skrip sementara, 5 user sintetis, DB `one-desk-e2e`): 18 pengecekan lulus — leader aktif GET & export 200; PUT items/PATCH/submit/reopen/DELETE oleh leader 403; pihak pending 403 (GET & export); user lain 403; admin 200 (`viewerRole=admin`); setelah leader dilepas 403; prefill leader benar. `typecheck` lulus, `test` 11 pass. Test permanen → OD-50. Commit: lihat git log.

### OD-48 · UI dashboard: atasan & direct report (2 arah) · `DONE`
**Description:** Komponen baru `components/ReportingLinePanel.vue` (Mekari Pixel), dipasang di `views/pgp/PgpHomeView.vue`:
- **Banner permintaan masuk** (`incoming`): "X mengajukan kamu sebagai direct leader" (`as_leader`) atau "X ingin menambahkan kamu sebagai direct report" (`as_report`), tombol *Terima* / *Tolak*.
- **Direct leader saya**: nama leader aktif + tombol *Lepas*; bila belum ada → input cari user + tombol *Ajukan sebagai atasan*; permintaan keluar tampil dengan badge "Menunggu konfirmasi" + *Batalkan*.
- **Direct report saya**: daftar aktif (tombol *Lepas*) + permintaan keluar (badge "Menunggu konfirmasi" + *Batalkan*) + input cari user + tombol *Tambah sebagai bawahan*.
Toast sukses/error via `notifySuccess/notifyError`; refresh `GET /api/org/me` setelah tiap aksi.
**Acceptance:** Seluruh alur OD-46 (kedua arah) bisa dilakukan dari UI tanpa curl; vue-tsc & build lulus.
**Depends:** OD-46.
**Log:** 2026-11-10 — `components/ReportingLinePanel.vue` (banner permintaan masuk Terima/Tolak, kartu Direct leader saya, kartu Direct report saya, badge "Menunggu konfirmasi" + Batalkan, Lepas) dan `components/UserPicker.vue` (cari user + aksi; dipakai dua kali), dipasang di atas `PgpHomeView`. Toast via `notifySuccess/notifyError`, `GET /api/org/me` di-refresh setelah tiap aksi. Diverifikasi dengan Playwright sementara (4 user sintetis, 4 konteks browser): B ajukan A → A Terima; A tambah C → C Terima; A tambah D → D Tolak; tambah lagi → Batalkan; A lepas B; C lepas leader; tanpa error JS; screenshot dicek. `typecheck`, `build`, `test` (11 pass), dan `bun run e2e` (10/10) lulus. Test UI permanen tidak ditambahkan (di luar scope; test API → OD-50). Commit: lihat git log.

### OD-49 · Halaman "Tim Saya" · `DONE`
**Description:** Route baru `/team` (`views/team/TeamView.vue`) + menu sidebar "Tim Saya" (tampil bila user punya ≥ 1 direct report aktif — tambah `reportCount` di `GET /api/auth/me`). Isi: pilih period (default period template published terbaru), tabel ala "Team Members / Score" di sheet: nama, status PGP (Belum mulai / Draft / Submitted), score, total weight, terakhir update, link "Lihat" → `/pgp/plans/:id` (read-only, banner "Kamu melihat PGP {nama} sebagai direct leader") dan tombol Export.
**Acceptance:** Leader melihat semua direct report aktif dengan status benar; plan bawahan terbuka read-only; menu tersembunyi untuk user tanpa bawahan.
**Depends:** OD-47, OD-48.
**Log:** 2026-11-10 — `GET /api/auth/me` + `reportCount`; route `/team` + `views/team/TeamView.vue` (select period default period template published terbaru, tabel nama/status/score/total weight/update, Lihat + Export); menu sidebar "Tim Saya" hanya bila `reportCount > 0` (di-refresh via `auth.load()` setelah aksi di `ReportingLinePanel`). `PlanEditorView`: banner "Kamu melihat PGP {nama} sebagai direct leader/admin (hanya baca)" bila bukan owner; kartu ringkasan Jira disembunyikan & tidak di-fetch untuk non-owner (datanya milik viewer, menyesatkan). Diverifikasi dengan Playwright sementara (4 user sintetis): menu muncul & `/team` terbuka, B Submitted 80% & C Belum mulai, period terpilih, Export 200, Lihat → read-only + banner (tanpa Simpan/kartu Jira), user tanpa bawahan tidak punya menu, menu muncul tanpa reload setelah menerima bawahan; tanpa error JS; screenshot dicek. `typecheck`, `build`, `test` (11 pass), `e2e` (10/10) lulus. Commit: lihat git log.

### OD-50 · Test akses reporting line · `DONE`
**Description:** `apps/server/test/org.test.ts` (DB test dari OD-39 atau setup sendiri dengan `DATABASE_URL` test). Skenario: request dari bawahan → accept leader; request dari leader → accept bawahan; pengaju tidak bisa accept sendiri; reject; batal; request baru menggantikan pending lama; lepas leader / lepas report; validasi diri sendiri & saling; akses plan (owner, leader aktif, pihak pending, user lain, admin); admin set langsung menghapus pending.
**Acceptance:** `bun run test` hijau.
**Depends:** OD-47.
**Log:** 2026-11-10 — `apps/server/test/db.ts` (helper: DB terpisah `one-desk-test`, nama wajib mengandung "test", dibuat & dimigrasi otomatis, `DATABASE_URL` di-override sebelum modul app di-import) dan `apps/server/test/org.test.ts` (20 test, data sintetis bertag, dibersihkan di `afterAll`): kedua arah request→accept, pengaju tidak bisa accept sendiri, pihak ketiga, reject, batal, request baru menggantikan pending, leader baru menggantikan lama, lepas leader/report, self/saling/sudah aktif/user tidak ada, accept memvalidasi ulang request bersilangan, search, admin set (hapus pending, validasi tetap berlaku), akses plan (owner, leader aktif, pending, user lain, admin, leader dilepas), prefill Direct Leader, `team`. `bun run test` 31 pass (11 lama + 20). Uji mutasi: menonaktifkan cek leader di `PlanService.get` → 2 test gagal; menghapus cek pengaju di `accept` → 1 test gagal (keduanya dikembalikan). DB dev `one-desk` tidak tersentuh; DB test tanpa sisa data. Commit: lihat git log.

## Fase 4 — Kanban

### OD-21 · Kanban service & API · `DONE`
**Description:** `GET /api/kanban?scope=sprint|active`: bila user punya board → kolom dari board configuration, issue via board API (scope sprint hanya untuk board scrum); tanpa board → group by status category. Issue di luar mapping masuk kolom "Other".
**Acceptance:** Kolom & jumlah kartu sesuai mock.
**Log:** OK.

### OD-22 · Issue detail API · `DONE`
**Description:** `GET /api/kanban/issues/:key` (validasi pola key): field utama, description (ADF → text), parent, subtasks, 20 komentar terbaru.
**Acceptance:** Detail tampil tanpa HTML mentah.
**Log:** OK.

### OD-23 · UI Kanban + drawer · `DONE`
**Description:** `KanbanView` (toggle sprint/aktif, filter teks, total SP per kolom), `IssueDrawer` (dipakai ulang di PR detail).
**Acceptance:** Klik kartu membuka drawer dengan styling Pixel.
**Log:** Drawer awalnya tanpa style (recipe Pixel tidak ter-generate) → fixed di OD-30; re-check visual di OD-31.

## Fase 5 — Pull Requests

### OD-24 · PR list API · `DONE`
**Description:** `GET /api/pull-requests?role=author|reviewer&state&repo&page`: author via endpoint workspace-by-user; reviewer = fan-out BBQL `reviewers.uuid` ke repo yang terlibat (maks 20). `GET /api/pull-requests/repos`. Jira key diekstrak dari judul/branch.
**Acceptance:** Kedua role sesuai mock.
**Log:** OK.

### OD-25 · PR detail & diff API · `DONE`
**Description:** `GET /api/pull-requests/:repo/:id` (summary, description, files+diffstat, commits, comments incl. inline, builds, reviewers) dan `/:repo/:id/diff` (dibatasi 400 KB). Param id divalidasi sebagai string digit (workaround bug Elysia `t.Numeric` di params).
**Acceptance:** Detail & diff sesuai mock; id invalid → 422.
**Log:** OK.

### OD-26 · UI PR list & detail · `DONE`
**Description:** `PullRequestsView` (tab dibuat saya / perlu review, filter state & repo, paging), `PullRequestDetailView` (tabs Overview/Files+diff/Commits/Comments, panel reviewers, builds, Jira key → IssueDrawer).
**Acceptance:** Render OK.
**Log:** Screenshot OK.

## Fase 6 — Frontend shell & polish

### OD-27 · Setup Vue + Mekari Pixel · `DONE`
**Description:** Vite + `@vitejs/plugin-vue`, proxy `/api` & `/auth` ke :3000, `PixelPlugin` (pixelTheme, toastManager, tooltipDirective), `pixel.css` (urutan layer), tsconfig strict, alias `@`.
**Log:** OK.

### OD-28 · Eden client, auth store, router guard, layout · `DONE`
**Description:** `lib/api.ts` (treaty + `unwrap` + toast), `stores/auth.ts`, `router.ts` (lazy routes, guard login/admin, title), `AppLayout` (sidebar menu), `LoginView`, `PageHeader`, `AsyncState` (loading/error/belum connect/belum dikonfigurasi), `use-async`.
**Log:** OK.

### OD-29 · Serve SPA dari server (monolith) · `DONE`
**Description:** `src/index.ts` menyajikan `apps/web/dist` dengan fallback `index.html`, aman dari path traversal, cache immutable untuk `/assets`. `/api/*` & `/auth/*` yang tidak ada → 404 JSON. (`@elysiajs/static` dihapus karena tertimpa wildcard.)
**Log:** OK.

### OD-30 · Optimasi bundle & CSS Pixel · `DONE`
**Description:** Treeshake `@mekari/pixel3` (package tidak mendeklarasikan `sideEffects`) → JS awal 1.16 MB → 60 KB (23 KB gzip). `postcss.config.cjs` meng-include `node_modules/@mekari/**/dist` secara eksplisit (workspace hoisted) agar recipe seperti modal/drawer ter-generate.
**Log:** OK. Sisa noise build: `🐼 error ... reading 'literal'` dari Pixel/Panda (tidak memengaruhi output) → OD-41.

### OD-31 · Verifikasi visual end-to-end (Playwright, mock) · `DONE`
**Description:** Jalankan server + mock Jira/Bitbucket + Postgres, skrip Playwright: login (dev) → PGP home → buka plan → isi achievement → simpan → kanban → drawer → PR list → PR detail (files + diff) → connections → templates → template baru. Catat error console (abaikan icon dari `cdn.mekari.design` yang diblok di sandbox).
**Scope tambahan (disetujui 2026-11-10):** mock & skrip tidak ada di repo (dulu hanya di sandbox cloud) → dibuat ulang dan di-commit: `e2e/mock-atlassian.ts` (satu server Bun meniru Jira & Bitbucket, data sintetis), `e2e/run.ts` (runner: DB `one-desk-e2e`, mock, server monolith :3100, Playwright via `playwright-core` + Chrome sistem, screenshot ke `e2e/out/`), script root `bun run e2e`. Prasyarat: `bun run build`.
**Acceptance:** Semua langkah lulus, drawer tampil dengan panel & overlay, tidak ada error JS.
**Log:** Run pertama: semua halaman render; drawer belum ber-style → diperbaiki (OD-30). Re-run dihentikan atas permintaan user; dilanjutkan setelah PLAN disetujui.
**Log (2026-11-10):** `e2e/mock-atlassian.ts`, `e2e/run.ts`, `bun run e2e` dibuat & dijalankan di laptop (Bun 1.4.4, Chrome sistem via `playwright-core`, DB `one-desk-e2e`): 10/10 langkah lulus — login dev, PGP home, buat plan & isi achievement & simpan, connections, kanban, drawer (panel di viewport + overlay, dicek visual), PR list author & reviewer, PR detail files + diff, templates, template baru; tidak ada error JS. Temuan: browser mencatat 409 di console bila Jira belum terhubung (perilaku `NOT_CONNECTED`, bukan bug); skrip menghubungkan akun dulu. Commit: lihat git log.

## Fase 7 — Pindah ke laptop & run lokal

### OD-32 · Salin source ke `~/Works/one-desk` + git init · `DONE`
**Description:** Di cloud: `git init` di `/home/claude/one-desk`, commit awal (`chore: scaffold One Desk MVP`) tanpa `node_modules`, `dist`, `.env`. Pack sebagai tar.gz (termasuk `.git`) → kirim ke `~/Works/one-desk-src.tar.gz` → extract ke `~/Works/one-desk` (PLAN.md & DESIGN.md ikut ter-update dari repo) → hapus tarball (minta izin delete; bila ditolak, biarkan dan beri tahu user). Commit dibuat di cloud karena VM laptop belum bisa menghapus lock file git sebelum izin delete diberikan. Belum push ke remote.
**Acceptance:** `ls ~/Works/one-desk` berisi apps/, package.json, bun.lock, PLAN.md, DESIGN.md; `git -C ~/Works/one-desk log` menunjukkan 1 commit; `git status` bersih.
**Log:** 2026-11-10 — 82 file ter-extract di `~/Works/one-desk`, commit awal `f9feff1`, tarball dihapus, working tree bersih. Commit kedua mencatat status tiket ini.

### OD-33 · README & panduan setup lokal · `DONE`
**Description:** `README.md`: prasyarat (Bun ≥ 1.3, Docker/OrbStack), langkah `cp .env.example .env`, `docker compose up -d db`, `bun install`, `bun run db:migrate`, `bun run dev:server` + `bun run dev:web`, akses http://localhost:5173, dev login, cara bikin Jira API token / Bitbucket token / Google SA, daftar env, catatan known issues. Postgres lokal (localhost, database `one-desk`) sebagai default; Docker hanya opsi.
**Scope tambahan (disetujui 2026-11-10):** perbaiki script root `package.json` yang rusak di Bun 1.4.4 — bentuk `bun --cwd X run ...` mencetak help tanpa menjalankan script (exit 0), diganti `bun run --cwd X ...`; script server memuat `.env` root via `--env-file=../../.env`. `DATABASE_URL` di `.env.example` → `postgres://localhost:5432/one-desk`.
**Acceptance:** Orang lain bisa menjalankan app hanya dari README; `bun run db:migrate` dari root menerapkan migration ke DB lokal; `bun run dev:server` start dan `/api/auth/config` menjawab 200; `bun run typecheck` & `bun run test` benar-benar berjalan.
**Log:** 2026-11-10 — `README.md` ditulis (Postgres lokal default, Docker opsi). Script root diperbaiki (`bun run --cwd`, `--env-file=../../.env`); `.env.example` → `postgres://localhost:5432/one-desk`. Diverifikasi di Bun 1.4.4 + Postgres lokal: `db:migrate` menerapkan 7 tabel ke DB `one-desk`, `dev:server` start (`/api/auth/config` 200, `/auth/dev-login` 302), `typecheck` lulus, `test` 11 pass, `build` sukses. Alur UI (template/plan/export) belum diuji → OD-34. Commit: lihat git log.

### OD-34 · Run lokal di laptop · `DONE`
**Description:** Di Mac user: install deps, jalankan Postgres via OrbStack/Docker, migrate, start server & web, login via dev-login, buat template dari scratch, isi plan, export Excel. (Dijalankan oleh user di terminal Mac karena VM Claude tidak punya Bun/Docker; Claude memandu.)
**Acceptance:** Flow PGP berjalan di laptop tanpa integrasi eksternal.
**Log:** 2026-11-10 — Bun 1.4.4 + Postgres lokal (DB `one-desk`), `ADMIN_EMAILS` diisi di `.env` lokal. Diuji via proxy Vite (:5173): dev login → buat template (2 item, bobot 60/40) → publish → buat plan → isi header & achievement → score 95 (55+40), total weight 100 → submit → reopen → export .xlsx (200, header/item/Total/Score ada). UI `/pgp` render PGP saya dengan score 95%, tanpa error console. Belum diuji lewat klik UI penuh (editor) → dicakup OD-31. Commit: lihat git log.

### OD-35 · Script `dev` gabungan · `DONE`
**Description:** Pastikan `bun run dev` di root menjalankan server (watch) + web (vite) paralel dengan log ber-prefix; tambah `bun run setup` (install + migrate).
**Acceptance:** Satu perintah untuk development.
**Log:** 2026-11-10 — `dev` = `bun run --parallel dev:server dev:web` (Bun 1.4, log ber-prefix `dev:server |` / `dev:web |`; sebelumnya `--filter '*'` tidak memuat `.env` root). `setup` = `bun install && bun run db:migrate`. Diverifikasi: `bun run setup` sukses, `bun run dev` → API :3000 200 dan Vite :5173 200. README diperbarui. `PLAN-1.md` (salinan usang, untracked) dihapus atas permintaan user. Commit: lihat git log.

## Fase 8 — Hardening & integrasi nyata

### OD-36 · Proteksi CSRF (Origin check) · `DONE`
**Description:** Plugin `shared/origin-guard.ts`: untuk method non-GET di `/api/*`, tolak (403) bila header `Origin`/`Referer` tidak sama dengan `APP_URL`. Tambah test.
**Acceptance:** POST dari origin lain ditolak; UI tetap jalan.
**Log:** 2026-11-10 — `shared/origin-guard.ts` (`originGuard(appUrl)`, hook `onRequest` global, didaftarkan paling awal di `app.ts`): method selain GET/HEAD/OPTIONS di `/api/*` → 403 `FORBIDDEN` bila `Origin` (fallback `Referer`) ≠ origin `APP_URL`; tanpa kedua header ditolak (fail closed), `Origin: null` ditolak; `/auth/*` tidak terpengaruh. `test/origin-guard.test.ts` (11 test: unit + app sungguhan). Helper test DB dibuat ter-cache & pool tidak ditutup per file (dua file test berbagi satu pool). `e2e/run.ts`: helper API kini mengirim `Origin` (Playwright `request.fetch` tidak mengirimnya). Diverifikasi: `bun run test` 42 pass, `typecheck` lulus, `bun run e2e` 10/10 (UI tetap jalan, termasuk Simpan/PUT dari browser), lewat proxy Vite dev: Origin :5173 → 200, origin lain → 403, tanpa Origin → 403. Catatan: akses UI langsung ke :3000 saat dev ditolak karena Origin ≠ `APP_URL` (pakai :5173). README diperbarui. Commit: lihat git log.

### OD-37 · Uji integrasi Jira nyata · `IN PROGRESS`
**Description:** Isi `JIRA_*` dengan service account; verifikasi auto-connect by email (catatan: email user bisa tersembunyi oleh privacy setting → fallback cari manual), pilih board MESIGN, kanban sprint aktif, issue detail, stats. Konfirmasi `JIRA_STORY_POINT_FIELD`.
**Acceptance:** Data sama dengan yang terlihat di Jira.
**Depends:** credential service account Jira.
**Log (2026-11-10, sebagian):** Credential memakai `ATLASSIAN_EMAIL`/`ATLASSIAN_API_TOKEN` → `env.ts` menerimanya sebagai cadangan `JIRA_*`/`BITBUCKET_*`. Dicek lewat panggilan baca-saja dari klien aplikasi (hanya jumlah/status yang dicetak): cari user by email 1 cocok (auto-connect by email berfungsi), board project MESIGN ditemukan (mis. 212 DevOps scrum; kolom To Do | In Progress | Done), 82 issue aktif milik user di board, stats JQL 3 bulan 100 resolved. **Temuan:** `customfield_10016` kosong di instance ini; field "Story Points" yang benar `customfield_10005` (terisi di 54 dari 82 issue aktif, 82 dari 100 resolved 90 hari) → `JIRA_STORY_POINT_FIELD=customfield_10005` di `.env`/`.env.example`/README. Belum: pilih board & cek kanban/issue detail/stats di UI dan cocokkan dengan Jira oleh user.

### OD-38 · Uji integrasi Bitbucket nyata · `IN PROGRESS`
**Description:** Isi `BITBUCKET_*`; verifikasi auto-connect (account_id), list PR author & reviewer, detail, diff, build status. Ukur latency fan-out reviewer; bila lambat, cache 1–2 menit.
**Acceptance:** PR sama dengan yang terlihat di Bitbucket; list < 3 detik.
**Depends:** token Bitbucket.
**Log (2026-11-10, sebagian):** Basic auth memakai email Atlassian + API token (`BITBUCKET_USERNAME` hanya untuk git, tidak dipakai). Dicek baca-saja: members workspace `jurnal` 224; auto-connect by Atlassian `account_id` cocok; PR author halaman 1 (25 PR, 2 repo) **3154 ms** (target < 3 s, cold, sedikit di atas → pertimbangkan cache 1–2 menit); fan-out reviewer 2 repo 1370 ms (20 PR perlu review); detail + diffstat + commits + comments + statuses satu PR 1638 ms, semua 200. Belum: PR list/detail/diff di UI dicocokkan dengan Bitbucket oleh user; keputusan cache.

### OD-39 · Test API (service level) · `TODO`
**Description:** `bun test` untuk PlanService/TemplateService (DB test via `DATABASE_URL` test), aturan score, submit 100%, lock saat submitted, akses owner/admin, template delete guard.
**Acceptance:** Test hijau & dijalankan di `bun run test`.

### OD-40 · Validasi Dockerfile · `TODO`
**Description:** Pastikan `bunfig.toml` & `postcss.config.cjs` ikut ter-copy, build image, jalankan dengan `docker compose --profile full up`, cek migrate + serve SPA.
**Acceptance:** App jalan di container pada :3000.

### OD-41 · Known issues UI · `DONE`
**Description:** (a) Investigasi noise `🐼 error ... 'literal'` saat build (versi panda vs Pixel). (b) Icon Pixel diambil dari `cdn.mekari.design` — pastikan reachable dari jaringan kantor. (c) UX ItemsEditor: objective/KR berulang per baris → tampilkan grouping/merge visual. (d) Responsif lebar < 1280px.
**Acceptance:** Tiap butir ditutup atau dicatat sebagai keputusan.
**Log:** 2026-11-10 — (a) bagian `Error finding real module path` **selesai**: penyebab `@mekari/pixel3-postcss` mencari `node_modules/@mekari/pixel3` relatif terhadap cwd (`apps/web`) padahal paket di-hoist ke root; ditambal dengan `bun patch` (cari ke atas dari cwd seperti Node; `patches/@mekari%2Fpixel3-postcss@1.0.16.patch` + `patchedDependencies`), `Dockerfile` menyalin `patches/` sebelum `bun install`. Diverifikasi: reinstall dari nol menerapkan patch, `bun run build` dan `bun run dev` tanpa error itu (UI 200), `test`/`typecheck`/`e2e` hijau. Belum diverifikasi: build Docker (OD-40). Commit: lihat git log.
**Log (lanjutan, 2026-11-10):**
- (a) `🐼 error ... reading 'literal'` → **keputusan: diterima, tidak ditambal.** Bukan dari kode kita atau dist Pixel: error tetap muncul walau `include` Panda diarahkan ke nol file; versi Panda dipin `1.12.0` oleh `@mekari/pixel3-postcss` (dependency eksak), rejeksi terjadi di tahap proses setelah ekstraksi dan CSS tetap lengkap (e2e: drawer/kanban/PR ber-style). Tinjau ulang saat Pixel/Panda naik versi.
- (b) Icon `cdn.mekari.design` → **keputusan: dibiarkan.** Dijangkau dari laptop dev (`/icons/goal-outline.svg` → 200; path tanpa suffix variant memang 404). Pixel menyimpan icon di localStorage dan memakai icon cadangan bila fetch gagal, jadi UI tidak rusak. Cek ulang dari jaringan production/kantor di OD-44; bila diblok, bundel icon atau proxy lewat server.
- (c) ItemsEditor: baris yang objective & KR-nya sama dengan baris di atas tampil ringkas ("↳ Objective & KR sama dengan di atas" + tombol Ubah) saat edit; otomatis kembali ke input bila salah satunya diubah; mode terkunci sudah mencetak label grup sekali; pemisah antar objective.
- (d) Responsif: diukur di 1440/1280/1024/768 px pada PGP home, plan, template editor, connections → tidak ada overflow horizontal level halaman (tabel scroll di kontainernya). Perbaikan: form header plan 4 kolom → 2 kolom di `md`, 4 kolom mulai `xl` (input tidak lagi terjepit di 768 px). **Keputusan:** lebar minimum yang didukung 1024 px; sidebar tidak dibuat collapsible (internal desktop app).
- Verifikasi: `typecheck`, `build`, `test` (51 pass), `e2e` (10/10) hijau.

### OD-42 · Review keamanan & data · `TODO`
**Description:** Checklist: tidak ada secret di repo/log, cookie `secure` di prod, akses PGP owner/admin, rate limit login, audit dependency (`bun audit` bila tersedia), masking data pribadi di log. Hasil dicatat di `SECURITY.md`.
**Acceptance:** Checklist terisi, temuan jadi tiket.

### OD-55 · Board Kanban yang bisa dipilih di Connections (project key / URL / ID) · `DONE`
**Description:** Pencarian board di Connections hanya mencocokkan nama, sehingga mencari "MESIGN" tidak menemukan board project itu (mis. board 2508 "Escape Kanban Board"). Perbaiki: cari lewat nama **atau** project key, atau tempel URL/ID board Jira (`.../boards/2508`) yang langsung memilih board tsb; tampilkan nama board terpilih (bukan "Board #id") dan tandai bila memakai board default tim (`JIRA_BOARD_ID`). Klien HTTP membaca base URL secara lazy agar bisa dites dengan server palsu.
**Acceptance:** Mencari `MESIGN` menampilkan board project itu; menempel `https://jurnal.atlassian.net/jira/software/c/projects/MESIGN/boards/2508?...` memilih board 2508; Kanban menampilkan issue user di board itu per kolom board (diverifikasi terhadap Jira sungguhan: 68 issue untuk akun user, tanpa "Other"); test hijau; typecheck, build, e2e hijau.
**Depends:** OD-21, OD-37.
**Log:** 2026-11-10 — `ConnectionsService.listBoards`: URL/ID board → board itu saja; project key (`MESIGN`) → boards project + kecocokan nama (digabung tanpa duplikat); kata biasa/ber-spasi → nama saja; pencarian project key toleran error (kata yang bukan project key dibalas 400 oleh Jira, mis. "Escape" → sebelumnya seluruh pencarian gagal; ditemukan lewat cek ke Jira sungguhan). `overview` + `boardName` & `boardIsDefault`. `integrations/http.ts` menerima `baseUrl` berupa fungsi (dibaca lazy) → klien Jira/Bitbucket bisa dites dengan server palsu. UI Connections: placeholder & petunjuk baru, tempel URL/ID langsung memilih board, nama board tampil (bukan "Board #id"), catatan "board default tim". `.env` lokal `JIRA_BOARD_ID=2508` (default tim; user yang memilih board sendiri tetap menang), `.env.example` diberi catatan. Verifikasi ke Jira sungguhan (baca-saja): `accountId` user = `assignee` di URL board; board 2508 = "Escape Kanban Board" (kanban, MESIGN) kolom Backlog | backlog | AI Ready | In Progress | AI Self Test | Human REview | BLOCKED | Done; hasil KanbanService 68 issue untuk user (backlog 17, Human REview 3, In Progress 4, Done 44 dalam 14 hari), 0 di "Other"; pencarian `MESIGN`, URL tempel, dan `Escape` benar. `test/connections-board.test.ts` (10 test, Jira palsu); e2e +1 langkah (tempel URL board) → 13/13; `typecheck`, `build`, `test` (76 pass) hijau. Catatan: kolom Done menampilkan issue resolved ≤ 14 hari (mengikuti `resolved >= -14d` di KanbanService), bukan seluruh Done.

### OD-56 · Kanban mengikuti sub-filter board Jira · `DONE`
**Description:** Board Jira punya sub-filter (`subQuery`, mis. board 2508: `created >= 2026-01-01 AND issuetype != Epic`) yang diterapkan UI Jira tetapi **tidak** oleh API `/board/{id}/issue`. Akibatnya Kanban menampilkan issue lama dan Epic yang tidak ada di board Jira (BACKLOG 17 vs 1). Terapkan `subQuery.query` dari konfigurasi board (sudah di-cache 30 menit) ke JQL Kanban untuk scope sprint maupun active.
**Acceptance:** Untuk akun user di board 2508, jumlah per kolom sama dengan UI Jira (BACKLOG 1, IN PROGRESS 3, HUMAN REVIEW 2, DONE 18 pada 2026-11-10); test memverifikasi `subQuery` masuk ke JQL (dan board tanpa `subQuery` tidak berubah); typecheck, test, e2e hijau.
**Depends:** OD-21, OD-55.
**Log:** 2026-11-10 — Penyebab: board 2508 punya `subQuery` `created >= 2026-01-01 AND issuetype != Epic`; UI Jira menerapkannya, API `/board/{id}/issue` tidak → issue lama (2023–2025) dan Epic ikut tampil (BACKLOG 17 vs 1 di Jira). Perbaikan: `KanbanService` menambahkan `subQuery.query` dari konfigurasi board (cache 30 menit; `ORDER BY` di dalamnya dibuang) ke JQL scope sprint & active; `JiraBoardConfig.subQuery`. **Jendela Done** juga disamakan: Jira menyembunyikan issue Done yang tidak di-update 7 hari → `DONE_WINDOW = 'updated >= -7d'` (sebelumnya `resolved >= -14d` = 44 issue; kandidat lain: resolved -7d = 14, updated -7d = **18** = angka Jira); label tombol jadi "Semua aktif + done 7 hari". Diverifikasi ke Jira sungguhan untuk akun user di board 2508 (baca-saja): sebelum 68 issue (backlog 17, Human REview 3, In Progress 4, Done 44); sesudah 24 issue **backlog 1, In Progress 3, Human REview 2, Done 18 = persis UI Jira**. `test/kanban-board.test.ts` (4 test, Jira palsu); `typecheck`, `build`, `test` (80 pass), `e2e` (13/13) hijau. Catatan: aturan 7 hari disimpulkan dari kecocokan angka (belum ada dokumentasi Jira yang menyebutnya); bila Jira mengubah perilakunya, ubah konstanta `DONE_WINDOW`.

### OD-57 · Kanban: sembunyikan kolom placeholder "Backlog" tanpa status · `DONE`
**Description:** Board Kanban Jira punya kolom "Backlog" tanpa status (placeholder backlog) yang tidak pernah ditampilkan UI board Jira; dashboard menampilkannya sebagai kolom "BACKLOG" kosong di samping kolom "backlog" yang sebenarnya. Sembunyikan kolom tanpa status.
**Acceptance:** Kolom Kanban di dashboard = kolom yang tampil di board Jira (board 2508: backlog, AI Ready, In Progress, AI Self Test, Human REview, BLOCKED, Done); test; typecheck, test, e2e hijau.
**Depends:** OD-56.
**Log:** 2026-11-10 — `KanbanService` hanya memakai kolom dengan ≥ 1 status (kolom "Backlog" dengan 0 status pada board 2508 dibuang); test menambahkan kolom placeholder pada konfigurasi palsu dan memastikan hasilnya hanya `To Do`, `Done`. Commit: lihat git log.

### OD-58 · Rapikan UI (satu sistem gaya) & ubah bahasa UI ke Inggris · `DONE`
**Description:** Tampilan dinilai berantakan. Temuan audit: garis tepi kartu/tabel hampir hitam (`border.default`), filter bertumpuk dengan panah dropdown di ujung kanan (PR list), toggle berupa dua tombol terpisah, konten tanpa lebar maksimum, header kolom Kanban huruf kapital rapat. Perbaikan lewat satu modul gaya bersama `lib/ui.ts` (kartu, panel, toolbar, hover lift 2px untuk kartu yang bisa diklik, border lembut), komponen `SegmentedControl`, kontainer konten ber-lebar maksimum, header halaman, dan penyesuaian per halaman — tetap memakai Mekari Pixel (`Mp*`). Seluruh teks UI (label, pesan kosong/error, toast, tanggal & waktu relatif lewat `Intl` locale `en`, `<html lang>`) dan pesan error API user-facing (`modules/org`) diubah ke Inggris. Dokumentasi/README tetap Indonesia.
**Acceptance:** Tidak ada teks Indonesia yang tersisa di UI/pesan API; border/filter/toggle/kontainer sesuai audit di semua halaman (login, PGP home, plan editor, templates, template editor, Tim/Team, Kanban + drawer, Pull Requests + detail, My Confluence, Connections) pada 1440 dan 1024 px; tanpa scroll horizontal level halaman; typecheck, build, test, e2e hijau; screenshot sebelum/sesudah dicek.
**Depends:** OD-49, OD-54, OD-56.
**Log:** 2026-11-10 — **Akar masalah:** token semantik Pixel (`border.default`, `background.surface`, `text.secondary`, …) hanya didefinisikan di bawah `[data-panda-theme=next]`, yang tidak pernah diaktifkan (`usePixelTheme().setNextTheme(true)` kini dipanggil di `main.ts`). Sebelumnya garis tepi kartu terhitung `rgb(35,41,51)` (warna teks) dan latar kartu transparan — diukur di browser; sesudah: `#dcdfe4`. **Sistem gaya:** `lib/ui.ts` (kartu putih di kanvas abu, `lift` 2px untuk kartu yang bisa diklik, panel tabel, toolbar, field ber-lebar tetap, grid), `components/SegmentedControl.vue` (menggantikan dua tombol terpisah di Kanban & PR), `PageHeader`, `AppLayout` (sidebar putih, kanvas abu, konten maks. 1320 px & di tengah, nav aktif), kolom Kanban title-case + pil jumlah, filter PR sejajar (select dibungkus slot ber-lebar tetap), logo putih, kartu login putih. **Bahasa:** seluruh UI (label, kosong/error, toast, konfirmasi, tanggal `en-GB`, waktu relatif `Intl en`, `<html lang="en">`, "My Team") dan pesan error API `modules/org` ke Inggris; data mock e2e ikut Inggris; README/PLAN tetap Indonesia. Sapuan regex kata Indonesia di `apps/web/src` & `apps/server/src`: 0 sisa. **Perbaikan lain:** grid 2 kolom memakai `minmax(0,1fr)` mulai `xl` (Connections sebelumnya 1068 px di viewport 1024), ikon Copy link `copy`. **Verifikasi:** `typecheck`, `build`, `test` (81 pass), `e2e` (13/13, selektor diperbarui ke Inggris), overflow halaman 0 dari 16 kombinasi (PGP home, plan, template, connections × 1440/1280/1024/768); screenshot dicek (Kanban, PR, Connections, PGP home, plan editor, templates, My Confluence, My Team, Login). Catatan: halaman PR detail, drawer, dan template editor baru dicek lewat e2e/drawer, bukan satu per satu secara visual penuh. Commit: lihat git log.

### OD-59 · Tabel & kontrol form seragam mengikuti contoh Mekari Pixel (Mekari Sign "All inbox") · `DONE`
**Description:** Umpan balik setelah OD-58: tabel kurang rapi dan dropdown tidak sama dengan input. Contoh yang dikirim user (Mekari Sign, juga Pixel): kanvas putih, tabel datar dengan header abu dan pemisah baris tipis, baris lega, baris filter dengan dropdown/tombol/kolom cari **satu tinggi**, kolom cari berikon. Terapkan di semua halaman.
**Acceptance:** Semua `MpTable` memakai satu gaya (header abu, bobot huruf sama, padding & pemisah sama, hover baris); semua kontrol di toolbar (dropdown, input, segmented control) berukuran sama (38 px) dan satu lebar slot; kolom cari berikon; kanvas putih; tanpa overflow halaman; typecheck, build, test, e2e hijau; screenshot dicek.
**Depends:** OD-58.
**Log:** 2026-11-10 — Diukur di browser: input dan dropdown Pixel **identik pada ukuran yang sama**; beda tampilan karena filter Kanban/PR memakai `size="sm"` (30 px, font 12 px, radius 4 px) sedangkan input lain ukuran normal (38 px, 14 px, 6 px), lebar slot 200/280 px, dan segmented control 40 px → semua toolbar kini ukuran normal, slot `ui.field` 220 px / `ui.fieldWide` 280 px, segmented 38 px. Penyebab tabel tidak seragam: Pixel merender sel body sebagai `<th>` ber-`font-weight: 600` (teks polos tebal, sel `MpText` normal) dan latar abu → `ui.table` / `ui.tableDense` (header abu `text.primary` semibold, sel normal & transparan, `padding 14px 16px`, pemisah `border.default.subtle`, hover baris, baris terakhir tanpa garis) dipasang di 6 tabel (Templates, PR, Team, Confluence, plan list di template editor, ItemsEditor); wrapper tabel datar (`ui.flat`) tanpa kartu. `SearchInput` (ikon di dalam kolom, Pixel tak punya slot ikon) di Kanban & My Confluence. Kanvas putih, kartu/panel hanya bergaris tipis (bayangan hanya saat hover). **Verifikasi:** `typecheck`, `build`, `test` (81 pass), `e2e` (13/13); screenshot PR, Kanban, Templates, plan editor dicek. Catatan: sticky kolom aksi dan ikon sort pada contoh belum ditiru.

### OD-60 · Daftar PR ringkas tanpa scroll horizontal (terinspirasi Bitbucket) · `DONE`
**Description:** Tabel PR terlalu lebar (7 kolom) sehingga kolom kanan terpotong dan perlu scroll kiri-kanan. Ganti dengan daftar baris ringkas seperti halaman PR Bitbucket: avatar penulis, judul (satu baris, ellipsis), baris meta (`repo · penulis · #id · updated …`), chip branch `sumber → tujuan` (ellipsis) dan badge key Jira, serta kolom kanan rata (avatar reviewer, approval, komentar, status). Seluruh baris adalah link (`RouterLink`, bisa difokus keyboard); di layar sempit kolom kanan turun ke bawah isi.
**Acceptance:** Tidak ada scroll horizontal di 1440, 1024, dan 768 px, juga untuk judul dan nama branch sangat panjang; klik baris membuka detail PR; e2e memeriksanya (mock berisi PR berjudul/branch panjang); typecheck, build, test, e2e hijau.
**Depends:** OD-24, OD-26, OD-59.
**Log:** 2026-11-10 — `PullRequestsView` ditulis ulang (tanpa `MpTable`): grid `avatar | isi | kolom kanan` dengan `minmax(0, 1fr)` agar teks terpotong, bukan melebar; kolom kanan `104px 40px 40px 72px` di ≥ lg agar sejajar antar baris. Mock e2e + PR berjudul 140+ karakter dan branch panjang; e2e mengukur `scrollWidth` halaman dan tiap baris di 1440/1024/768 (gagal bila ada yang melebar) dan menyimpan screenshot 1024. Screenshot dicek di 1440 dan 1024. `typecheck`, `build`, `test` (81 pass), `e2e` (13/13) hijau. Catatan: kolom state tetap ditampilkan walau filter Open (konsisten saat filter All states); Bitbucket menampilkan build status, belum ditiru di daftar (ada di halaman detail).

### OD-61 · My Confluence: daftar ringkas seperti daftar PR · `DONE`
**Description:** Tabel My Confluence (4 kolom dengan `min-width`) dinilai kurang compact dan bisa menuntut scroll horizontal. Ganti dengan baris-blok seperti daftar PR (OD-60): ikon halaman, judul (satu baris, ellipsis, link ke Confluence di tab baru), meta (`space` + `Last modified …`), dan tombol Copy link di kanan.
**Acceptance:** Tanpa scroll horizontal di 1440, 1024, dan 768 px termasuk judul sangat panjang; link tetap `http(s)` saja; pencarian & paging tetap berfungsi; e2e memeriksa lebar (mock berisi judul 130+ karakter); typecheck, build, test, e2e hijau.
**Depends:** OD-54, OD-60.
**Log:** 2026-11-10 — `ConfluenceView` ditulis ulang tanpa `MpTable` (grid `ikon | isi | aksi`, `minmax(0,1fr)`, judul `truncate` + `title`), data `data-row` untuk pemeriksaan lebar. Mock e2e + halaman berjudul panjang; e2e mengukur `scrollWidth` halaman dan tiap baris di 1440/1024/768. Screenshot dicek. `typecheck`, `build`, `test` (81 pass), `e2e` (13/13) hijau. Commit: lihat git log.

### OD-62 · Nama menu "My Pull Requests" · `DONE`
**Description:** Samakan penamaan menu: My Kanban, My Confluence, **My Pull Requests** (label sidebar, judul halaman, judul route, dan tautan kembali di detail PR).
**Acceptance:** Semua kemunculan "Pull Requests" sebagai nama menu/halaman menjadi "My Pull Requests"; typecheck, build, e2e hijau.
**Depends:** OD-26.
**Log:** 2026-11-10 — `AppLayout` (label), `router.ts` (`meta.title`), `PullRequestsView` (judul), `PullRequestDetailView` (tombol kembali). `typecheck`, `build`, `e2e` (13/13) hijau. Commit: lihat git log.

### OD-63 · Paging 20 item + footer "Rows per page / Showing / ikon" untuk PR & My Confluence · `DONE`
**Description:** Default tampil 20 item per halaman (sebelumnya 25), dengan footer paging seperti contoh Mekari Sign: "Rows per page [20 ▾]", "Showing 1-20 (of N bila total diketahui)", dan tombol sebelumnya/berikutnya berupa ikon saja. Pilihan 10/20/50. Server menerima `pagelen` (PR list; Confluence sudah ada) dan mengembalikan `total` bila diketahui. Pencarian judul di My Confluence tetap terbatas pada halaman yang dibuat user yang login (CQL `creator = accountId`); placeholder dibuat eksplisit ("Search your pages by title").
**Acceptance:** Default 20 di kedua halaman; ganti Rows per page mengembalikan ke halaman 1; Showing benar (mis. 21-40 pada halaman 2); tombol ikon nonaktif di ujung; server mengirim `pagelen` ke Bitbucket/Confluence dan CQL tetap memuat `creator = accountId` (test); e2e hijau; typecheck, build, test hijau.
**Depends:** OD-54, OD-60, OD-61.
**Log:** 2026-11-10 — Server: `PullRequestsService.list` menerima `pagelen` (default 20, maks 50) dan mengembalikan `pagelen` + `total` (author: `size` Bitbucket, `null` bila filter repo karena filter diterapkan setelah fetch; reviewer: jumlah hasil gabungan); Confluence default 25 → 20 (`creator = accountId` tetap, dites). Web: `components/PaginationBar.vue` ("Rows per page" 10/20/50, "Showing 1-20 of N", tombol sebelumnya/berikutnya berupa ikon `chevrons-left/right` dengan `aria-label`, nonaktif di ujung), dipasang di My Pull Requests & My Confluence; ganti ukuran halaman kembali ke halaman 1; placeholder cari My Confluence "Search your pages by title" (hasil pencarian tetap hanya halaman buatan user login). Verifikasi: `test/pull-requests-list.test.ts` (4 test, Bitbucket palsu: default 20, total, pagelen kustom, filter repo, paging reviewer) + test Confluence disesuaikan (limit 20); e2e memeriksa footer ("Showing 1-3 of 3", "Showing 1-4 of 4") dan bahwa request memuat `pagelen=20` (& `role=creator`); screenshot dicek. `typecheck`, `build`, `test` (85 pass), `e2e` (13/13) hijau. Catatan: paging reviewer hanya menjangkau 25 PR teratas per repo (batas lama, tidak diubah).

### OD-64 · Hapus fitur dev login · `DONE`
**Description:** Fitur `GET /auth/dev-login` (login tanpa kredensial dengan `DEV_LOGIN_EMAIL`) tidak dibutuhkan lagi karena login Mekari SSO sudah berjalan, dan jalur login tanpa-kredensial adalah risiko keamanan (juga saat dev server terjangkau dari jaringan lokal). Hapus dari server, UI, env, dan dokumen; e2e masuk lewat sesi yang dibuat langsung di database.
**Acceptance:** `/auth/dev-login` → 404; `/api/auth/config` hanya `oauthConfigured`; tombol "Dev login" hilang dari halaman login; `DEV_LOGIN_EMAIL` tidak lagi dibaca atau didokumentasikan; e2e tetap hijau tanpa jalur login khusus; typecheck, build, test hijau.
**Depends:** OD-07 (login SSO berjalan).
**Log:** 2026-11-10 — dihapus: route `dev-login` & `devLogin` di `modules/auth`, `devLoginEmail` di `config/env.ts`, tombol di `LoginView`, `DEV_LOGIN_EMAIL` di `.env.example` (dan `.env` lokal user), teks README/CLAUDE.md/DESIGN.md (README kini menyatakan login hanya lewat SSO dan memerlukan `one-desk.local`). `e2e/run.ts` membuat user + sesi lewat `AuthService.upsertUser/createSession` ke DB e2e lalu menyuntik cookie `od_session`. Test baru: `/auth/dev-login` 404 dan config tanpa saklar dev. `typecheck`, `build`, `test` (86 pass), `e2e` (13/13) hijau. Konsekuensi: untuk menjalankan app lokal wajib punya login Mekari SSO yang berfungsi (host `one-desk.local`, `MEKARI_OAUTH_*`). Commit: lihat git log.

### OD-65 · Import template dari Google Sheet publik (tanpa service account) · `TODO`
**Description:** Pengganti OD-19. Admin menempel URL Google Sheet yang dibagikan "Anyone with the link: Viewer"; server mengunduh `https://docs.google.com/spreadsheets/d/{id}/export?format=xlsx` lalu memakai alur preview `.xlsx` yang sudah ada (pilih tab, parser, warnings, review, simpan). Kelayakan diverifikasi 2026-11-10 dengan sheet publik contoh: 200, `.xlsx` valid, redirect ke `*.googleusercontent.com`; sheet privat/tidak ada → balasan HTML 400 (bukan xlsx) sehingga bisa dideteksi. Hapus `integrations/google-sheets.client.ts`, env `GOOGLE_SERVICE_ACCOUNT_JSON`, dan dependency `google-auth-library`.
Keamanan (SSRF & data): hanya host `docs.google.com` dengan id `[A-Za-z0-9_-]{20,}`; redirect hanya ke `docs.google.com`/`*.googleusercontent.com`; batas 10 MB; timeout 20 dtk; content-type harus xlsx, selain itu error jelas ("Sheet is not public: share it as Anyone with the link"). Hanya untuk sheet **template** tanpa data pribadi; sheet PGP berisi nama & penilaian karyawan (UU PDP) → jangan dipublikasikan, pakai upload `.xlsx`.
**Acceptance:** Import tab dari sheet publik menghasilkan item & warnings seperti upload xlsx; sheet privat → pesan jelas; URL non-Google/ber-host lain ditolak; redirect ke host lain ditolak; test dengan fetch palsu hijau; README memuat cara membagikan sheet; typecheck, build, test, e2e hijau.
**Depends:** OD-16, OD-19 (keputusan out of scope).

### OD-66 · Rapikan halaman plan PGP (editor item tanpa scroll horizontal) · `DONE`
**Description:** Halaman `/pgp/plans/:id` dinilai berantakan dan tidak selaras dengan halaman lain. Audit: empat kartu bertumpuk sebelum item (skor, Jira, Confluence, header), editor berupa tabel 10 kolom yang perlu scroll horizontal dengan textarea kosong besar, dan teks toast Indonesia yang terlewat ("PGP disubmit", "PGP dibuka kembali"). Dibangun di sekitar tugas halaman ini (mengisi dan memperbarui item): detail plan ringkas (skor + 4 field header) dalam satu kartu, item dikelompokkan per Objective/KR dalam kartu (edit Objective/KR di header grup berlaku untuk semua baris grup), tiap initiative satu baris (initiative, weight, achv, status, aksi) dengan blok pemantauan di bawahnya (baseline, target, current, evidence), dan panel "sumber evidence" (Jira, Confluence) di sisi kanan pada layar lebar, di bawah item pada layar sempit. Memakai gaya bersama (`ui`), kontrol ukuran seragam, tanpa dekorasi (tanpa ikon sparkle, emoji, aksen samping, glow). API komponen `ItemsEditor` (v-model, mode, lockPlanning, readonly) tetap, sehingga template editor ikut.
**Acceptance:** Tanpa scroll horizontal di 1440, 1024, dan 768 px termasuk teks sangat panjang; semua mode berfungsi (draft, submitted/terkunci, read-only leader/admin, template editor); validasi achievement ≤ weight tetap; tambah/hapus/urut item dan tambah objective/initiative berfungsi; tidak ada teks Indonesia; e2e memeriksa lebar dan alur isi-simpan; typecheck, build, test, e2e hijau; screenshot dicek.
**Depends:** OD-59, OD-54.
**Log:** 2026-11-10 — **ItemsEditor** ditulis ulang (API sama, jadi template editor ikut): baris yang objective & KR-nya sama menjadi satu kartu grup; header grup mengedit Objective/KR untuk seluruh grup dan menampilkan total weight/score grup; tiap initiative satu blok — initiative selebar kartu (tinggi textarea mengikuti panjang teks), lalu weight, achv (maks = weight, tetap `is-invalid` bila melebihi), status, dan aksi naik/turun/hapus, lalu kotak pemantauan (baseline, target, current, evidence); "Add initiative" per grup, "Add objective" di bawah, total weight & score di baris bawah; mode terkunci (submitted) dan read-only (leader/admin) memakai teks, bukan input. `RowActions` tanpa tombol tambah. **PlanEditorView:** kartu detail ringkas (skor + 4 field header) menggantikan 4 kartu bertumpuk; panel "sumber evidence" (Jira delivery per bulan, halaman Confluence dengan tombol salin) di sisi kanan pada layar ≥ 1280 px (sticky) dan di bawah item pada layar sempit; teks toast Indonesia yang terlewat diperbaiki ("PGP submitted", "PGP reopened"). Tanpa dekorasi (tanpa glow, aksen samping, emoji, ikon AI), keadaan kosong menyebut sebab dan tindakan. **Verifikasi:** e2e memeriksa tidak ada elemen yang melewati tepi di 1440/1024/768 dengan KR & initiative sangat panjang (e2e mengisi achievement lewat `data-field`), screenshot dicek (plan 1440 & 1024, template editor); `typecheck`, `build`, `test` (86 pass), `e2e` (13/13) hijau. Catatan: textarea tetap setinggi ±80 px untuk teks pendek karena tinggi minimum bawaan Pixel (override `min-height` tidak menembusnya); halaman plan dalam mode read-only/terkunci diuji lewat tipe & e2e draft, belum lewat screenshot khusus.

### OD-67 · Halaman PGP home berupa list (seperti PR dan Confluence) · `DONE`
**Description:** Kartu grid "Start a new PGP" dan "My PGP" di `/pgp` diganti list baris ringkas yang sama polanya dengan My Pull Requests dan My Confluence: ikon dalam tile bulat, judul (ellipsis), meta (badge period, jumlah item atau waktu update), dan di kanan tombol "Fill in this PGP" (template) atau skor `x% of y%` + progress + status (plan). Baris plan adalah link ke editor. Pola list dijadikan gaya bersama (`ui.list`, `ui.listRow`, `ui.tile`).
**Acceptance:** Tanpa elemen yang melewati tepi di 1440, 1024, dan 768 px; klik baris plan membuka editor; "Fill in this PGP" membuat plan; e2e memeriksa lebar; typecheck, build, test, e2e hijau.
**Depends:** OD-59, OD-60, OD-61.
**Log:** 2026-11-10 — `PgpHomeView` ditulis ulang; `lib/ui.ts` + `list`, `listRow`, `tile`; tombol "Fill in this PGP" bervarian sekunder agar baris tidak didominasi tombol solid. Panel direct leader/report di atasnya tidak diubah. e2e menambah pemeriksaan lebar halaman `/pgp` di 1440/1024/768 dan screenshot. `typecheck`, `build`, `test` (86 pass), `e2e` (13/13) hijau. Catatan: daftar tidak berpaging (jumlah plan per orang kecil); PR dan Confluence belum dipindah ke `ui.list` bersama (masih definisi lokal yang setara). Commit: lihat git log.

## Fase 11 — Evidence otomatis dari Jira & Confluence

> **Dasar (2026-11-10):** dua file PGP milik user dibaca (struktur & pola saja; isi pribadi tidak disalin). Kolom evidence = kolom K "Hyperlink to key result, initiative or other evidence" (sel berisi label dengan hyperlink tersembunyi + beberapa daftar URL multi-baris). Tab Q3-2026 berisi: (a) **epic Jira** satu per baris initiative (8 key `MESIGN-N`, judul diawali `26Q3 ESC …`) di KR "Deliver End-to-End Initiatives as PIC" dan "Tech Debt"; (b) **halaman Confluence** space MESign (17 halaman; RFC, RCA, dokumen teknis, AI-assisted review) dalam daftar `- <url>` per sel; (c) **statistik delivery** per bulan ("Juli 2026 (162 SP, 62 tickets)") dengan link pencarian Jira, dan Current Value berupa angka hasil hitung Jira (rata-rata SP per sprint, jumlah bug per prioritas, lead time, jumlah RCA). **Uji kelayakan** terhadap Jira/Confluence sungguhan (periode 2026-07-01..2026-09-30, baca-saja): query "epic assignee = saya, aktif/resolved di Q3" menemukan **6 dari 8** key di sheet **tanpa epic ekstra** (presisi 100%); 2 yang terlewat: satu epic tanpa assignee, satu epic assigned ke saya tetapi resolved setelah akhir kuartal; query halaman Confluence (creator/contributor di Q3) menemukan **14 dari 17** halaman yang dipakai sheet dari 35 kandidat (RCA 20, RFC 3, lainnya 12). Kesimpulan: deteksi otomatis layak sebagai **saran yang dikonfirmasi user** (bukan isi otomatis tanpa konfirmasi); hasilnya menjadi baris evidence biasa yang tetap bisa diedit.

> **Keputusan user (2026-11-10):** alur template admin **dibiarkan**. "Create" menawarkan dua pilihan: **dari template** (alur sekarang) atau **dari upload Excel** (baru, tanpa admin). Pembuatan template juga mendukung upload Excel dengan pengekstrak yang **sama** seperti Create-from-upload. Satu PGP per user **per (tahun, kuartal)**. Sesudah dibuat, user diarahkan ke halaman detail plan, yang menampilkan saran: epic Jira periode itu, halaman Confluence 3 bulan terakhir, story point & tiket per bulan (klik → detail), dan team delivery rate per label (diisi manual).
> **ASSUMPTION (belum dikonfirmasi user, ubah bila salah):** (1) isi yang diimpor dari xlsx = planning selalu, plus progress & evidence **bila ada** dengan centang di preview untuk mematikannya; (2) team delivery rate memakai satu label yang diisi manual dan **menampilkan dua angka** (berdasarkan jumlah tiket dan berdasarkan story point), untuk seluruh tim, bukan hanya milik user; "total" = tiket berlabel yang aktif di periode (`created <= akhir AND (belum resolved OR resolved >= awal)`), "selesai" = yang resolved dalam periode.
> **Urutan kerja:** OD-71 → OD-72 → OD-73 → OD-68 → OD-69 → OD-70.

### OD-71 · Plan per (tahun, kuartal): skema & aturan unik · `DONE`
**Description:** Tambah `year` dan `quarter` pada `pgp_plans`; isi dari `template.period` (`YYYY-Qn`) untuk data yang ada; `template_id` menjadi nullable (plan hasil upload tidak punya template); tambah `source_ref` (mis. `nama-file.xlsx#tab`). Unik `(user_id, year, quarter)` — satu PGP per user per kuartal, juga untuk plan dari template (`PlanService.create` → 409 `PERIOD_EXISTS` dengan `existingPlanId`). `period` template divalidasi `^20\d{2}-Q[1-4]$` saat dibuat/diubah (template lama yang tidak sesuai dilaporkan di migrasi, bukan diperbaiki diam-diam). Migration baru `0002_plan_period` (jangan ubah migration lama); bila ada duplikat (user, tahun, kuartal) di data lama, migrasi berhenti dengan pesan yang menyebut baris yang bentrok. API/UI daftar plan memakai `year`/`quarter`; unique lama `(template_id, user_id)` dipertahankan.
**Acceptance:** Migrasi jalan di DB berisi data (backfill benar, duplikat memicu pesan jelas); membuat plan kedua di kuartal yang sama (dari template mana pun) → 409 dengan id plan yang ada dan UI menampilkan link "Open existing PGP"; test service (unik per user, user lain bebas, plan tanpa template); e2e/test data memakai periode berbeda per eksekusi atau membersihkan data; typecheck, build, test, e2e hijau.
**Depends:** OD-45 … OD-47 (aturan akses plan tidak berubah).
**Log:** 2026-11-10 — Migrasi `0002_plan_period` (kolom `year`, `quarter`, `source_ref`; `template_id` nullable; CHECK kuartal 1–4; unik `(user_id, year, quarter)`; backfill dari `template.period`, berhenti dengan pesan bila periode salah format atau ada duplikat). `PlanService.create` → 409 `PERIOD_EXISTS` + `existingPlanId` (termasuk balapan request); periode template divalidasi `YYYY-Qn`; detail/daftar/export/tim memakai `period` dan `title` plan; `/pgp` menyembunyikan template yang kuartalnya sudah ada dan menampilkan link "Open existing PGP" pada 409. Verifikasi: `bun run typecheck`, `bun run test` (93 lulus, termasuk `plan-period.test.ts`), `bun run build`, `bun run e2e` 13/13 (DB e2e di-drop dan dibuat ulang atas izin user karena berisi plan duplikat dari run lama). Commit: lihat git log.

### OD-72 · Create PGP: pilih "From template" atau "Upload Excel" · `DONE`
**Description:** Tombol **Create PGP** di `/pgp` membuka `/pgp/new` dengan dua pilihan: **From template** (daftar template published seperti sekarang; periode dari template) dan **Upload Excel**. Upload Excel: pilih file `.xlsx` (maks 10 MB) → pilih tab (default tebakan dari nama tab/meta, mis. "Q3 - 2026") → preview yang bisa diedit (item, warnings) → isi **tahun & kuartal** (default dari tab/meta, bisa diubah) dan header (Division, SBU, Direct Leader dari meta sheet) → **Create** → redirect ke `/pgp/plans/:id`. Server: `POST /api/pgp/plans/import/xlsx/preview` (boleh untuk member, bukan hanya admin; hanya membaca dan tidak menyimpan) dan `POST /api/pgp/plans/from-xlsx` (`year`, `quarter`, header, items, `sourceRef`) → 409 `PERIOD_EXISTS` bila (user, tahun, kuartal) sudah ada. Parser diperluas membaca kolom progress/evidence (baseline, target, current, achievement, status, dan **hyperlink Excel** di kolom evidence, termasuk target yang tersembunyi di balik label) dan mengembalikannya terpisah dengan penanda `hasProgress`/`hasEvidence`; preview punya centang "Also import progress and evidence" (default hidup bila ada). Validasi: bobot, achievement ≤ weight, link evidence hanya `http(s)`.
**Acceptance:** Upload `.xlsx` berformat PGP (tab Q3-2026 milik user dan satu tab template kosong) → preview benar (item, bobot, header, evidence dari hyperlink); membuat plan lalu redirect ke detailnya; kuartal yang sama dua kali → pesan + link plan yang ada; centang progress/evidence menentukan isi plan; file bukan xlsx/terlalu besar/tanpa header ditolak dengan pesan jelas; test parser (fixture sintetis, termasuk hyperlink tersembunyi & sel merge), service, dan e2e (upload → preview → create → redirect); tanpa scroll horizontal di 1440/1024/768; typecheck, build, test, e2e hijau.
**Depends:** OD-71, OD-16.
**Log:** 2026-11-10 — `/pgp` punya tombol Create PGP → `/pgp/new` dengan dua pilihan (daftar template yang pindah dari home, dan Upload Excel). Upload: preview yang bisa diedit (tab, tahun & kuartal dari nama tab, header dari meta sheet, item lewat `ItemsEditor`), centang "Also import progress and evidence", lalu Create → redirect ke `/pgp/plans/:id`; kuartal yang sama → pesan + link "Open existing PGP". Server: `POST /api/pgp/plans/import/xlsx/preview` (member, baca saja; tab bawaan = tab terbaru yang sudah berisi progress) dan `POST /api/pgp/plans/from-xlsx` (409 `PERIOD_EXISTS`, hanya link http(s) disimpan, achievement ≤ weight). Parser membaca kolom evidence (URL di teks dan hyperlink Excel tersembunyi, termasuk teks richText) dan status sheet dinormalisasi ke enum. Verifikasi: `bun run typecheck`, `bun run test` (101 lulus; `plan-import.test.ts` dengan workbook sintetis berisi sel merge, hyperlink tersembunyi, link `javascript:` yang ditolak, tab kosong vs terisi), `bun run build`, `bun run e2e` 14/14 (upload → preview → create → redirect → upload ulang ditolak; overflow 1440/1024/768 untuk Create PGP dicek pada jalur template). Dicek terhadap `Dwi Heru Waspodo Growth Plan.xlsx` (baca saja, lewat service): tab bawaan = Q3 - 2026 (2026 Q3), 29 item, 19 berstatus, 13 dengan link evidence, peringatan "Total weight is 95%" (angka dari sheet); tab Q4 - 26 = 18 item, 100%, tanpa progress. Belum dicoba lewat browser dengan file itu. Commit: lihat git log.

### OD-73 · Template editor memakai pengekstrak & komponen upload yang sama · `DONE`
**Description:** Tab "Upload Excel (.xlsx)" di editor template (admin) dipindah ke komponen bersama `XlsxImport` yang juga dipakai OD-72, dengan endpoint/parser yang sama (tab, preview, warnings, tebakan periode). Pada template hanya kolom planning yang diambil (progress/evidence diabaikan). Import Google Sheet (OD-19) tetap out of scope; OD-65 tetap usulan.
**Acceptance:** Membuat template dari upload menghasilkan item & periode yang sama dengan pratinjau di Create-from-upload untuk file yang sama; tidak ada duplikasi kode upload/preview antara dua alur; test & e2e hijau.
**Depends:** OD-72.
**Log:** 2026-11-10 — Komponen bersama `XlsxImport.vue` (pilih file, pilih sheet, baca lewat loader) dan tipe `lib/xlsx-import.ts` dipakai Create PGP dan tab Upload Excel di editor template. Endpoint template `POST /api/pgp/templates/import/xlsx/preview` sekarang memanggil `PlanImportService.preview` yang sama (`TemplateService.previewXlsx` dihapus), jadi tab bawaan, tebakan periode, dan hasil parse identik; template hanya mengambil kolom planning dan mengisi periode dari nama tab. Import Google Sheet (OD-19) tidak berubah. Verifikasi: `bun run typecheck`, `bun run test` (101 lulus), `bun run build`, `bun run e2e` 15/15 (langkah baru: file xlsx yang sama diunggah di editor template → periode 2025-Q1, item 60/40 sama dengan Create PGP). Commit: lihat git log.

### OD-68 · API saran evidence per plan (epic, Confluence, story point per bulan, delivery rate) · `DONE`
**Description:** Semua endpoint hanya untuk **owner plan** (403 untuk leader/admin karena memakai akun Atlassian si owner), mengembalikan **metadata saja** (key/judul/status/space/tanggal/url; tanpa isi atau deskripsi), memakai `year`/`quarter` plan (OD-71):
- `GET /api/pgp/plans/:id/suggestions` →
  - `epics`: epic Jira yang dikerjakan di kuartal itu = (1) epic `assignee = akun user` yang aktif pada kuartal (`created <= akhir AND (belum resolved OR resolved >= awal)`) **ditambah** (2) epic induk (`parent`) dari issue user yang resolved di kuartal (menangkap epic tanpa assignee). Tiap item: `key`, `summary`, `status`, `statusCategory`, `resolvedAt`, `url`, `source: 'assigned' | 'child'`; judul berawalan `{YY}Q{n}` diurutkan lebih dulu.
  - `pages`: halaman Confluence yang user buat/kontribusikan dalam **3 bulan terakhir** (relatif ke hari ini, sesuai permintaan), dengan `kind` dari judul saja (`rfc`, `rca`, `tech-doc`, `other`), maks 25.
  - `delivery`: untuk tiap bulan dalam kuartal: `month`, `storyPoints`, `tickets` (issue `assignee = user`, `resolutiondate` dalam bulan itu, story point > 0), `jql`, dan `url` pencarian Jira berformat `{JIRA_BASE_URL}/issues?jql=…` seperti contoh user (JQL memakai id field story point dari env agar tidak ambigu).
  - bila satu sumber gagal (mis. Confluence), bagian itu kosong dengan `errors.<sumber>`; sumber lain tetap dikembalikan.
- `GET /api/pgp/plans/:id/suggestions/delivery/:month` (`YYYY-MM` dalam kuartal) → daftar issue bulan itu (`key`, `summary`, `storyPoints`, `resolvedAt`, `url`, maks 100) untuk modal detail.
- `GET /api/pgp/plans/:id/suggestions/delivery-rate?label=…` → `{ label, from, to, tickets: { done, total, rate }, storyPoints: { done, total, rate }, jql }` untuk seluruh tim (lihat ASSUMPTION di atas); label kosong → 400.
Cache 5 menit per (user, plan, query); `NOT_CONNECTED` bila Jira belum terhubung; 503 bila Atlassian belum dikonfigurasi. `KanbanService.monthlyStats` diperumum menerima rentang tanggal (stats lama tetap).
**Acceptance:** Test dengan Jira & Confluence palsu: rentang kuartal benar untuk Q1–Q4 dan tahun berbeda; JQL memuat `accountId` user; gabungan epic assigned + child tanpa duplikat; klasifikasi `kind`; jendela 3 bulan Confluence; `jql`/`url` bulan benar dan ter-encode; detail bulan; rumus delivery rate (selesai/total, pembagi nol → `rate: null`); cache; owner-only; degradasi saat satu sumber error; tidak ada isi/excerpt yang bocor. Uji baca-saja terhadap Jira/Confluence sungguhan untuk Q3-2026: epic ≥ 7 dari 8 dan halaman ≥ 14 dari 17 pada sheet user, dan SP/tiket Juli 2026 sama dengan hasil JQL contoh user. typecheck, build, test, e2e hijau.
**Depends:** OD-71, OD-37, OD-54.
**Log:** 2026-11-11 — `SuggestionsService` (`pgp/suggestions.service.ts`) dan tiga endpoint owner-only: `GET /api/pgp/plans/:id/suggestions` (epics, pages, delivery per bulan + `errors.<sumber>`), `.../suggestions/delivery/:month` (detail tiket), `.../suggestions/delivery-rate?label=` (tim, per tiket dan per SP, `rate: null` bila total 0, `truncated` bila kena batas 1000). Epic = assigned ke user, dibuat sebelum akhir kuartal, `updated >=` awal kuartal, dan terbuka atau resolved sejak awal kuartal; ditambah epic induk dari issue yang user resolve di kuartal (dedupe, berawalan `26Q3` lebih dulu). Pages = contributor 92 hari terakhir (maks 25), `kind` dari judul saja. JQL SP memakai `cf[10005]`. Cache 5 menit, 403 bagi selain owner, NOT_CONNECTED, 503 bila Atlassian belum dikonfigurasi. Helper `quarterRange`/`monthRange`; `jira.baseUrl` kini getter. `KanbanService.monthlyStats` tidak diubah (rentang kuartal dihitung di service baru). Verifikasi: `bun run typecheck`, `bun run test` (112 lulus; `suggestions.test.ts` dengan Jira+Confluence palsu: rentang Q1–Q4 dan batas tahun, JQL memuat accountId, epic assigned+child tanpa duplikat, klasifikasi, jendela 92 hari, detail bulan, rumus rate, cache, owner-only, degradasi satu sumber, tanpa body/excerpt), `bun run e2e` 15/15. Cek baca-saja terhadap Jira/Confluence sungguhan (Q3-2026, akun user): SP/tiket Juli = **162 SP / 62 tiket** (sama dengan JQL contoh user), Agustus 51/20, September 37/18; epic 14 saran (7 assigned + 7 child) dengan 6 dari 7 epic yang di-link di sheet (MESIGN-19558 tidak terdeteksi: tidak di-assign ke user dan tidak ada child yang user resolve di kuartal itu); halaman Confluence sejak awal kuartal 47 kandidat dengan 3 dari 5 halaman yang di-link di sheet (endpoint sendiri memakai 3 bulan terakhir dari hari ini sesuai permintaan, sehingga halaman Q3 lama bisa keluar jendela). Target "≥7 dari 8 epic, ≥14 dari 17 halaman" tidak tercapai karena sheet kini hanya memuat 7 link epic dan 5 link halaman sebagai URL; angka itu dihitung dari judul pada validasi awal. Commit: lihat git log.

### OD-69 · Panel saran di halaman detail plan (konfirmasi, tetap bisa diedit) · `TODO`
**Description:** Di `/pgp/plans/:id` (owner), panel saran menggantikan aside "Evidence sources" (di kanan ≥ 1280 px, di bawah item pada layar sempit) dengan empat bagian:
- **Jira epics (periode ini):** nama + link, status; tombol **Add to…**.
- **Confluence (last 3 months):** judul + space + tanggal + `kind`; **Add to…** dan Copy link.
- **Story points & tickets per month:** satu baris per bulan kuartal (`July 2026 — 162 SP · 62 tickets`); klik membuka **modal detail** berisi daftar tiket bulan itu (key, ringkasan, SP, tanggal resolved) dengan tombol **Open in Jira** (URL JQL) dan **Add link to…**.
- **Team delivery rate:** isian **label** (manual; diingat per browser), menampilkan rate berdasarkan tiket dan berdasarkan story point beserta pembilang/penyebut dan link JQL.
**Add to…** memilih baris (daftar initiative, dikelompokkan per KR) lalu menambahkan URL ke Evidence baris itu tanpa duplikat; untuk bulan/delivery rate juga **Use as current value** (mengisi Current hanya bila kosong). Tidak ada isi otomatis tanpa klik; semuanya tampil di kolom Evidence/Current dan bisa diedit/dihapus. Aksi grup **Add initiatives from my Jira epics** (daftar centang untuk dikonfirmasi): membuat baris initiative untuk epic yang belum ada (dedupe lewat URL di evidence mana pun) dengan initiative = judul epic, evidence = URL epic, status dari Jira (Done → Done, In Progress → On Track, lainnya → Not Started). Keadaan kosong/error menyebut sebab dan tindakan ("Jira belum terhubung → Connections"; "Confluence tidak dapat dimuat, coba lagi").
**Acceptance:** Tiap bagian tampil dari data OD-68; modal bulan memuat tiket dan link Jira yang benar; Add to… menambah URL tanpa duplikat dan menandai dirty (menunggu Save); aksi epic membuat baris benar dan tidak duplikat saat diulang; label delivery rate dapat diubah dan hasilnya diperbarui; e2e (mock) mencakup klik bulan → modal, Add to… → Save, dan Add initiatives from epics; tanpa scroll horizontal di 1440/1024/768; typecheck, build, test, e2e hijau.
**Depends:** OD-68, OD-66.

### OD-70 · Current Value otomatis dari Jira (riset + metrik sederhana) · `TODO`
**Description:** Banyak Current Value di sheet adalah angka hasil hitung Jira: rata-rata story point per sprint ("AVG 44"), jumlah bug per prioritas ("P2: 7"), jumlah tiket resolved/bulan, lead time median ("3d 7h"), jumlah RCA. Riset kecil + implementasi metrik yang bisa dihitung dengan JQL yang pasti (SP & tiket per bulan dan delivery rate sudah ada di OD-68; tambahkan jumlah bug per prioritas bila label/field-nya jelas, rata-rata SP per sprint) dan tampilkan sebagai **Use as current value** di panel OD-69. Metrik yang bergantung pada definisi internal (carry-over, DORA, SLA) hanya didokumentasikan, tidak ditebak.
**Acceptance:** Daftar metrik yang didukung beserta JQL/rumusnya tercatat; tiap metrik diverifikasi terhadap angka di sheet Q3 user (selisih dicatat); yang tidak bisa dihitung pasti ditandai sebagai keputusan; test dan e2e hijau.
**Depends:** OD-69.

### OD-74 · Item PGP dikelompokkan per objective dalam accordion · `TODO`
**Description:** Di `ItemsEditor` (dipakai `/pgp/new`, editor plan, dan editor template) item dikelompokkan **per objective**: tiap objective jadi satu panel accordion, di dalamnya key result (KR) sebagai sub-kelompok dengan initiative-nya seperti sekarang. Header panel (satu baris, bisa diklik, tombol dengan `aria-expanded`) menampilkan chevron, nama objective, jumlah KR dan initiative, Weight total, dan Score (mode plan); header menyatukan objective yang sama walau barisnya tidak berurutan hanya bila urutan data memang berurutan (urutan baris tidak diubah diam-diam). Tombol **Expand all / Collapse all**. Default: semua terbuka bila ≤ 3 objective, selain itu hanya yang pertama terbuka; objective yang berisi input tidak valid (achievement > weight, objective kosong) otomatis terbuka. Keadaan buka/tutup hanya di memori halaman (tidak disimpan ke server). Aksi yang sudah ada (edit objective/KR, Add initiative, Add objective, pindah, hapus, total weight) tetap berfungsi; Add objective membuka panel barunya dan memberi fokus ke inputnya. Perilaku mobile: tidak ada scroll horizontal.
**ASSUMPTION (belum dikonfirmasi):** "per objective" berarti accordion tingkat objective dengan KR di dalamnya (bukan accordion per pasangan objective+KR seperti kartu sekarang).
**Acceptance:** Daftar item di `/pgp/new` (hasil upload), `/pgp/plans/:id` (draft dan submitted/readonly), dan editor template tampil sebagai accordion per objective dengan header ringkasan yang benar (jumlah, weight, score); expand/collapse tunggal dan semua berfungsi lewat mouse dan keyboard (Enter/Space); objective tidak valid terbuka otomatis; mengedit, menambah, memindah, dan menghapus tetap menyimpan data yang sama (tidak ada perubahan payload API); tanpa scroll horizontal di 1440/1024/768; e2e mencakup collapse/expand dan menambah objective; typecheck, build, test, e2e hijau.
**Depends:** OD-72.

## Fase 10 — Confluence (read-only)

### OD-54 · Confluence: My Confluence + evidence PGP · `IN PROGRESS`
**Description:** Memakai service account Atlassian yang sama (Basic auth, `{JIRA_BASE_URL}/wiki`). Data difilter dengan `accountId` Atlassian user (dari koneksi Jira), **hanya metadata** (judul, space, tanggal, link; tanpa isi/excerpt halaman) dan dirender sebagai teks.
- `integrations/confluence.client.ts` + `modules/confluence/{index,service,model}.ts`, daftarkan di `app.ts`: `GET /api/confluence/pages?role=creator|contributor&days=&q=&page=` (CQL `type=page AND creator|contributor = "<accountId>"`, cache 60 dtk, 25/halaman). 409 `NOT_CONNECTED` bila Jira belum terhubung, 503 bila belum dikonfigurasi.
- Menu **My Confluence** (`/confluence`): halaman yang pernah **dibuat user** (semua waktu), cari judul, paging, link buka & salin link.
- **Evidence PGP**: kartu "Dokumen Confluence (90 hari terakhir)" di editor plan (hanya owner) berisi halaman yang user buat/edit, dengan Salin link untuk ditempel ke kolom Evidence.
- Mock `/wiki/rest/api/search` di `e2e/mock-atlassian.ts` + langkah e2e.
**Acceptance:** Data cocok dengan Confluence (dicek user); user lain tidak bisa melihat halaman user ini; tanpa Jira terhubung → pesan "belum terhubung"; test server (CQL memuat accountId, pemetaan, paging, error) hijau; typecheck, build, test, e2e hijau.
**Depends:** OD-37 (credential Atlassian), OD-10 (koneksi Jira).
**Log:** 2026-11-10 — Server: `integrations/confluence.client.ts` (Basic auth service account, `{JIRA_BASE_URL}/wiki`), `modules/confluence/{index,service,model}.ts`, `GET /api/confluence/pages?role&days&q&page&pagelen` (CQL difilter `accountId` user, hanya `id/title/space/url/lastModified`, excerpt/isi tidak pernah dikembalikan, cache 60 dtk, `NOT_CONNECTED` bila Jira belum terhubung, 503 bila belum dikonfigurasi; nilai `q` di-escape). Web: menu **My Confluence** (`/confluence`: halaman yang dibuat user, cari judul, paging, link & Salin link), kartu "Dokumen Confluence kamu (90 hari)" di editor plan untuk owner, `lib/clipboard.ts` (fallback `execCommand` karena `http://one-desk.local` bukan secure context sehingga `navigator.clipboard` tidak ada). Verifikasi: `test/confluence.test.ts` (9 test, server Atlassian palsu: CQL & accountId, pemetaan, excerpt tak bocor, role/days, escape, paging, cache, tanpa koneksi, tak terkonfigurasi, 401); mock `/wiki/rest/api/search` + 2 langkah e2e (kartu evidence & My Confluence, termasuk cek isi halaman tidak muncul) → `e2e` 12/12; CQL yang sama dijalankan ke Confluence sungguhan: creator 212 halaman, contributor 90 hari 28, pencarian judul & escape kutip valid (200, 220–300 ms); `typecheck`, `build`, `test` (66 pass) hijau. **Belum:** user mencocokkan daftar di UI dengan Confluence-nya (acceptance 1). Catatan: ikon sidebar `draft` (Pixel tidak punya `document`).

## Fase 9 — Rilis MVP internal

### OD-43 · UAT dengan tim Mekari Sign · `TODO`
**Description:** 2–3 engineer + leader mencoba isi PGP Q4-26 (import dari sheet asli), kanban, PR selama 1 minggu; kumpulkan feedback jadi tiket.
**Acceptance:** Feedback terdokumentasi; bug kritikal = 0.

### OD-44 · Deploy internal · `TODO`
**Description:** Tentukan hosting internal (DESIGN §9.5), set env production, OAuth redirect URI production, backup DB.
**Acceptance:** App bisa diakses tim via URL internal dengan login Mekari.

---

## Post-MVP backlog (belum dijadwalkan)
- Skip-level view, snapshot leader per plan per quarter, pre-provision user via email, sinkron struktur dari Talenta.
- Approval / komentar PGP oleh leader.
- Aksi tulis ke Jira (transition) / Bitbucket (approve).
- Auto-fill KR dari metrik (DORA, story point, PagerDuty).
- Notifikasi Slack menjelang akhir quarter.
