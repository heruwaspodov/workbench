# One Desk — Design

> Classification: **INTERNAL**
> Owner: Waspodo (Mekari Sign Engineering) · Status: MVP in progress · Patokan eksekusi: [PLAN.md](./PLAN.md)

## 1. Masalah

- Format PGP (Personal Growth Plan) dari management berubah hampir setiap quarter dan diisi manual di Google Sheet per orang (1 file per engineer, 1 tab per quarter).
- Evidence PGP (story point, tiket, PR, incident) harus dicari manual di Jira & Bitbucket lalu di-copy ke sheet.
- Untuk kerja harian engineer membuka Jira board + Bitbucket + Google Sheet di banyak tab → boros RAM browser dan context switching.

## 2. Goals (MVP)

| # | Goal | Ukuran berhasil |
|---|------|-----------------|
| G1 | **Satu app internal Mekari Sign** untuk PGP + progress kerja | Engineer tidak perlu buka Jira board / Bitbucket untuk cek pekerjaan sendiri sehari-hari |
| G2 | **Login dengan Mekari OAuth2** | Hanya akun domain @mekari.com yang bisa masuk; tanpa password lokal |
| G3 | **Connect akun Jira & Bitbucket** per user | User bisa link akun (otomatis via email / Atlassian account id, atau manual) |
| G4 | **Menu PGP** mengikuti format management yang berubah per quarter | Admin bisa: import template dari Google Sheet / .xlsx, buat dari nol, edit & tambah item. Engineer bisa: isi plan, edit/tambah item, update progress, submit, **export Excel** |
| G5 | **Menu Kanban** milik current user | Issue Jira yang di-assign ke user, dikelompokkan per kolom board (atau status category), detail issue tanpa buka Jira |
| G6 | **Menu Pull Request** current user lintas repo | List PR (dibuat saya / perlu review saya) dari semua repo yang terlibat + detail (files, diff, commits, comments, reviewers, build) |
| G7 | **Ringan di browser** | 1 tab, route lazy-loaded, bundle awal kecil (target < 100 KB JS gzip), data diambil on-demand |
| G8 | **Leader bisa lihat PGP direct report-nya** | Reporting line `users.manager_id` → `users.id`. Permintaan bisa diajukan **2 arah** (bawahan ajukan atasan, atau atasan tambah bawahan) dan aktif setelah pihak lain mengonfirmasi. Leader membaca PGP direct report (read-only) + ringkasan tim |

## 3. Non-goals (MVP)

- Menulis balik ke Jira/Bitbucket (transition issue, approve/merge PR, comment). Read-only dulu.
- Approval / komentar PGP oleh leader (post-MVP). Leader hanya **membaca**.
- Skip-level (atasan dari atasan) dan struktur organisasi penuh / sinkron Talenta (post-MVP).
- Snapshot leader per plan per quarter — MVP memakai reporting line saat ini (post-MVP).
- Sinkronisasi dua arah dengan Google Sheet (import satu arah saja; output via export Excel).
- Multi-tenant / dipakai di luar Mekari Sign (nama "One Desk" netral supaya bisa diperluas nanti).
- Notifikasi (email/Slack).

## 4. Users & Roles

| Role | Bisa |
|------|------|
| `member` (default) | Login, connect Jira/Bitbucket, isi & export PGP sendiri, lihat kanban & PR sendiri |
| `admin` (via `ADMIN_EMAILS`) | Semua di atas + kelola template PGP (import/buat/edit/publish/archive) + lihat PGP semua orang per template (read-only) + set direct leader user mana pun secara langsung |
| *leader* (bukan role, relasi) | Siapa pun yang menjadi `manager_id` aktif user lain: membaca & export PGP direct report-nya, melihat halaman "Tim Saya" |

### Direct leader (reporting line) — 2 arah

- **Aturan inti:** relasi atasan–bawahan baru **aktif** jika **kedua pihak setuju**. Pihak yang mengajukan dianggap setuju; pihak lainnya mengonfirmasi. Dengan begitu bawahan (pemilik data PGP) selalu ikut menyetujui sebelum PGP-nya bisa dibaca.
- Model data:
  - `users.manager_id` (FK → `users.id`) = relasi **aktif**. Satu user maksimal satu direct leader.
  - Tabel `reporting_requests` (`id`, `report_id`, `leader_id`, `requested_by`, `created_at`) = permintaan yang belum dikonfirmasi. Unik per `report_id` (satu bawahan maksimal satu permintaan pending; permintaan baru menggantikan yang lama). `requested_by` menentukan siapa yang harus mengonfirmasi: bila `requested_by = report_id` → leader yang konfirmasi; bila `requested_by = leader_id` → bawahan yang konfirmasi.
- Alur dari dashboard (PGP home), bisa dimulai dari dua sisi:
  1. **Bawahan → "Ajukan atasan"**: cari user → kirim permintaan → leader melihat banner *Terima / Tolak*.
  2. **Atasan → "Tambah bawahan"**: cari user → kirim permintaan → bawahan melihat banner *Terima / Tolak*.
  3. Saat diterima: `report.manager_id = leader_id` (menggantikan leader lama bila ada), permintaan dihapus.
  4. Pengaju bisa membatalkan permintaannya; leader bisa melepas direct report; bawahan bisa melepas leader-nya.
  5. Admin bisa set/hapus `manager_id` langsung tanpa konfirmasi (untuk koreksi).
