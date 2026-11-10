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
| 1. Auth (Mekari OAuth2) | OD-05 … OD-07 | DONE · OD-07 BLOCKED (butuh info SSO) |
| 2. Connect Jira & Bitbucket | OD-08 … OD-11 | DONE (diverifikasi dengan mock) |
| 3. PGP | OD-12 … OD-20 | DONE · OD-19 IN PROGRESS (butuh Google SA) |
| 3b. Direct leader & PGP bawahan (2 arah) | OD-45 … OD-50 | TODO |
| 4. Kanban | OD-21 … OD-23 | DONE (mock) |
| 5. Pull Requests | OD-24 … OD-26 | DONE (mock) |
| 6. Frontend shell & polish | OD-27 … OD-31 | DONE · OD-31 IN PROGRESS |
| 7. Pindah ke laptop & run lokal | OD-32 … OD-35 | OD-32, OD-33 DONE · sisanya TODO |
| 8. Hardening & integrasi nyata | OD-36 … OD-42 | TODO |
| 9. Rilis MVP internal | OD-43 … OD-44 | TODO |

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
**Description:** Daftarkan client One Desk di Mekari SSO; isi `MEKARI_OAUTH_AUTHORIZE_URL/TOKEN_URL/USERINFO_URL/CLIENT_ID/CLIENT_SECRET/SCOPE`, redirect URI `{APP_URL}/auth/callback`. Cek bentuk userinfo; bila field berbeda, sesuaikan `AuthService.fetchProfile` (mapping `pick(...)`). Set `MEKARI_OAUTH_PKCE=false` bila SSO tidak mendukung PKCE.
**Acceptance:** Login dengan akun @mekari.com sungguhan berhasil di lokal.
**Blocked by:** butuh endpoint + client credential dari tim Mekari SSO (lihat DESIGN §9.1). Sementara pakai `DEV_LOGIN_EMAIL` (lokal saja).

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

### OD-45 · Schema reporting line · `TODO`
**Description:** Di `apps/server/src/db/schema.ts`:
- `users`: tambah `managerId uuid references users.id on delete set null` + index `users_manager_idx` + check constraint `manager_id <> id`.
- Tabel baru `reporting_requests`: `id uuid pk`, `reportId uuid not null → users.id on delete cascade`, `leaderId uuid not null → users.id on delete cascade`, `requestedBy uuid not null → users.id on delete cascade`, `createdAt timestamptz default now()`. Unique index pada `report_id` (satu pending per bawahan). Check `report_id <> leader_id` dan `requested_by in (report_id, leader_id)`.
- Relation Drizzle: `users.manager` / `users.reports` (self-relation), `reportingRequests.report|leader`.
Generate migration `bunx drizzle-kit generate --name reporting_line` → `drizzle/0001_reporting_line.sql`, jalankan `bun run db:migrate`.
**Acceptance:** Migration jalan di DB yang sudah berisi data; `bun run typecheck` lulus; insert manager = diri sendiri dan `requested_by` pihak ketiga ditolak DB.
**Depends:** OD-34 (DB lokal jalan).

### OD-46 · Module `org` (API reporting line, 2 arah) · `TODO`
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

### OD-47 · Aturan akses plan untuk leader · `TODO`
**Description:** Di `PlanService.get` (`modules/pgp/plan.service.ts`) izinkan mode `read` bila `plan.user.managerId === viewer.id` (relasi **aktif**; request pending tidak memberi akses); `canEdit` tetap hanya owner. Export Excel ikut aturan yang sama (memakai `get`). Tambahkan field `viewerRole: 'owner' | 'leader' | 'admin'` di response. Saat `PlanService.create`, prefill `directLeader` dari nama manager aktif bila belum ada dari plan sebelumnya.
**Acceptance:** Leader aktif bisa GET & export plan bawahan; PUT/PATCH/submit oleh leader → 403; pihak dengan request pending → 403; user lain → 403.
**Depends:** OD-46.

### OD-48 · UI dashboard: atasan & direct report (2 arah) · `TODO`
**Description:** Komponen baru `components/ReportingLinePanel.vue` (Mekari Pixel), dipasang di `views/pgp/PgpHomeView.vue`:
- **Banner permintaan masuk** (`incoming`): "X mengajukan kamu sebagai direct leader" (`as_leader`) atau "X ingin menambahkan kamu sebagai direct report" (`as_report`), tombol *Terima* / *Tolak*.
- **Direct leader saya**: nama leader aktif + tombol *Lepas*; bila belum ada → input cari user + tombol *Ajukan sebagai atasan*; permintaan keluar tampil dengan badge "Menunggu konfirmasi" + *Batalkan*.
- **Direct report saya**: daftar aktif (tombol *Lepas*) + permintaan keluar (badge "Menunggu konfirmasi" + *Batalkan*) + input cari user + tombol *Tambah sebagai bawahan*.
Toast sukses/error via `notifySuccess/notifyError`; refresh `GET /api/org/me` setelah tiap aksi.
**Acceptance:** Seluruh alur OD-46 (kedua arah) bisa dilakukan dari UI tanpa curl; vue-tsc & build lulus.
**Depends:** OD-46.

