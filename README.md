
# Sistem Perizinan Keluar Siswa

Aplikasi web berbasis **HTML, CSS, JavaScript**, dan **Google Apps Script** untuk mengelola pencatatan serta permohonan izin keluar lingkungan sekolah bagi siswa secara digital.

## 📁 Struktur Direktori


perizinankeluar/
├── Code (3).gs        # Backend Google Apps Script (API / integrasi Google Sheets)
├── index.html         # Halaman utama antarmuka pengguna (form & tampilan data)
├── style.css          # Styling dan tata letak responsif aplikasi
├── app.js             # Logika frontend, validasi form, dan komunikasi ke Apps Script
├── logo-sekolah.png   # Aset logo instansi/sekolah
├── LICENSE            # Lisensi proyek (MIT License)
└── README.md          # Dokumentasi proyek



## 🛠️ Teknologi yang Digunakan

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (`app.js`)
* **Backend & Database:** Google Apps Script (`Code (3).gs`) & Google Sheets
* **Lisensi:** MIT License

## 🚀 Cara Instalasi & Konfigurasi

### 1. Konfigurasi Backend (Google Apps Script)

1. Buat **Google Spreadsheet** baru sebagai tempat penyimpanan data perizinan.
2. Buka menu **Extensions (Ekstensi)** > **Apps Script**.
3. Salin seluruh kode dari file `Code (3).gs` ke dalam editor Apps Script.
4. Sesuaikan ID Spreadsheet atau nama *sheet* pada kode (jika diperlukan).
5. Klik **Deploy** > **New deployment**, pilih jenis **Web app**:
* **Execute as:** Me (Akun Anda)
* **Who has access:** Anyone (Siapa saja)


6. Salin **Web App URL** yang dihasilkan.

### 2. Konfigurasi Frontend

1. Buka file `app.js` dan masukkan **Web App URL** dari langkah sebelumnya ke dalam variabel endpoint/URL API.
2. Sesuaikan identitas atau logo sekolah pada `index.html` dan `logo-sekolah.png` jika diperlukan.
3. Jalankan aplikasi dengan membuka `index.html` di browser atau unggah ke layanan *hosting* statis (seperti GitHub Pages, Netlify, atau Vercel).

## 📄 Lisensi

Proyek ini dilisensikan di bawah [MIT License](https://www.google.com/search?q=LICENSE).

```