- Hak akses leader: **hanya direct report aktif** (bukan skip-level, bukan pending), **read-only** (lihat plan + export Excel).
- Validasi: tidak boleh diri sendiri; tidak boleh saling (A leader B dan B leader A); hanya user yang sudah pernah login.
- Header plan "Direct Leader" di-prefill dari nama `manager_id` saat plan dibuat (tetap bisa diedit sebagai teks).

## 5. Arsitektur

**Monolith**: satu proses Bun menyajikan API (`/api/*`, `/auth/*`) **dan** hasil build Vue (`apps/web/dist`). Satu container, satu port.

```
one-desk/                     (bun workspaces, linker hoisted)
├─ apps/server                Elysia (Bun) + Drizzle + Postgres
│  └─ src/
│     ├─ config/env.ts        validasi env terpusat
│     ├─ db/                  schema, client, migrate
│     ├─ shared/              errors, auth.plugin (macro auth/admin), cache, adf
│     ├─ integrations/        http, jira.client, bitbucket.client, google-sheets.client
│     ├─ modules/             ← per module: index.ts (controller) · service.ts · model.ts
│     │  ├─ auth/
│     │  ├─ connections/
│     │  ├─ pgp/              + sheet-parser.ts, excel.service.ts, template/plan service
│     │  ├─ kanban/
│     │  └─ pull-requests/
│     ├─ app.ts               komposisi modul + error handler, export type App
│     └─ index.ts             listen + serve SPA
└─ apps/web                   Vue 3 + TS + Vite + Mekari Pixel 3 + Pinia + Vue Router
   └─ src/ (layouts, views per menu, components, lib/api.ts = Eden Treaty)
```

### Keputusan stack

| Keputusan | Alasan |
|-----------|--------|
| **Elysia (Bun)** untuk backend | Dipilih user. Eden Treaty memberi type end-to-end ke Vue tanpa OpenAPI codegen; Bun ringan & cepat start; pekerjaan dominan I/O (Jira/Bitbucket) |
| Struktur **per module** (controller/service/model) | Permintaan user: mudah maintain & readable. Controller tipis (routing + validasi `t.*`), logic di `service.ts` (abstract class static), schema di `model.ts` |
| **Drizzle + Postgres** | Type-safe, migration SQL eksplisit (`apps/server/drizzle`) |
| **Mekari Pixel 3** (`@mekari/pixel3`) | Design system Mekari (permintaan user). Styling via `css()` (Panda) + komponen `Mp*` |
| **Service account** Jira & Bitbucket | Setup tercepat. User hanya di-*link* ke identitasnya (Jira accountId, Bitbucket uuid); semua call memakai token server |
| Session = token opaque di cookie httpOnly, hash SHA-256 di DB | Bisa di-revoke (logout), tidak ada secret di client |
| OAuth2 Authorization Code + **PKCE** + `state` | Standar; endpoint Mekari SSO dikonfigurasi lewat env |

## 6. Data model (ringkas)

- `users` (email unik, role, `manager_id`) · `reporting_requests` (report, leader, requested_by — permintaan pending) · `sessions` · `connections` (1:1 user: jira_account_id, jira_board_id, bitbucket_uuid)
- `pgp_templates` (title, period `YYYY-Qn`, source scratch/google_sheet/xlsx, status draft/published/archived) → `pgp_template_items` (objective, key_result, weight, initiative, position)
- `pgp_plans` (template × user unik, header: division/SBU/leader, status draft/submitted) → `pgp_plan_items` (copy item template + kolom monitoring: start/target/current value, achievement, status, evidence_links)

Aturan bisnis PGP:
- Weight & achievement dalam **poin persen**; `achievement ≤ weight`; **score = Σ min(achievement, weight)**.
- Submit hanya jika total weight = 100%.
- Plan `submitted`: kolom planning terkunci, kolom monitoring tetap bisa diupdate. `Buka kembali` → draft.
- Template yang sudah dipakai plan tidak bisa dihapus (archive saja).

## 7. Integrasi

| Sistem | Endpoint utama | Catatan |
|--------|---------------|---------|
| Mekari OAuth2 | authorize / token / userinfo (env) | **ASSUMPTION**: bentuk userinfo OIDC-like atau `{data:{...}}`; perlu konfirmasi tim SSO |
| Jira Cloud | `/rest/api/3/search/jql`, `/rest/agile/1.0/board/{id}/configuration|issue`, `/rest/api/3/issue/{key}` | Basic auth service account; story point field via env |
| Bitbucket Cloud | `/workspaces/{ws}/pullrequests/{user}`, `/repositories/{ws}/{repo}/pullrequests/...`, `/workspaces/{ws}/members` | "Repo yang terlibat" = repo dari PR yang pernah dibuat user; reviewer view fan-out ke repo tsb (maks 20) |
| Confluence Cloud | `/wiki/rest/api/search` (CQL) | Service account yang sama dengan Jira; hanya metadata halaman (judul, space, tanggal, link), difilter `accountId` user; isi halaman tidak pernah dibaca/ditampilkan |
| Google Sheets | Sheets API v4 (service account, readonly) | Sheet harus di-share ke email service account. Alternatif tanpa setup: upload .xlsx |

