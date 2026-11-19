# Jarvis

Pembantu suara AI untuk Mac. Cakap dengan Jarvis, dan dia mengawal Mac anda: muzik, emel, kalendar, peringatan, nota, kenalan, foto, fail, browser dan tetapan sistem. Wajah robot 3D menggerakkan bibir, pipi, kening dan mata semasa bercakap.

*A voice assistant for your Mac. Talk to Jarvis and it controls your Mac: music, email, calendar, reminders, notes, contacts, photos, files, browser and system settings. English guide below.*

## Pasang

Tampal baris ini dalam app **Terminal**, kemudian tekan Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/AppMeraung/jarvis/main/get.sh | zsh
```

Jarvis terbuka sendiri. Kemudian:

1. Tekan **TETAPAN**, tampal kunci API Gemini anda (percuma dari [aistudio.google.com/apikey](https://aistudio.google.com/apikey)), tekan **SIMPAN**.
2. Tekan **MULA**, benarkan mikrofon, dan cakap terus.

### Keperluan

- Mac dengan macOS 13 atau lebih baru
- [Node.js](https://nodejs.org) versi 20 atau lebih baru
- Google Chrome (disyorkan) atau Safari
- Kunci API Gemini anda sendiri

## Apa yang ada

- **Lebih 50 kebolehan** dalam 14 kumpulan. Butang **PANDUAN** dalam Jarvis menyenaraikan semuanya.
- **Suis kebenaran** untuk setiap kumpulan (Spotify, emel, kalendar, fail dan lain-lain). Matikan apa yang anda tidak mahu Jarvis sentuh.
- **Pengesahan di skrin** sebelum hantar emel, padam fail, jalankan skrip, restart atau shutdown.
- **Bahasa**: Jarvis bercakap Melayu, English, Indonesia, Mandarin, Tamil atau Arab. Paparan dalam Melayu, English atau Indonesia.
- **Jarvis Mini**: kepala kecil yang terapung di tepi skrin. Buka dari folder Applications anda selepas pemasangan.
- **Tanpa tangan**: sebut **"Hai Jarvis"** untuk mula, **"Bye Jarvis"** atau **"Ok stop Jarvis"** untuk henti. Boleh dimatikan di Tetapan. Semasa menunggu, pengecaman suara pelayar (Google dalam Chrome, Apple dalam Jarvis Mini) mendengar mikrofon.
- **Watak**: tukar wajah Jarvis dengan butang **🎭 WATAK**: Robot 3D, Jaringan bercahaya, FacePoly, atau model 3D anda sendiri (.glb). Setiap watak ada suara, nada dan perwatakan sendiri, dan mulut, mata serta badannya bergerak ikut emosi dan perkataan. Tambah watak di Tetapan, kemudian klik mulut dan mata watak sekali. Guna hanya model yang anda berhak guna.
- **Bercerita dan belajar**: dongeng, hikayat dan cerita rakyat Melayu, teka-teki dan kuiz, sejarah Malaysia dan dunia, sains, pengetahuan am, Matematik dan Matematik Tambahan langkah demi langkah dengan kalkulator tepat. Jarvis boleh mencari dan membaca Wikipedia Melayu, Wikipedia Inggeris dan Wikisource Melayu.
- **WhatsApp, emel dan perjalanan**: balasan WhatsApp sudah ditaip (anda tekan hantar sendiri), draf emel yang berbunyi seperti anda, membaca Outlook melalui skrin, carian tiket di Google Flights, itinerari, dan cadangan pakaian ikut cuaca. Jarvis tidak menghantar, menempah atau membayar tanpa anda.
- **Autopilot**: beri Jarvis kerja besar (pindah data, skrip, analisis projek). Jarvis serahkan kepada AI pekerja (Claude Code), menjawab soalannya bagi pihak anda, membetulkan kesilapan, dan melaporkan bila siap. Pekerja bekerja dalam folder `~/Jarvis Kerja` sendiri; sistem menyekatnya daripada mengubah projek, memadam, push atau deploy. Keputusan berisiko tetap ditanya kepada anda.
- **Kemas Mac**: senarai semua projek Git dan mana yang sudah selamat di GitHub, fail lama yang tidak dibuka, cache dan fail besar, serta cadangan susunan. Fail dialih hanya dengan kelulusan anda, dan Jarvis tidak memadam apa-apa sendiri.
- **Ingatan kekal**: Jarvis menyimpan perbualan dan fakta penting tentang anda di Mac ini sahaja, dan mengingatinya pada setiap sesi baharu. Boleh dimatikan di Tetapan; fakta boleh dilupakan atas permintaan.
- **Otak kedua**: untuk soalan yang sangat sukar, Jarvis bertanya Claude (jika [Claude Code](https://claude.com/claude-code) dipasang) dan menyampaikan jawapannya.
- **Kod dan IT**: baca kod projek, semak ralat sintaks, cari penyelesaian di Stack Overflow dan MDN, dan serahkan kerja mengubah kod kepada [Claude Code](https://claude.com/claude-code) jika dipasang (perlu kelulusan anda). Fail rahsia seperti `.env` tidak dibaca.
- **Maklumat dunia terkini**: berita terkini Malaysia dan dunia (Google News), cuaca mana-mana bandar, dan kadar tukaran mata wang, tanpa kunci tambahan.
- **Saiz Jarvis Mini**: Kecil, Sederhana atau Besar (butang di Mini atau di Tetapan).
- **Tetapan dikongsi**: Chrome dan Jarvis Mini guna tetapan yang sama dan dikemas kini serentak.
- **Taklimat harian**: jadual minggu ini, peringatan dan kerja tertangguh setiap kali anda tekan MULA.

## Kebenaran macOS

Kali pertama Jarvis menyentuh sesuatu app, macOS bertanya; tekan **Allow**.

- Menaip, pintasan papan kekunci dan main lagu automatik: System Settings > Privacy & Security > **Accessibility** > benarkan `node`.
- Melihat skrin: System Settings > Privacy & Security > **Screen & System Audio Recording** > benarkan `node`.

## Privasi

Jarvis berjalan di Mac anda dan hanya menerima sambungan dari Mac itu sendiri. Suara anda, dan apa yang Jarvis semak untuk menjawab (emel, kalendar, kenalan, tangkapan skrin), dihantar kepada Google Gemini dengan kunci API anda sendiri. Kos penggunaan Gemini ditanggung oleh akaun Google anda. Kunci disimpan dalam fail di Mac anda sahaja.

## Buang

```bash
zsh ~/Library/Application\ Support/Jarvis/uninstall.command
```

## English

Paste the install line above into **Terminal**. When Jarvis opens, press **TETAPAN** (Settings), choose **English** under language, paste your own Gemini API key, press **SAVE**, then **START**. You need macOS 13+, Node.js 20+ and your own Gemini API key. Say "Hi Jarvis" to start and "Bye Jarvis" to stop. Risky actions (sending email, deleting files, scripts, restart) always ask for confirmation on screen, and each group of abilities can be switched off in Settings.

## Untuk pembangun

Tiada kebergantungan npm. `node server.js` menjalankan pelayan di `localhost:4199`; `node --test` menjalankan ujian; `./package.sh` membina `dist/Jarvis.zip`.

## Lesen

Hak cipta © Meraung. Percuma untuk kegunaan peribadi. Tidak dibenarkan menjual semula atau mengedar semula tanpa kebenaran bertulis.
