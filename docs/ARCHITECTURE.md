# Arsitektur

Dokumen ini menjelaskan cara kerja ChatUI secara teknis, untuk kontributor yang ingin memahami kode atau menambahkan fitur. Untuk cara memulai, lihat [README](../README.md).

## Prinsip desain

Tiga keputusan yang membentuk seluruh arsitektur:

1. **Server adalah proxy, bukan penyimpan.** Tidak ada database, tidak ada tabel user. Satu-satunya data sisi server adalah cookie sesi terenkripsi per browser.
2. **Semua state aplikasi tinggal di browser.** Percakapan ada di IndexedDB, preferensi di localStorage. Rotasi secret atau ganti browser berarti mulai dari kosong, dan itu disengaja.
3. **Satu protokol klien, empat format provider.** Klien hanya mengerti satu bentuk SSE; kompleksitas perbedaan provider ditangkap di satu modul server.

## Alur connect provider

```
provider-settings.svelte
  └─ POST /api/provider  {provider, baseUrl?, apiKey, remember}
       ├─ requireSameOrigin        Origin harus cocok, Sec-Fetch-Site same-site
       ├─ validateProviderInput    provider dikenal, base URL HTTPS publik, key ≤ 1024 char
       ├─ saveProviderSession      enkripsi AES-256-GCM → cookie
       └─ Response                 status publik TANPA apiKey
  └─ GET /api/models
       └─ fetchProviderModels      klien HTTPS pinned, parsing per provider
```

Response `/api/provider` dan status yang dikirim ke UI sengaja tidak memuat API key. Setelah connect, key hanya hidup di server memori sesi cookie.

## Format cookie sesi

Cookie berupa token terpisah titik: `v1.<iv>.<ciphertext>.<authTag>`, semuanya base64url.

- **Algoritma**: AES-256-GCM dengan kunci 32 byte dari `PROVIDER_COOKIE_SECRET` (validasi ketat: regex base64 43 char + `=`, panjang kunci harus tepat 32 byte, salah format → error `server_not_configured` 503).
- **AAD** `chatui:provider:v1` mengikat token pada konteks aplikasi dan versi format, sehingga token dari sistem lain tidak bisa diputar ulang.
- **Nonce acak 12 byte per encrypt**, jadi cookie dua user dengan kredensial sama tetap menghasilkan ciphertext berbeda.
- **Isi plaintext**: `{providerId, baseUrl, apiKey, remember, expiresAt}`.
- **Masa berlaku**: 24 jam default, 30 hari dengan Remember. Dekripsi menolak `expiresAt` di masa lalu maupun lebih jauh dari 30 hari (mencegah token buatan sendiri dengan expiry panjang).
- **Batas ukuran**: token di atas 3500 karakter ditolak di kedua arah.
- **Nama cookie**: `chatui_provider` di dev, `__Host-chatui_provider` di produksi. Prefix `__Host-` menjamin atribut Secure, path `/`, dan tanpa domain, semua dipenuhi otomatis di HTTPS Vercel.

Dekripsi yang gagal dengan alasan apa pun (format, tag, expiry) mengembalikan `null` dan cookie langsung dihapus, bukan error yang tampil ke user.

## Alur chat streaming

```
composer → send() di +page.svelte
  ├─ buat/perbarui Conversation, push Message user + assistant (status: streaming)
  ├─ persist(conversation)            tulis ke IndexedDB
  └─ streamChat() → POST /api/chat
       ├─ assertSessionConfigured     secret terpasang
       ├─ requireSameOrigin
       ├─ requireProviderSession      dekripsi cookie, 401 kalau tidak ada
       ├─ readProviderInput           JSON, batas 5 MB
       ├─ validateChatInput           model, pesan, system prompt, gambar
       └─ openChatStream
            ├─ resolvePublicAddresses  DNS resolve + cek alamat publik
            ├─ openChatConnection      koneksi terikat ke hasil DNS (anti rebinding)
            │   ├─ idle 60 detik tanpa data → abort → 504
            │   └─ status ≠ 200 → providerFailure (401/429/…)
            └─ iterateChatResponse     SseDecoder → parseChatEvent per provider
                 └─ batas total 8 MB per stream
```

