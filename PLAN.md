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
| 1. Auth (Mekari OAuth2) | OD-05 … OD-07, OD-51 … OD-53 | DONE · OD-07 BLOCKED (butuh info SSO) · OD-51 … OD-53 DONE |
| 2. Connect Jira & Bitbucket | OD-08 … OD-11 | DONE (diverifikasi dengan mock) |
| 3. PGP | OD-12 … OD-20 | DONE · OD-19 IN PROGRESS (butuh Google SA) |
| 3b. Direct leader & PGP bawahan (2 arah) | OD-45 … OD-50 | DONE |
| 4. Kanban | OD-21 … OD-23 | DONE (mock) |
| 5. Pull Requests | OD-24 … OD-26 | DONE (mock) |
| 6. Frontend shell & polish | OD-27 … OD-31 | DONE |
| 7. Pindah ke laptop & run lokal | OD-32 … OD-35 | OD-32 … OD-35 DONE |
| 8. Hardening & integrasi nyata | OD-36 … OD-42 | TODO |
| 9. Rilis MVP internal | OD-43 … OD-44 | TODO |
| 10. Confluence (read-only) | OD-54 | IN PROGRESS |

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

### OD-19 · Import dari Google Sheet (Sheets API) · `IN PROGRESS`
**Description:** Kode sudah ada: `integrations/google-sheets.client.ts` + `GET /templates/import/sheet/tabs?url=` dan `/sheet/preview?url=&tab=`. Sisa pekerjaan: buat service account Google (Sheets API readonly), isi `GOOGLE_SERVICE_ACCOUNT_JSON`, share sheet contoh (Viewer), uji import tab "Q4 - 26" dan "Q3 - 2026"; perbaiki parser bila format tab lama berbeda (mis. Q3 yang kolom Objective berisi label pendek "DORA/SLO").
**Acceptance:** Import kedua tab menghasilkan item dengan total weight sesuai sheet, warnings masuk akal.
**Depends:** credential Google (user/admin).

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
