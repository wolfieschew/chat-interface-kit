# Chat Interface Kit

![ChatUI](https://i.postimg.cc/VkHrD8pp/Screenshot-from-2026-11-08-14-15-12.png)

Aplikasi chat BYOK (bring your own key) minimalis yang dibangun dengan Svelte 5, SvelteKit, Tailwind CSS, dan shadcn-svelte. Hubungkan provider AI milik Anda sendiri, pilih model, dan mulai mengobrol. Tidak ada data yang disimpan di server.

## Fitur

- **Bring Your Own Key (BYOK)**: OpenAI, Google Gemini, Anthropic, atau endpoint apa pun yang kompatibel dengan OpenAI sebagai Custom Provider.
- **Chat streaming** dengan efek ketik yang menghormati `prefers-reduced-motion`, tombol Stop, dan penanganan error yang tampil langsung di dalam pesan.
- **Lampiran gambar**: dari file picker, drag and drop, atau paste. Gambar di atas 900 KB otomatis diperkecil menjadi WebP di sisi klien. Peringatan muncul ketika model yang dipilih tidak bisa membaca gambar, berdasarkan data kapabilitas yang dilaporkan provider (atau fallback berbasis nama model).
- **Riwayat percakapan lokal** di IndexedDB dengan pencarian, ubah judul, hapus, dan ekspor JSON. Percakapan dikelompokkan berdasarkan waktu dan dipulihkan setelah refresh.
- **System prompt** dengan pengeditan draft-then-save, tersimpan per browser.
- **Keamanan sesi**: API key tidak pernah kembali ke browser setelah connect. Key dienkripsi dengan AES-256-GCM dan disimpan di cookie HttpOnly yang hanya bisa dibaca server.

## Arsitektur

### Stack

- SvelteKit 3 dengan Svelte 5 runes untuk seluruh state klien
- Tailwind CSS 4 dan komponen shadcn-svelte
- Semua panggilan provider diproxy oleh endpoint server, sehingga API key tidak pernah meninggalkan server
- Suite test `node:test`, tanpa framework test tambahan
- Dideploy sebagai serverless function Vercel

### Alur request

```
Browser                                   Server                        Provider
───────                                   ──────                        ────────
composer.svelte ──POST /api/chat──▶ +server.ts ──stream──▶ chat.ts ──▶ OpenAI /v1/chat/completions
     ▲                                    │                  │          Anthropic /v1/messages
     │                                    │                  │          Google :streamGenerateContent
     └────── SSE text deltas ─────────────┴──────────────────┘
```

Setiap provider punya format request yang berbeda. `/api/chat` menormalisasi semuanya menjadi satu protokol SSE yang dipahami klien:

```
data: {"text": "..."}
data: {"error": {"code": "...", "message": "..."}}
data: [DONE]
```

### Struktur proyek

```
src/
├── routes/
│   ├── +page.svelte               State aplikasi: percakapan, kirim/stop, pemulihan riwayat
│   └── api/
│       ├── provider/+server.ts    Connect / disconnect / status sesi
│       ├── models/+server.ts      Daftar model provider yang terhubung
│       └── chat/+server.ts        Proxy streaming chat (SSE)
├── lib/
│   ├── chat-client.ts             Pembaca SSE sisi klien untuk /api/chat
│   ├── sse.ts                     Dekoder SSE bersama (klien dan server)
│   ├── typewriter.ts              Animasi mengetik adaptif
│   ├── images.ts                  Batas lampiran, helper base64, downscale di klien
│   ├── vision.ts                  Deteksi kapabilitas vision
│   ├── history.ts                 Wrapper IndexedDB, sanitasi, estimasi storage
│   └── server/provider/
│       ├── session.ts             Sesi cookie (dev: chatui_provider, prod: __Host-chatui_provider)
│       ├── credentials.ts         Enkripsi / dekripsi AES-256-GCM
│       ├── chat.ts                Pembentukan request dan parsing stream per provider
│       ├── client.ts              Klien HTTPS dengan DNS pinning
│       ├── adapters.ts            Parsing daftar model per provider
│       ├── validation.ts          Validasi base URL, pemblokiran alamat privat
│       └── http.ts, errors.ts     Guard bersama dan format error
└── tests/                         Suite node:test (131 test)
```

### Proteksi sisi server

- **Hanya same-origin**: request wajib membawa `Origin` yang cocok dan header `Sec-Fetch-Site` same-site.
- **Proteksi SSRF**: base URL custom harus HTTPS publik; hasil DNS dipasangkan (pin) ke koneksi sehingga hostname tidak bisa ditukar di tengah request.
- **Batas input**: jumlah pesan, panjang pesan, panjang system prompt, jumlah lampiran, dan total byte lampiran dibatasi sebelum request mencapai provider.
- **Batas stream**: timeout idle 60 detik dan plafon respons 8 MB per stream.

### Di mana data disimpan

| Data                                        | Lokasi                                                          |
| ------------------------------------------- | --------------------------------------------------------------- |
| Percakapan dan pesan (termasuk data gambar) | Database IndexedDB `chatui`, store `conversations`              |
| Tema                                        | `localStorage["chatui:theme"]`                                  |
| System prompt                               | `localStorage["chatui:system-prompt"]`                          |
| Model terpilih per provider                 | `localStorage["chatui:model:<providerId>"]`                     |
| API key                                     | Terenkripsi di cookie HttpOnly, tidak pernah di browser storage |

Storage bisa dilihat dan dibersihkan dari Settings > Storage.

## Memulai

Prasyarat: Node.js 26 dan npm.

```bash
npm install
echo "PROVIDER_COOKIE_SECRET=$(openssl rand -base64 32)" > .env.local
npm run dev
```

Buka `http://localhost:5173`, masuk ke Settings, dan hubungkan provider dengan API key Anda.

## Perintah

| Perintah        | Fungsi                                 |
| --------------- | -------------------------------------- |
| `npm run dev`   | Menjalankan dev server                 |
| `npm run build` | Build produksi dengan adapter Vercel   |
| `npm test`      | Menjalankan suite `node:test`          |
| `npm run check` | Diagnostik svelte-check dan TypeScript |
| `npm run lint`  | Pemeriksaan format Prettier            |


## Model keamanan

- API key hanya ada di browser sebagai ciphertext di dalam cookie HttpOnly. JavaScript tidak bisa membacanya, dan key tidak pernah disimpan di localStorage atau IndexedDB.
- Kunci enkripsi hanya ada di environment server. Merotasinya membuat semua sesi yang ada tidak valid, dan itu memang perilaku yang diharapkan.
- Endpoint chat, daftar model, dan provider menolak request lintas situs dan body non-JSON.
- Percakapan yang tersimpan disanitasi saat dimuat, sehingga record IndexedDB yang rusak hanya menurunkan kualitas data, bukan merusak aplikasi.