Di sisi klien, delta teks masuk ke `Typewriter`: antrian karakter dengan interval 16 ms dan laju adaptif `Math.max(1, Math.ceil(pending / 60))`, sehingga teks mengalir mulus tanpa menunggu seluruh jawaban. `prefers-reduced-motion` mematikan animasi dan meneruskan teks apa adanya. Kursor `▍` di-append ke konten markdown selama streaming dan berkedip lewat state 530 ms.

Persistensi terjadi per event, bukan per delta ketik: saat pesan dikirim, dan sekali lagi saat stream selesai, dihentikan, atau gagal. Snapshot dikirim lewat `$state.snapshot()` karena structured clone IndexedDB tidak bisa menyerialisasi proxy reaktif Svelte.

## Format request per provider

| Provider        | Endpoint                                             | Autentikasi                                               | Catatan format                                  |
| --------------- | ---------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------- |
| OpenAI / Custom | `POST /chat/completions`                             | `Authorization: Bearer`                                   | System prompt sebagai pesan `system` pertama    |
| Anthropic       | `POST /messages`                                     | `Authorization: Bearer` + `anthropic-version: 2026-10-21` | System prompt di level atas, `max_tokens: 4096` |
| Google          | `POST /models/{model}:streamGenerateContent?alt=sse` | `x-goog-api-key`                                          | Role `assistant` dipetakan ke `model`           |

Gambar terenkripsi sebagai bagian konten: part `image_url` (data URL) untuk OpenAI, blok `image` base64 untuk Anthropic, part `inlineData` untuk Google. Pesan tanpa teks tapi dengan gambar dikirim tanpa part teks kosong.

`parseChatEvent` mengekstrak delta teks dari tiap varian event dan melempar `ProviderError` ketika event membawa error provider atau blokir safety Google.

## Menambahkan provider baru

Empat titik yang perlu disentuh, semuanya di `src/lib/server/provider/` dan `src/lib/providers.ts`:

1. **`providers.ts`**: tambahkan id dan base URL default ke array `providers`. Tipe `ProviderId` mengalir otomatis ke validasi dan tipe lain.
2. **`validation.ts`**: base URL default di sini dipakai `resolveProviderBaseUrl`. Provider yang memakai pola OpenAI-compatible biasanya tidak butuh perubahan.
3. **`chat.ts`**: tambahkan cabang di `chatCompletionRequest` (bentuk request) dan `parseChatEvent` (cara mengambil delta teks dan mendeteksi event error).
4. **`adapters.ts`**: kalau format daftar modelnya berbeda, tambahkan cabang parsing di `parseModelPage`.

Tambahkan test di `tests/` untuk builder request, parser event, dan validasi input provider baru sebelum menyentuh UI. UI tidak berubah sama sekali karena klien hanya berbicara lewat endpoint ternormalisasi.

## Data di browser

```
Conversation {
  id, title,
  group: 'Today' | 'Previous 7 days' | 'Older',   ← dihitung ulang dari updatedAt saat load
  messages: Message[],
  updatedAt
}

Message {
  id, role: 'user' | 'assistant', content,
  images?: { name, mime, data }[],   ← base64 tanpa prefix data:
  documents?: { name, mime, size, text }[],   ← teks hasil ekstraksi, tanpa berkas asli
  status?: 'streaming' | 'complete' | 'stopped',
  error?: string
}
```

Batas lampiran: 2 MB per gambar, 3 MB total per pesan, maksimal 4 gambar. Angka ini dipilih agar body request tetap di bawah limit serverless Vercel (~4.5 MB) setelah ekspansi base64 ~33%. Gambar di atas 900 KB di-downscale ke sisi terpanjang 1600 px dan di-encode WebP kualitas 0.82; GIF dilewati agar animasinya utuh.

### Lampiran dokumen

`POST /api/attachments` menerima satu berkas biner dengan nama pada header `X-File-Name` dan guard same-origin. Body dibaca bertahap dengan batas 4 MB. `server/documents.ts` mengekstrak teks PDF menggunakan `pdf-parse`, Word `.doc/.docx` menggunakan `word-extractor`, dan spreadsheet `.xlsx/.xls/.ods/.csv/.tsv` menggunakan SheetJS. Berkas diproses di memori dan tidak disimpan di server. Parser tidak membuka URL atau path dari input pengguna.

PDF dibatasi 100 halaman; spreadsheet maksimal 20 sheet, 2.000 baris dan 100 kolom per sheet. Arsip Office diperiksa sebelum ekstraksi (maksimal 1.000 entry dan 32 MB ukuran terurai). Dokumen kosong, rusak, terenkripsi, atau melebihi batas ditolak dengan pesan yang dapat ditampilkan. PDF scan belum menjalani OCR, dan ekstraksi hanya mencakup teks serta nilai sel.