### OD-49 · Halaman "Tim Saya" · `TODO`
**Description:** Route baru `/team` (`views/team/TeamView.vue`) + menu sidebar "Tim Saya" (tampil bila user punya ≥ 1 direct report aktif — tambah `reportCount` di `GET /api/auth/me`). Isi: pilih period (default period template published terbaru), tabel ala "Team Members / Score" di sheet: nama, status PGP (Belum mulai / Draft / Submitted), score, total weight, terakhir update, link "Lihat" → `/pgp/plans/:id` (read-only, banner "Kamu melihat PGP {nama} sebagai direct leader") dan tombol Export.
**Acceptance:** Leader melihat semua direct report aktif dengan status benar; plan bawahan terbuka read-only; menu tersembunyi untuk user tanpa bawahan.
**Depends:** OD-47, OD-48.

### OD-50 · Test akses reporting line · `TODO`
**Description:** `apps/server/test/org.test.ts` (DB test dari OD-39 atau setup sendiri dengan `DATABASE_URL` test). Skenario: request dari bawahan → accept leader; request dari leader → accept bawahan; pengaju tidak bisa accept sendiri; reject; batal; request baru menggantikan pending lama; lepas leader / lepas report; validasi diri sendiri & saling; akses plan (owner, leader aktif, pihak pending, user lain, admin); admin set langsung menghapus pending.
**Acceptance:** `bun run test` hijau.
**Depends:** OD-47.

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

### OD-31 · Verifikasi visual end-to-end (Playwright, mock) · `IN PROGRESS`
**Description:** Jalankan server + mock Jira/Bitbucket + Postgres, skrip Playwright: login (dev) → PGP home → buka plan → isi achievement → simpan → kanban → drawer → PR list → PR detail (files + diff) → connections → templates → template baru. Catat error console (abaikan icon dari `cdn.mekari.design` yang diblok di sandbox).
**Acceptance:** Semua langkah lulus, drawer tampil dengan panel & overlay, tidak ada error JS.
**Log:** Run pertama: semua halaman render; drawer belum ber-style → diperbaiki (OD-30). Re-run dihentikan atas permintaan user; dilanjutkan setelah PLAN disetujui.

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

### OD-34 · Run lokal di laptop · `TODO`
**Description:** Di Mac user: install deps, jalankan Postgres via OrbStack/Docker, migrate, start server & web, login via dev-login, buat template dari scratch, isi plan, export Excel. (Dijalankan oleh user di terminal Mac karena VM Claude tidak punya Bun/Docker; Claude memandu.)
**Acceptance:** Flow PGP berjalan di laptop tanpa integrasi eksternal.

### OD-35 · Script `dev` gabungan · `TODO`
**Description:** Pastikan `bun run dev` di root menjalankan server (watch) + web (vite) paralel dengan log ber-prefix; tambah `bun run setup` (install + migrate).
**Acceptance:** Satu perintah untuk development.

## Fase 8 — Hardening & integrasi nyata

### OD-36 · Proteksi CSRF (Origin check) · `TODO`
**Description:** Plugin `shared/origin-guard.ts`: untuk method non-GET di `/api/*`, tolak (403) bila header `Origin`/`Referer` tidak sama dengan `APP_URL`. Tambah test.
**Acceptance:** POST dari origin lain ditolak; UI tetap jalan.

### OD-37 · Uji integrasi Jira nyata · `TODO`
**Description:** Isi `JIRA_*` dengan service account; verifikasi auto-connect by email (catatan: email user bisa tersembunyi oleh privacy setting → fallback cari manual), pilih board MESIGN, kanban sprint aktif, issue detail, stats. Konfirmasi `JIRA_STORY_POINT_FIELD`.
**Acceptance:** Data sama dengan yang terlihat di Jira.
**Depends:** credential service account Jira.

### OD-38 · Uji integrasi Bitbucket nyata · `TODO`
**Description:** Isi `BITBUCKET_*`; verifikasi auto-connect (account_id), list PR author & reviewer, detail, diff, build status. Ukur latency fan-out reviewer; bila lambat, cache 1–2 menit.
**Acceptance:** PR sama dengan yang terlihat di Bitbucket; list < 3 detik.
**Depends:** token Bitbucket.

### OD-39 · Test API (service level) · `TODO`
**Description:** `bun test` untuk PlanService/TemplateService (DB test via `DATABASE_URL` test), aturan score, submit 100%, lock saat submitted, akses owner/admin, template delete guard.
**Acceptance:** Test hijau & dijalankan di `bun run test`.

### OD-40 · Validasi Dockerfile · `TODO`
**Description:** Pastikan `bunfig.toml` & `postcss.config.cjs` ikut ter-copy, build image, jalankan dengan `docker compose --profile full up`, cek migrate + serve SPA.
**Acceptance:** App jalan di container pada :3000.

### OD-41 · Known issues UI · `TODO`
**Description:** (a) Investigasi noise `🐼 error ... 'literal'` saat build (versi panda vs Pixel). (b) Icon Pixel diambil dari `cdn.mekari.design` — pastikan reachable dari jaringan kantor. (c) UX ItemsEditor: objective/KR berulang per baris → tampilkan grouping/merge visual. (d) Responsif lebar < 1280px.
**Acceptance:** Tiap butir ditutup atau dicatat sebagai keputusan.

### OD-42 · Review keamanan & data · `TODO`
**Description:** Checklist: tidak ada secret di repo/log, cookie `secure` di prod, akses PGP owner/admin, rate limit login, audit dependency (`bun audit` bila tersedia), masking data pribadi di log. Hasil dicatat di `SECURITY.md`.
**Acceptance:** Checklist terisi, temuan jadi tiket.

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
