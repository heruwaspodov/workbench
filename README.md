# One Desk

> Classification: **INTERNAL**

Internal app Mekari Sign: PGP, kanban Jira, dan pull request Bitbucket dalam satu tab.
Goals & arsitektur: [DESIGN.md](./DESIGN.md) · Tiket kerja: [PLAN.md](./PLAN.md).

## Prasyarat

- [Bun](https://bun.sh) ≥ 1.3. Lockfile memakai format Bun baru; Bun lama gagal dengan `Unknown lockfile version` (jalankan `bun upgrade`).
- Postgres 16 di localhost:5432 (install lokal, mis. `brew install postgresql@16`). Docker/OrbStack hanya opsi, lihat bawah.

## Setup lokal

```bash
createdb -h localhost one-desk     # sekali saja
cp .env.example .env               # lalu isi DEV_LOGIN_EMAIL
bun run setup                      # bun install + migrate
bun run dev                        # server :3000 + web :5173, log ber-prefix
```

Buka http://localhost:5173. Selama Mekari OAuth belum dikonfigurasi (OD-07), login lewat tombol dev login. Tombol ini aktif bila `DEV_LOGIN_EMAIL` terisi dan hanya untuk lokal, mati di production.

### Host `one-desk.local` (untuk Mekari OAuth)

Mekari SSO tidak menerima `localhost` sebagai redirect URI. Pakai host lokal:

1. Tambahkan ke `/etc/hosts` (butuh sudo, sekali saja). Entri `::1` mencegah jeda ~5 detik karena macOS mencoba mDNS untuk domain `.local`:
   ```bash
   sudo sh -c 'printf "127.0.0.1       one-desk.local\n::1             one-desk.local\n" >> /etc/hosts'
   ```
2. Di `.env` set `APP_URL=http://one-desk.local`. Redirect URI untuk didaftarkan di SSO: `http://one-desk.local/sso-callback`.
3. `bun run dev`, lalu buka http://one-desk.local (tanpa port).

Vite mengikuti `APP_URL`: host dan port diambil dari URL itu. Port 80 butuh bind wildcard (macOS tanpa root hanya mengizinkan itu untuk port < 1024), jadi dev server terjangkau dari jaringan lokal lewat IP. Hostname lain ditolak (`allowedHosts`), tapi akses via IP tidak. Kosongkan `DEV_LOGIN_EMAIL` setelah OAuth jalan dan jangan pakai di jaringan yang tidak dipercaya. Bila port 80 dipakai proses lain, tidak ada fallback otomatis (`strictPort`); hentikan proses itu atau pakai `APP_URL` dengan port lain jika SSO mengizinkan.

Tanpa integrasi eksternal, PGP sudah bisa dipakai penuh: buat template dari scratch, isi plan, export Excel. Kanban dan PR butuh kredensial Jira/Bitbucket di bawah.

## Perintah

| Perintah | Fungsi |
|----------|--------|
| `bun run setup` | `bun install` + `db:migrate` |
| `bun run dev` | Server (watch) + Vite paralel |
| `bun run dev:server` / `dev:web` | Salah satunya saja |
| `bun run typecheck` | `tsc` server + `vue-tsc` web |
| `bun run test` | `bun test` di `apps/server`. Test DB memakai database terpisah `one-desk-test` (dibuat & dimigrasi otomatis; override dengan `TEST_DATABASE_URL`, nama harus mengandung "test") |
| `bun run e2e` | Uji visual end-to-end (mock Jira/Bitbucket + Chrome sistem, screenshot di `e2e/out/`); butuh `bun run build` dulu |
| `bun run build` | Build web ke `apps/web/dist` |
| `bun run start` | Jalankan server production (menyajikan `apps/web/dist`) |
| `bun run db:generate` | Generate migration dari `src/db/schema.ts` |
| `bun run db:migrate` | Terapkan migration |

Script root memuat `.env` dari root repo. Jalankan semuanya dari root; `bun --cwd <dir> run ...` tidak berjalan di Bun 1.4.

Alternatif Postgres via Docker: `docker compose up -d db`, lalu set `DATABASE_URL=postgres://onedesk:onedesk@localhost:5432/onedesk`. App penuh di container: `docker compose --profile full up` (app di :3000).

## Environment

Semua di `.env` (tidak di-commit). `.env.example` hanya berisi placeholder. Jangan menaruh secret di repo, log, atau issue tracker.

| Variabel | Wajib | Keterangan |
|----------|-------|------------|
| `DATABASE_URL` | ya | Default `postgres://localhost:5432/one-desk` (user = user OS) |
| `APP_URL`, `PORT` | tidak | Origin UI dan port API. Request `POST/PUT/PATCH/DELETE` ke `/api/*` hanya diterima bila `Origin`/`Referer` sama dengan `APP_URL` (proteksi CSRF); di production set ke URL publik, di lokal akses lewat http://localhost:5173 |
| `DEV_LOGIN_EMAIL` | lokal | Email untuk dev login |
| `MEKARI_OAUTH_*` | production | Authorize `https://account.mekari.com/auth`, token `https://account.mekari.com/auth/oauth2/token` (body JSON), userinfo `https://api.mekari.com/v1/users/me` (Mekari SSO API, Bearer token), client id/secret, scope (`esign` untuk app yang terdaftar). `MEKARI_OAUTH_REDIRECT_URI` opsional, default `{APP_URL}/sso-callback`; harus persis sama dengan yang didaftarkan di SSO. `MEKARI_OAUTH_PKCE=false` karena dokumen Mekari tidak menyebut PKCE |
| `ADMIN_EMAILS` | tidak | Email dipisah koma; jadi admin saat login pertama |
| `ALLOWED_EMAIL_DOMAINS` | tidak | Default `mekari.com` |
| `SESSION_TTL_DAYS` | tidak | Default 7 |
| `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | kanban | Service account Jira |
| `JIRA_BOARD_ID`, `JIRA_STORY_POINT_FIELD` | tidak | Default field `customfield_10016` (belum diverifikasi, OD-37) |
| `BITBUCKET_WORKSPACE` | PR | Slug workspace |
| `BITBUCKET_ACCESS_TOKEN` atau `BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN` | PR | Bearer atau Basic |
| `BITBUCKET_API_URL` | tidak | Override untuk test/mock |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | import sheet | JSON satu baris |

## Membuat kredensial

- **Jira API token:** https://id.atlassian.com/manage-profile/security/api-tokens. Isi `JIRA_EMAIL` dengan email akun pemilik token.
- **Bitbucket:** pakai workspace/repository access token (`BITBUCKET_ACCESS_TOKEN`), atau API token akun service (`BITBUCKET_EMAIL` + `BITBUCKET_API_TOKEN`). Scope cukup read untuk repository dan pull request.
- **Google service account:** buat di Google Cloud, aktifkan Sheets API, unduh key JSON, tempel sebagai satu baris di `GOOGLE_SERVICE_ACCOUNT_JSON`, lalu share sheet ke email service account sebagai Viewer. Alternatif tanpa setup: upload `.xlsx` di editor template.

Token hanya dipakai server. Bila token bocor (chat, log, commit), rotasi segera.

## Struktur

```
apps/server   Elysia (Bun) + Drizzle + Postgres, per modul: index.ts · service.ts · model.ts
apps/web      Vue 3 + Vite + Mekari Pixel 3 + Pinia, client API = Eden Treaty
```

Production berupa monolith: server menyajikan `apps/web/dist` dan API di satu port.

## Known issues

- Build menampilkan `🐼 error ... reading 'literal'` dari Pixel/Panda. Output tetap benar (OD-41). Error `Error finding real module path` sudah diperbaiki lewat `patches/` (`bun patch` untuk `@mekari/pixel3-postcss`).
- Icon Pixel dimuat dari `cdn.mekari.design`; ikon kosong bila jaringan tidak bisa menjangkaunya.
- Bun harus memakai `linker = "hoisted"` (`bunfig.toml`); jangan diubah, Pixel postcss bergantung padanya.