## 7a. Saran evidence & Current Value dari Jira (OD-68, OD-69, OD-70)

Panel di halaman detail plan (hanya owner) menghitung saran dari akun Atlassian si owner, dalam kuartal plan. Hanya metadata (key, judul, status, tanggal, URL); tidak ada isi issue atau halaman. Tidak ada yang terisi otomatis: setiap aksi (Add to…, Use as current value, Add initiatives) butuh konfirmasi dan baru tersimpan setelah Save. Pencarian Jira diikuti `nextPageToken` karena Jira membatasi 100 issue per halaman.

| Metrik | Rumus / JQL | Diverifikasi terhadap sheet Q3-2026 |
|--------|-------------|-------------------------------------|
| Story points & tiket per bulan | `assignee = <accountId> AND resolutiondate >= <awal bulan> AND resolutiondate < <awal bulan berikut> AND cf[<id field SP>] > 0`; SP = jumlah field SP, tiket = jumlah issue | Juli: 162 SP / 62 tiket, sama dengan sheet. Agustus 51/20, September 62/32 (tidak ada di sheet) |
| Bug per prioritas | `assignee = <accountId> AND issuetype = Bug AND created >= <awal kuartal> AND created < <awal kuartal berikut>`, dihitung per level P (`Medium - P2` → `P2`) | "P2: 7" sama dengan sheet (baris bug staging) |
| Team delivery rate per label | label diisi manual; total = `labels = "L" AND created < <akhir> AND (resolution is EMPTY OR resolutiondate >= <awal>)`; selesai = yang resolved di kuartal; dilaporkan per tiket dan per SP; seluruh tim | Belum diverifikasi (label di sheet tidak diketahui) |
| Epic kuartal ini | epic assigned ke user, `created < akhir`, `updated >= awal`, terbuka atau resolved sejak awal; ditambah epic induk dari issue yang user resolve di kuartal | 7 dari 7 epic yang di-link di sheet |
| Halaman Confluence | halaman yang user buat/kontribusikan 92 hari terakhir; jenis ditebak dari judul | 3 dari 5 halaman yang di-link di sheet berada dalam jendela uji |

**Tidak ditawarkan (butuh keputusan definisi, tidak ditebak):**
- *Rata-rata story point per sprint* ("AVG 44"): board 2508 adalah Kanban, issue tidak punya sprint, jadi tidak bisa dihitung dari Jira.
- *Median lead time* ("3d 7h"): median `created → resolved` dari issue yang user resolve di Q3 = 4d 8h (semua) / 4d 2h (bertanda SP), tidak cocok dengan sheet; kemungkinan memakai definisi lain (mulai dari In Progress, jam kerja). Tentukan definisinya dulu.
- *Carry-over %*, *bug bocor ke staging per sprint*, *bug produksi dari inisiatif PIC* ("P2: 5"), *CFR*, *Deployment Frequency / DORA*, *SLA tiket FT* ("Met 24 Breached 0"), *jumlah RCA* (4 / 8 / 6 berbeda per baris), *ack rate PagerDuty*, *code coverage*: bergantung pada definisi internal, sprint, atau sistem di luar Jira.

## 8. Prinsip keamanan & data (UU PDP / ISO 27001 / 27701)

- Tidak ada secret di repo; semua via `.env` (`.env.example` hanya placeholder). Token integrasi hanya di server.
- Hanya domain yang diizinkan (`ALLOWED_EMAIL_DOMAINS`) yang bisa login. Tidak ada jalur login selain Mekari SSO (fitur dev login dihapus, OD-64).
- Data PGP = data personal karyawan → akses: owner (read/write), direct leader aktif yang sudah dikonfirmasi (read), admin (read). Tidak ada endpoint publik.
- Konten dari Jira/PR dirender sebagai **teks** (bukan HTML) — ADF → plain text; evidence link hanya dirender sebagai `<a>` bila `http(s)`.
- Redirect pasca-login hanya path relatif (anti open-redirect).

## 9. Open questions / ASSUMPTION

1. Endpoint, scope, dan bentuk userinfo Mekari OAuth2 (apakah support PKCE?).
2. Field story point Jira di instance `jurnal.atlassian.net` (default `customfield_10016`).
3. Jenis token Bitbucket yang tersedia (workspace access token butuh plan Premium; alternatif API token user service).
4. Siapa saja admin template (default: dari `ADMIN_EMAILS`).
5. Hosting internal (k8s/ECS?) — di luar MVP.
6. Direct report hanya bisa ditambahkan untuk user yang sudah pernah login (MVP). Pre-provision user via email / sinkron Talenta = post-MVP.