Metadata dan teks hasil ekstraksi dikembalikan ke composer sebagai `MessageDocument`, ditampilkan sebagai kartu file, lalu disimpan bersama pesan di IndexedDB. Maksimal 4 lampiran campuran per pesan, 48.000 karakter per dokumen, dan 96.000 karakter dokumen per pesan. Pergantian percakapan membatalkan pembacaan yang berjalan. Saat membentuk request provider, `documentContext()` menyertakan nama dan teks dokumen pada konten pesan pengguna untuk seluruh provider. Pesan lanjutan menyertakan kembali konteks dokumen dari riwayat. Klien menolak payload chat di atas 4.400.000 byte sebelum request dikirim.

`sanitizeConversation` di `history.ts` adalah gerbang tunggal data yang masuk dari IndexedDB: record tanpa id/pesan dibuang, field rusak jatuh ke nilai aman, pesan `streaming` yang terputus dipulihkan sebagai `stopped`, dan lampiran tipe tidak dikenal dibuang. Tambahkan field baru pada `Message` berarti menambahkan sanitasinya juga.

## Deteksi vision

Prioritas sumber, dari paling dipercaya:

1. **Metadata provider** di daftar model: field `vision` boolean, `modalities.input` berisi `image`, atau `architecture.input_modalities` gaya OpenRouter. Sinyal positif menang bila bertentangan.
2. **Heuristik nama model** di `vision.ts` bila tidak ada metadata: daftar pola yang diketahui bisa (`gpt-4o`, `claude-3+`, `gemini`, pola `vision`/`-vl` umum) dan yang diketahui tidak bisa (`gpt-3.5`, `o1-mini`, embedding).
3. **Unknown**: nama tidak dikenal dilaporkan sebagai "may not support", bukan diklaim dua-duanya.

Peringatan hanya muncul saat ada lampiran, dan tidak memblokir kirim: heuristik tidak sempurna, jadi user memperingatkan tetap bisa mencoba dan error provider tampil inline bila benar ditolak.

## Konvensi kode

- **Svelte 5 runes di semua file** `.svelte` proyek (dipaksa lewat `compilerOptions.runes` di `vite.config.ts`).
- **Pola re-assign array `$state`**: objek yang baru di-push harus diambil ulang dari array agar reaktif; pola `conversations.find(...) ?? created` di `send()` adalah contohnya.
- **Alias import**: `#lib/*` di sisi klien (package.json `imports`), import relative `.ts` di modul server dan test agar kompatibel dengan `node --experimental-strip-types`.
- **Indentasi tab**, satu statement per baris, semua file harus lolos `npx prettier --check`.
- **Error server** selalu `ProviderError` dengan kode string dan pesan siap tampil; format response `{error: {code, message}}` konsisten di semua endpoint.
- **Komentar** hanya untuk constraint yang tidak terlihat dari kode: alasan batas angka, jebakan platform, aturan protokol. Narrasi langkah dan penerangan yang jelas tidak ditulis.

## Pengujian

`npm test` menjalankan `node:test` langsung di atas TypeScript (`--experimental-strip-types`), tanpa build step dan tanpa jsdom. Konsekuensinya:

- Yang teruji adalah **logika murni**: builder request, parser event, validasi, enkripsi, sanitasi, pacing typewriter, deteksi vision.
- Yang **tidak** teruji otomatis: alur browser nyata (IndexedDB asli, streaming dengan API key, layout mobile). Bagian ini diverifikasi manual dan dicatat di README.
- Modul yang menyentuh DOM (`images.ts` downscale) dibagi sedemikian rupa sehingga helper murninya tetap bisa dites di Node.

## Deployment

- Build produksi memakai `@sveltejs/adapter-vercel`; output serverless function dengan Node runtime bawaan Vercel.
- `PROVIDER_COOKIE_SECRET` wajib ada di environment Vercel (Production dan Preview). Tanpa itu semua endpoint sesi mengembalikan 503 `server_not_configured`, bukan gagal diam-diam.
- Limit body serverless (~4.5 MB) adalah alasan utama budget lampiran yang ketat; menaikkan batas gambar berarti meninjau ulang angka ini.
