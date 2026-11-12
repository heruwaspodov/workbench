# CLAUDE.md — Workbench

Internal app Mekari Sign: PGP (Personal Growth Plan) + kanban Jira + pull request Bitbucket dalam satu tab.
Classification: **INTERNAL**.

- **PLAN.md** = satu-satunya patokan pekerjaan (tiket OD-xx + status).
- **DESIGN.md** = goals, non-goals, arsitektur, aturan bisnis & keamanan.

Baca keduanya di awal setiap sesi sebelum melakukan apa pun.

## Workflow wajib (per tiket)

1. **Tidak ada pekerjaan tanpa tiket.** Semua perubahan kode harus milik satu tiket di PLAN.md. Butuh pekerjaan baru → tambahkan tiket `TODO` lengkap (Description, Acceptance, Depends) lalu minta persetujuan dulu.
2. **Satu tiket per eksekusi.** Jangan mengerjakan beberapa tiket sekaligus kecuali user memintanya.
3. **Konfirmasi sebelum mulai.** Sebutkan ID tiket yang akan dikerjakan (ikuti "Urutan kerja berikutnya" di PLAN.md dan cek `Depends`), ringkas rencananya, lalu **tunggu "lanjut"** dari user.
4. **Update status di PLAN.md** setiap status berubah:
   - mulai → `IN PROGRESS`
   - selesai & terverifikasi → `DONE`, tambahkan `**Log:**` (tanggal, apa yang dikerjakan, hasil verifikasi, hash commit)
   - terhambat → `BLOCKED` + alasan & apa yang dibutuhkan
   - perbarui juga tabel **Ringkasan** di atas PLAN.md.
5. **Kerjakan sesuai Description & Acceptance.** Jika harus menyimpang, update deskripsi tiket dulu dan konfirmasi ke user.
6. **DONE = acceptance terverifikasi di repo ini** (test / typecheck / build / cek manual yang tertulis), bukan sekadar kode ditulis.
7. **Commit per tiket** setelah DONE, pesan diawali ID tiket, mis. `feat(org): OD-46 reporting line API`. Jangan push ke remote tanpa diminta. Jangan ikut meng-commit file yang tidak diubah oleh tiket tersebut.
8. Jangan menjalankan perintah destruktif (hapus data/DB, `git reset --hard`, force push) tanpa izin eksplisit.

## Stack & struktur

- Bun workspaces (`bunfig.toml`: `linker = "hoisted"` — wajib untuk Mekari Pixel postcss).
- `apps/server` — **Elysia (Bun)** + Drizzle + Postgres.
- `apps/web` — **Vue 3 + TypeScript + Vite + Mekari Pixel 3** (`@mekari/pixel3`) + Pinia + Vue Router. Client API = Eden Treaty (`src/lib/api.ts`), type diambil langsung dari `@workbench/server` (`apps/server/src/app.ts`).
- Monolith: di production server menyajikan `apps/web/dist`.

### Konvensi backend (per module)

```
apps/server/src/modules/<nama>/
  index.ts    controller: new Elysia({ name: 'module.<nama>', prefix: '/api/<nama>' }), routing + validasi t.*
  service.ts  logic bisnis: abstract class <Nama>Service dengan method static
  model.ts    schema t.* (body/query/params) + type
```
- Daftarkan module baru di `src/app.ts`.
- Guard: `.use(authPlugin)` lalu `{ auth: true }` atau `{ admin: true }` (inject `user`).
- Error: lempar `AppError` / turunannya dari `src/shared/errors.ts`; jangan `return status(...)` ad-hoc di service.
- Integrasi eksternal hanya lewat `src/integrations/*.client.ts`.
- Param path numerik: pakai `t.String({ pattern })` lalu `Number()` (bug Elysia `t.Numeric` di params).
- Subquery SQL mentah: kualifikasikan kolom tabel luar secara eksplisit (`"pgp_plans"."id"`).
- Perubahan schema: edit `src/db/schema.ts` → `bunx drizzle-kit generate --name <nama>` (dari `apps/server`) → `bun run db:migrate`. Jangan edit migration yang sudah ada.

### Konvensi frontend

- Token semantik Pixel (`border.default`, `background.surface`, …) hanya ada di tema `next`: `usePixelTheme().setNextTheme(true)` di `main.ts` — jangan dihapus. Pakai gaya bersama dari `src/lib/ui.ts` (kartu, panel, toolbar) dan `SegmentedControl`, jangan definisikan ulang kartu per halaman. Teks UI berbahasa Inggris. Tabel: pasang `ui.table` (atau `ui.tableDense` untuk editor) pada `MpTable` — Pixel merender sel body sebagai `<th>` semibold. Semua kontrol filter ukuran normal (jangan `size="sm"` di toolbar).
- Komponen UI **wajib Mekari Pixel** (`Mp*`) dari `@mekari/pixel3`; styling via `css({...})` dengan objek literal statis (diekstrak Panda saat build) dan token semantik (`background.surface`, `text.secondary`, `border.default`, …).
- `MpTabs` memakai index numerik (`:default-value="0"`), bukan string.
- Hindari ekspresi TS kompleks di template (`as const`, cast bertingkat) — pindahkan ke `<script setup>`; pecah komponen bila vue-tsc kehilangan scope `v-for`.
- Route baru di `src/router.ts` (lazy import, `meta.title`, `meta.admin` bila perlu).
- Data loading pakai `useAsync` + `AsyncState`; error ke user via `notifyError`.
- Konten dari Jira/PR dirender sebagai teks, bukan `v-html`.

## Perintah

```bash
bun install
docker compose up -d db            # Postgres 16 (workbench/workbench)
cp .env.example .env               # isi MEKARI_OAUTH_* dan APP_URL=http://workbench.local (login hanya lewat Mekari SSO)
bun run db:migrate
bun run dev:server                 # API :3000
bun run dev:web                    # Vite :5173 (proxy /api & /auth)

bun run typecheck                  # tsc server + vue-tsc web
bun run test                       # bun test (apps/server/test)
bun run build                      # build web
```

Verifikasi minimal sebelum menandai DONE: `bun run typecheck` + `bun run test` + (jika menyentuh web) `bun run build`.

## Keamanan & data (Mekari: UU PDP, ISO 27001/27701)

- Jangan pernah menulis secret/token ke repo, log, atau output. `.env` tidak di-commit; `.env.example` hanya placeholder.
- Jangan menampilkan PII (NIK, nomor telepon, rekening, dll.) di contoh/fixture/test — pakai data sintetis.
- Akses PGP: owner (tulis), direct leader **aktif** (baca), admin (baca). Jangan melonggarkan aturan ini tanpa tiket & persetujuan.
- Redirect pasca-login hanya path relatif; link evidence hanya dirender bila `http(s)`.

## Known issues (jangan dikejar kecuali ada tiketnya)

- Saat build muncul `🐼 error ... reading 'literal'` dari Pixel/Panda — output tetap benar (OD-41). `Error finding real module path` sudah ditambal lewat `patches/` (`bun patch` `@mekari/pixel3-postcss`); jangan hapus `patchedDependencies` dan `patches/`.
- Icon Pixel dimuat dari `cdn.mekari.design`.
