/**
 * SCRIPT GOOGLE APPS SCRIPT (Code.gs)
 * SISTEM PERIZINAN SISWA
 *
 * Spreadsheet ID: 1LkyZO6g3calfnND0YuzECXfNSF_HHluOtSLgzV47k4
 *
 * Struktur Sheet:
 *   Data_Siswa kelas 10  -> kolom: id_kartu | uid_kartu | nama | kelas | status_izin
 *   Data_Siswa kelas 8   -> kolom: id_kartu | uid_kartu | nama | kelas | status_izin
 *   Data_Guru            -> kolom: id_guru | nip | nama (dipakai sebagai username) | mata_pelajaran | status | sandi
 *   Log_Perizinan        -> kolom: id_log | uid_kartu | nama_siswa | waktu_diberi_izin | waktu_scan_keluar | batas_waktu_kembali | waktu_scan_kembali | status
 */

var SPREADSHEET_ID = '1LkyZO6g3calfnND0YuzECXfNSF_HHluOtSLgzV47k4';

// Nilai kolom status_izin
var STATUS_DIIZINKAN = 'Diizinkan';
var STATUS_MENUNGGU  = 'Menunggu Persetujuan';   // guru sudah minta izin, belum disetujui kepala asrama

/* =========================================================
   HELPER: BUKA SPREADSHEET
========================================================= */
function getSS() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (e) {}
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    return null;
  }
}

function json(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================
   ENTRY POINTS
========================================================= */
function doGet(e) {
  return handleRequest(e && e.parameter ? e.parameter : {});
}

function doPost(e) {
  var p = {};
  if (e && e.postData && e.postData.contents) {
    try { p = JSON.parse(e.postData.contents); } catch (x) { p = e.parameter || {}; }
  } else if (e && e.parameter) {
    p = e.parameter;
  }
  return handleRequest(p);
}

function handleRequest(p) {
  try {
    var action = p.action || 'getClasses';
    if      (action === 'ping')                               return ping();
    else if (action === 'loginGuru')                          return loginGuru(p.username, p.password);
    else if (action === 'getClasses')                         return getClasses();
    else if (action === 'getStudentsByClass')                 return getStudentsByClass(p.className);
    else if (action === 'getLogs')                            return getLogs();
    else if (action === 'searchStudents')                     return searchStudents(p.q);
    else if (action === 'getPending')                         return getPending(p.username);
    else if (action === 'approveIzin')                        return prosesPersetujuan(p.uids, p.username, p.peminta, true);
    else if (action === 'rejectIzin')                         return prosesPersetujuan(p.uids, p.username, p.peminta, false);
    else if (action === 'setDiizinkan' || action === 'grantPermission') return setStatusDiizinkan(p.nama, p.uid_kartu, p.batas_waktu_kembali, p.username, p.peminta);
    else if (action === 'setDiizinkanBanyak')                 return setStatusDiizinkanBanyak(p.uids, p.batas_waktu_kembali, p.username, p.peminta);
    else if (action === 'resetPermission')                    return setStatusReset(p.nama, p.uid_kartu);
    else if (action === 'updateStudent')                      return updateStudent(p);
    else if (action === 'scanCard')                           return scanCard(p.uid_kartu);
    else return json({ success: false, message: 'Action tidak dikenal: ' + action });
  } catch (err) {
    return json({ success: false, message: err.toString() });
  }
}

/* =========================================================
   PING / DIAGNOSA — buka  <URL-exec>?action=ping  di browser
   Menampilkan versi kode yang aktif, spreadsheet yang terbaca,
   dan judul kolom Data_Guru (TANPA menampilkan sandi).
========================================================= */
function ping() {
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet. Periksa SPREADSHEET_ID.' });

  var info = {
    success: true,
    versi: 'v5-approval-kepala-asrama',
    spreadsheet: ss.getName(),
    spreadsheet_id: ss.getId(),
    sheets: ss.getSheets().map(function (sh) { return sh.getName(); })
  };

  var g = ss.getSheetByName('Data_Guru');
  if (!g) {
    info.data_guru = 'TIDAK DITEMUKAN (nama tab harus persis: Data_Guru)';
  } else {
    var d = g.getDataRange().getValues();
    info.data_guru = {
      header: d.length ? d[0] : [],
      jumlah_akun: Math.max(d.length - 1, 0),
      username_terbaca: d.slice(1).map(function (r) { return String(r[2] || '').trim(); })
    };
  }
  return json(info);
}

/* =========================================================
   LOGIN GURU — cek sheet Data_Guru
   Kolom: A=id_guru | B=nip | C=nama (= username login) | D=mata_pelajaran | E=status | F=sandi
   Kolom dicari berdasarkan JUDUL di baris 1, jadi urutan kolom boleh berubah.
   Jika ada kolom "username" terpisah, kolom itu yang dipakai sebagai username.
========================================================= */
function findCol(headers, names, fallbackIndex) {
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i] || '').trim().toLowerCase();
    if (names.indexOf(h) !== -1) return i;
  }
  return fallbackIndex;
}

// Akun dengan mata_pelajaran "kepala asrama" (atau kepala_asrama) = penyetuju izin
function isKepalaMapel(mapel) {
  return /kepala[\s_]*asrama/i.test(String(mapel || ''));
}

// Cek di sheet Data_Guru apakah username ini aktif DAN berperan kepala asrama
function cekKepalaAsrama(username) {
  var u = String(username || '').trim().toLowerCase();
  if (!u) return false;
  var ss = getSS();
  if (!ss) return false;
  var sheet = ss.getSheetByName('Data_Guru');
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return false;

  var head   = data[0];
  var cNama  = findCol(head, ['nama'], 2);
  var cUser  = findCol(head, ['username'], cNama);
  var cMapel = findCol(head, ['mata_pelajaran', 'mata pelajaran', 'mapel'], 3);
  var cStat  = findCol(head, ['status'], 4);

  for (var r = 1; r < data.length; r++) {
    if (String(data[r][cUser] || '').trim().toLowerCase() !== u) continue;
    return String(data[r][cStat] || '').trim().toLowerCase() === 'aktif' && isKepalaMapel(data[r][cMapel]);
  }
  return false;
}

function loginGuru(username, password) {
  if (!username || !password) {
    return json({ success: false, message: 'Username dan sandi wajib diisi' });
  }

  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  var sheet = ss.getSheetByName('Data_Guru');
  if (!sheet) return json({ success: false, message: 'Sheet Data_Guru tidak ditemukan' });

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return json({ success: false, message: 'Data_Guru masih kosong' });

  var head   = data[0];
  var cNama  = findCol(head, ['nama'], 2);
  var cUser  = findCol(head, ['username'], cNama);   // tanpa kolom username -> pakai kolom nama
  var cMapel = findCol(head, ['mata_pelajaran', 'mata pelajaran', 'mapel'], 3);
  var cStat  = findCol(head, ['status'], 4);
  var cSandi = findCol(head, ['sandi', 'password', 'kata sandi'], 5);

  var uInput = String(username).trim().toLowerCase();
  var pInput = String(password).trim();

  for (var r = 1; r < data.length; r++) {
    var row        = data[r];
    var uSheet     = String(row[cUser]  || '').trim().toLowerCase();
    var statusGuru = String(row[cStat]  || '').trim().toLowerCase();
    var sandiSheet = String(row[cSandi] || '').trim();
    var namaGuru   = String(row[cNama]  || row[cUser] || '').trim();

    if (uSheet && uSheet === uInput && sandiSheet === pInput) {
      if (statusGuru !== 'aktif') {
        return json({ success: false, message: 'Akun guru tidak aktif. Hubungi administrator.' });
      }
      return json({
        success: true,
        nama: namaGuru,
        username: String(row[cUser]).trim(),
        mata_pelajaran: String(row[cMapel] || '').trim(),
        kepala_asrama: isKepalaMapel(row[cMapel]),
        message: 'Login berhasil'
      });
    }
  }

  return json({ success: false, message: 'Username atau sandi salah' });
}

/* =========================================================
   AMBIL DAFTAR KELAS
   (semua sheet kecuali Data_Guru dan Log_Perizinan)
========================================================= */
function getClasses() {
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  var excluded = ['data_guru', 'log_perizinan'];
  var sheets   = ss.getSheets();
  var classes  = [];

  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (excluded.indexOf(name.toLowerCase()) !== -1) continue;

    // Ambil nama kelas: "Data_Siswa kelas 10" -> "kelas 10"
    var cleanName = name
      .replace(/^Data_Siswa\s*/i, '')
      .trim();

    classes.push({ sheetName: name, className: cleanName || name });
  }

  return json({ success: true, classes: classes });
}

/* =========================================================
   AMBIL DATA SISWA PER KELAS
========================================================= */
function getStudentsByClass(className) {
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  // Cari sheet yang cocok
  var sheet = ss.getSheetByName(className)
    || ss.getSheetByName('Data_Siswa ' + className)
    || ss.getSheetByName('Data_Siswa kelas ' + className);

  if (!sheet) {
    // Coba cari sheet yang namanya mengandung className
    var sheets = ss.getSheets();
    for (var i = 0; i < sheets.length; i++) {
      var sn = sheets[i].getName().toLowerCase();
      if (sn.indexOf(className.toLowerCase()) !== -1 && sn.indexOf('guru') === -1 && sn.indexOf('log') === -1) {
        sheet = sheets[i];
        break;
      }
    }
  }

  if (!sheet) return json({ success: false, message: 'Sheet untuk kelas "' + className + '" tidak ditemukan' });

  // Cabut dulu izin yang sudah lewat batas waktunya
  expireStaleGrants(ss);

  var data     = sheet.getDataRange().getValues();
  var students = [];
  var izinMap  = semuaIzin();

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    // Lewati baris kosong
    if (!row[0] && !row[1] && !row[2]) continue;
    students.push(bangunSiswa(row, r, className, izinMap));
  }

  return json({ success: true, students: students, sheetName: sheet.getName() });
}

// Susun objek siswa dari satu baris sheet (dipakai getStudentsByClass & searchStudents)
function bangunSiswa(row, r, className, izinMap) {
  var stIzin = String(row[4] || 'Tidak Diizinkan').trim();
  var kunci  = String(row[1] || '').trim().toLowerCase() || String(row[2] || '').trim().toLowerCase();
  var aktif  = (stIzin === STATUS_DIIZINKAN || stIzin === STATUS_MENUNGGU);
  var infoIz = aktif ? izinMap[kunci] : null;

  return {
    id_kartu  : String(row[0] || ''),
    uid_kartu : String(row[1] || ('CARD-' + (1000 + r))),
    nama      : String(row[2] || ''),
    kelas     : String(row[3] || className),
    status_izin: stIzin,
    izin_berakhir: infoIz ? infoIz.exp : null,     // epoch ms; dipakai tampilan untuk ikut kedaluwarsa
    batas_waktu_kembali: infoIz ? (infoIz.batas || '') : '',
    peminta   : infoIz ? (infoIz.peminta || '') : ''
  };
}

/* =========================================================
   CARI SISWA DI SEMUA KELAS (tanpa harus memilih kelas)
   Cocok dengan nama / UID kartu / ID kartu (mengandung teks).
========================================================= */
function searchStudents(q) {
  var needle = String(q || '').trim().toLowerCase();
  if (needle.length < 2) return json({ success: true, students: [] });

  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  expireStaleGrants(ss);

  var izinMap = semuaIzin();
  var hasil   = [];
  var LIMIT   = 50;
  var sheets  = ss.getSheets();

  for (var s = 0; s < sheets.length && hasil.length < LIMIT; s++) {
    var sheet = sheets[s];
    var name  = sheet.getName();
    var sn    = name.toLowerCase();
    if (sn === 'data_guru' || sn === 'log_perizinan') continue;

    var cleanName = name.replace(/^Data_Siswa\s*/i, '').trim() || name;
    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length && hasil.length < LIMIT; r++) {
      var row = data[r];
      if (!row[0] && !row[1] && !row[2]) continue;
      var hay = (String(row[0] || '') + ' ' + String(row[1] || '') + ' ' + String(row[2] || '')).toLowerCase();
      if (hay.indexOf(needle) === -1) continue;
      var siswa = bangunSiswa(row, r, cleanName, izinMap);
      siswa.nama_kelas = cleanName;
      hasil.push(siswa);
    }
  }

  return json({ success: true, students: hasil });
}

/* =========================================================
   SET STATUS "Diizinkan" DI KOLOM E
========================================================= */
function setStatusDiizinkan(nama, uid_kartu, batasWaktu, username, peminta) {
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  // Kepala asrama langsung "Diizinkan"; guru lain -> "Menunggu Persetujuan"
  // sampai disetujui kepala asrama. Ditentukan SERVER dari Data_Guru.
  var kepala     = cekKepalaAsrama(username);
  var statusBaru = kepala ? STATUS_DIIZINKAN : STATUS_MENUNGGU;
  var namaPeminta = String(peminta || username || '').trim();

  // Waktu SELALU dari server dalam WIB (jam perangkat guru tidak dipakai,
  // supaya tanggal tidak bergeser akibat zona waktu / jam HP yang salah)
  var waktuIzin = formatDate(new Date());

  var sNama = String(nama || '').trim().toLowerCase();
  var sUid  = String(uid_kartu || '').trim().toLowerCase();

  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sn    = sheet.getName().toLowerCase();
    if (sn === 'data_guru' || sn === 'log_perizinan') continue;

    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var cUid  = String(data[r][1] || '').trim().toLowerCase();
      var cNama = String(data[r][2] || '').trim().toLowerCase();

      // Prioritaskan UID; cocokkan nama (persis) hanya jika UID tidak dikirim
      var matchUid  = sUid  && cUid  === sUid;
      var matchNama = !sUid && sNama && cNama === sNama;

      if (matchUid || matchNama) {
        // Simpan kapan izin ini berakhir (dipakai untuk auto-kembali ke "Tidak Diizinkan")
        var batasIzin = batasWaktu || '16:00';
        simpanIzin(cUid || cNama, {
          exp  : hitungKedaluwarsa(batasIzin),
          batas: batasIzin,
          waktu: waktuIzin,
          peminta   : namaPeminta,
          disetujui : kepala ? namaPeminta : ''
        });

        sheet.getRange(r + 1, 5).setValue(statusBaru);
        SpreadsheetApp.flush();

        // Simpan batas waktu + waktu izin di cache
        try {
          var cache = CacheService.getScriptCache();
          var info  = JSON.stringify({ batas: batasWaktu || '16:00', waktu: waktuIzin });
          if (cUid)  cache.put('PERM_' + cUid,  info, 21600);
          if (cNama) cache.put('PERM_' + cNama, info, 21600);
        } catch (e) {}

        return json({
          success: true,
          status: statusBaru,
          message: kepala
            ? 'Status ' + data[r][2] + ' berhasil diubah menjadi "Diizinkan"'
            : 'Permintaan izin ' + data[r][2] + ' dikirim, menunggu persetujuan kepala asrama'
        });
      }
    }
  }

  return json({ success: false, message: 'Siswa tidak ditemukan: ' + (nama || uid_kartu) });
}

/* =========================================================
   SET STATUS "Diizinkan" UNTUK BANYAK SISWA SEKALIGUS
   uids = JSON array UID kartu, mis. ["CARD-1001","CARD-1002"]
   Satu batas waktu berlaku untuk semuanya. Siswa yang sedang
   di luar dilewati (tidak diubah).
========================================================= */
function setStatusDiizinkanBanyak(uidsJson, batasWaktu, username, peminta) {
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  var kepala      = cekKepalaAsrama(username);
  var statusBaru  = kepala ? STATUS_DIIZINKAN : STATUS_MENUNGGU;
  var namaPeminta = String(peminta || username || '').trim();

  var daftar = [];
  try { daftar = JSON.parse(uidsJson || '[]'); } catch (e) { daftar = []; }
  var target = {};
  var total  = 0;
  for (var i = 0; i < daftar.length; i++) {
    var k = String(daftar[i] || '').trim().toLowerCase();
    if (k && !target[k]) { target[k] = true; total++; }
  }
  if (!total) return json({ success: false, message: 'Tidak ada siswa yang dipilih' });

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);   // cegah bentrok dengan scan / pemberian izin lain
  try {
    var batas     = batasWaktu || '16:00';
    var waktuIzin = formatDate(new Date());
    var exp       = hitungKedaluwarsa(batas);

    var props   = {};
    var jumlah  = 0;
    var dilewati = [];
    var sheets  = ss.getSheets();

    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      var sn    = sheet.getName().toLowerCase();
      if (sn === 'data_guru' || sn === 'log_perizinan') continue;

      var data = sheet.getDataRange().getValues();
      for (var r = 1; r < data.length; r++) {
        var key = String(data[r][1] || '').trim().toLowerCase();
        if (!key || !target[key]) continue;
        delete target[key];

        if (String(data[r][4] || '').trim() === 'Sedang Diluar') {
          dilewati.push(String(data[r][2] || ''));
          continue;
        }
        sheet.getRange(r + 1, 5).setValue(statusBaru);
        props[IZIN_PREFIX + key] = JSON.stringify({
          exp: exp, batas: batas, waktu: waktuIzin,
          peminta: namaPeminta, disetujui: kepala ? namaPeminta : ''
        });
        jumlah++;
      }
    }

    if (jumlah) PropertiesService.getScriptProperties().setProperties(props);
    SpreadsheetApp.flush();

    return json({
      success: jumlah > 0,
      jumlah: jumlah,
      status: statusBaru,
      dilewati: dilewati,
      tidak_ditemukan: Object.keys(target),
      message: kepala ? (jumlah + ' siswa diizinkan')
                      : (jumlah + ' permintaan izin dikirim, menunggu persetujuan kepala asrama')
    });
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
   APPROVAL KEPALA ASRAMA
   Daftar permintaan izin berstatus "Menunggu Persetujuan".
========================================================= */
function getPending(username) {
  if (!cekKepalaAsrama(username)) {
    return json({ success: false, message: 'Hanya kepala asrama yang dapat melihat daftar approval.' });
  }
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  expireStaleGrants(ss);

  var izinMap = semuaIzin();
  var out     = [];
  var sheets  = ss.getSheets();

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sn    = sheet.getName().toLowerCase();
    if (sn === 'data_guru' || sn === 'log_perizinan') continue;
    var cleanName = sheet.getName().replace(/^Data_Siswa\s*/i, '').trim() || sheet.getName();

    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (String(data[r][4] || '').trim() !== STATUS_MENUNGGU) continue;
      var kunci = String(data[r][1] || '').trim().toLowerCase() || String(data[r][2] || '').trim().toLowerCase();
      var info  = izinMap[kunci] || {};
      out.push({
        uid_kartu : String(data[r][1] || ''),
        nama      : String(data[r][2] || ''),
        kelas     : String(data[r][3] || cleanName),
        nama_kelas: cleanName,
        peminta   : info.peminta || '',
        batas     : info.batas || '',
        waktu     : info.waktu || '',
        izin_berakhir: info.exp || null
      });
    }
  }
  return json({ success: true, pending: out });
}

// Setujui / tolak satu atau banyak permintaan. uids = JSON array UID kartu.
function prosesPersetujuan(uidsJson, username, namaPenyetuju, setuju) {
  if (!cekKepalaAsrama(username)) {
    return json({ success: false, message: 'Hanya kepala asrama yang dapat menyetujui atau menolak izin.' });
  }
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  var daftar = [];
  try { daftar = JSON.parse(uidsJson || '[]'); } catch (e) { daftar = []; }
  var target = {};
  var total  = 0;
  for (var i = 0; i < daftar.length; i++) {
    var k = String(daftar[i] || '').trim().toLowerCase();
    if (k && !target[k]) { target[k] = true; total++; }
  }
  if (!total) return json({ success: false, message: 'Tidak ada siswa yang dipilih' });

  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    expireStaleGrants(ss);

    var penyetuju = String(namaPenyetuju || username || '').trim();
    var props     = PropertiesService.getScriptProperties();
    var jumlah    = 0;
    var dilewati  = [];
    var logSheet  = null;
    var sheets    = ss.getSheets();

    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      var sn    = sheet.getName().toLowerCase();
      if (sn === 'data_guru' || sn === 'log_perizinan') continue;

      var data = sheet.getDataRange().getValues();
      for (var r = 1; r < data.length; r++) {
        var uidKey = String(data[r][1] || '').trim().toLowerCase();
        if (!uidKey || !target[uidKey]) continue;
        delete target[uidKey];

        if (String(data[r][4] || '').trim() !== STATUS_MENUNGGU) {
          dilewati.push(String(data[r][2] || ''));   // sudah diproses / kedaluwarsa / di-reset
          continue;
        }

        var info = bacaIzin(uidKey) || {};
        if (setuju) {
          if (!info.exp) { info.batas = info.batas || '16:00'; info.exp = hitungKedaluwarsa(info.batas); }
          info.disetujui = penyetuju;
          sheet.getRange(r + 1, 5).setValue(STATUS_DIIZINKAN);
          props.setProperty(IZIN_PREFIX + uidKey, JSON.stringify(info));
        } else {
          sheet.getRange(r + 1, 5).setValue('Tidak Diizinkan');
          props.deleteProperty(IZIN_PREFIX + uidKey);
          if (!logSheet) logSheet = getOrCreateLogSheet(ss);
          appendLogRow(logSheet, [
            'LOG-' + Math.floor(100000 + Math.random() * 900000),
            String(data[r][1] || ''), String(data[r][2] || ''),
            info.waktu || '', '', info.batas || '', '', 'Izin Ditolak Kepala Asrama (' + penyetuju + ')'
          ]);
        }
        jumlah++;
      }
    }
    SpreadsheetApp.flush();

    return json({
      success: jumlah > 0,
      jumlah: jumlah,
      dilewati: dilewati,
      tidak_ditemukan: Object.keys(target),
      message: jumlah + (setuju ? ' izin disetujui' : ' izin ditolak')
    });
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================
   RESET STATUS "Tidak Diizinkan"
========================================================= */
function setStatusReset(nama, uid_kartu) {
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  var sNama = String(nama || '').trim().toLowerCase();
  var sUid  = String(uid_kartu || '').trim().toLowerCase();

  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sn    = sheet.getName().toLowerCase();
    if (sn === 'data_guru' || sn === 'log_perizinan') continue;

    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var cUid  = String(data[r][1] || '').trim().toLowerCase();
      var cNama = String(data[r][2] || '').trim().toLowerCase();

      if ((sUid && cUid === sUid) || (sNama && cNama === sNama)) {
        var wasOutside = String(data[r][4] || '') === 'Sedang Diluar';
        hapusIzin(String(data[r][1] || '').trim().toLowerCase() || String(data[r][2] || '').trim().toLowerCase());
        sheet.getRange(r + 1, 5).setValue('Tidak Diizinkan');

        // Jika siswa masih tercatat "Sedang Diluar" di log, tutup baris log itu
        // agar tidak terus muncul di filter "Diluar".
        if (wasOutside) {
          var logSheet = getOrCreateLogSheet(ss);
          var logData  = logSheet.getDataRange().getDisplayValues();
          var uidRow   = String(data[r][1] || '').trim();
          for (var l = logData.length - 1; l >= 1; l--) {
            if (String(logData[l][1]).trim() === uidRow &&
                !logData[l][6] &&
                String(logData[l][7]).indexOf('Sedang Diluar') !== -1) {
              setTextCell(logSheet, l + 1, 7, formatDate(new Date()));
              setTextCell(logSheet, l + 1, 8, 'Di-reset Guru');
              break;
            }
          }
        }
        SpreadsheetApp.flush();
        return json({ success: true, message: 'Status ' + data[r][2] + ' berhasil di-reset' });
      }
    }
  }

  return json({ success: false, message: 'Siswa tidak ditemukan' });
}

/* =========================================================
   UPDATE DATA SISWA
========================================================= */
function updateStudent(p) {
  var ss  = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  var key = String(p.old_uid_kartu || p.uid_kartu || p.nama || '').trim().toLowerCase();

  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sn    = sheet.getName().toLowerCase();
    if (sn === 'data_guru' || sn === 'log_perizinan') continue;

    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var cUid  = String(data[r][1] || '').trim().toLowerCase();
      var cNama = String(data[r][2] || '').trim().toLowerCase();

      if (cUid === key || cNama === key) {
        if (p.id_kartu   !== undefined) sheet.getRange(r + 1, 1).setValue(p.id_kartu);
        if (p.uid_kartu  !== undefined) sheet.getRange(r + 1, 2).setValue(p.uid_kartu);
        if (p.nama       !== undefined) sheet.getRange(r + 1, 3).setValue(p.nama);
        if (p.kelas      !== undefined) sheet.getRange(r + 1, 4).setValue(p.kelas);
        if (p.status_izin!== undefined) sheet.getRange(r + 1, 5).setValue(p.status_izin);
        SpreadsheetApp.flush();
        return json({ success: true, message: 'Data siswa berhasil diperbarui' });
      }
    }
  }

  return json({ success: false, message: 'Siswa tidak ditemukan' });
}

/* =========================================================
   SCAN KARTU RFID/BARCODE
========================================================= */
function scanCard(uid_kartu) {
  var ss = getSS();
  if (!ss) return json({ success: false, type: 'ERROR', message: 'Tidak dapat membuka spreadsheet' });

  // Izin yang lewat batas waktu otomatis kembali ke "Tidak Diizinkan" sebelum dicek
  expireStaleGrants(ss);

  var uidClean = String(uid_kartu || '').trim().toLowerCase();
  var student  = null;
  var targetSheet    = null;
  var targetRowIndex = -1;

  var sheets = ss.getSheets();
  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sn    = sheet.getName().toLowerCase();
    if (sn === 'data_guru' || sn === 'log_perizinan') continue;

    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var cId   = String(data[r][0] || '').trim().toLowerCase();
      var cUid  = String(data[r][1] || '').trim().toLowerCase();
      var cNama = String(data[r][2] || '').trim().toLowerCase();

      if (cUid === uidClean || cId === uidClean || cNama === uidClean) {
        student = {
          id_kartu  : String(data[r][0]),
          uid_kartu : String(data[r][1]),
          nama      : String(data[r][2]),
          kelas     : String(data[r][3]),
          status_izin: String(data[r][4] || 'Tidak Diizinkan')
        };
        targetSheet    = sheet;
        targetRowIndex = r + 1;
        break;
      }
    }
    if (student) break;
  }

  if (!student) {
    return json({ success: false, type: 'DENIED', message: 'Kartu tidak terdaftar: ' + uid_kartu });
  }

  var nowStr   = formatDate(new Date());
  var logSheet = getOrCreateLogSheet(ss);

  if (student.status_izin === 'Diizinkan') {
    targetSheet.getRange(targetRowIndex, 5).setValue('Sedang Diluar');
    SpreadsheetApp.flush();

    // Ambil info izin dari cache (waktu diberi izin + batas kembali)
    var waktuIzin = nowStr;
    var batasWaktu = '';
    try {
      var cache = CacheService.getScriptCache();
      var cacheKey = student.uid_kartu.toLowerCase() || student.nama.toLowerCase();
      var cached = cache.get('PERM_' + cacheKey);
      if (!cached && student.nama) cached = cache.get('PERM_' + student.nama.toLowerCase());
      if (cached) {
        var info = JSON.parse(cached);
        waktuIzin  = info.waktu  || nowStr;
        batasWaktu = info.batas  || '';
      }
    } catch (e) {}

    // Data izin yang tersimpan permanen lebih akurat daripada cache (cache bisa hilang)
    var kunciIzin = student.uid_kartu.toLowerCase() || student.nama.toLowerCase();
    var izinInfo  = bacaIzin(kunciIzin);
    if (izinInfo) {
      waktuIzin  = izinInfo.waktu || waktuIzin;
      batasWaktu = izinInfo.batas || batasWaktu;
    }
    hapusIzin(kunciIzin);   // siswa sudah keluar, izin sudah terpakai

    appendLogRow(logSheet, [
      'LOG-' + Math.floor(100000 + Math.random() * 900000),
      student.uid_kartu, student.nama,
      waktuIzin,          // waktu_diberi_izin
      nowStr,             // waktu_scan_keluar
      batasWaktu,         // batas_waktu_kembali
      '',                 // waktu_scan_kembali (diisi saat kembali)
      'Sedang Diluar'
    ]);
    SpreadsheetApp.flush();
    return json({ success: true, type: 'SCAN_OUT', message: student.nama + ' keluar kelas.', student: student });

  } else if (student.status_izin === 'Sedang Diluar') {
    targetSheet.getRange(targetRowIndex, 5).setValue('Tidak Diizinkan');
    SpreadsheetApp.flush();

    // Update log: isi waktu kembali + tentukan status tepat waktu / telat
    var logData  = logSheet.getDataRange().getDisplayValues();
    for (var l = logData.length - 1; l >= 1; l--) {
      if (String(logData[l][1]).trim() === student.uid_kartu &&
          !logData[l][6] &&
          String(logData[l][7]).indexOf('Sedang Diluar') !== -1) {
        var batas = String(logData[l][5] || '').trim(); // HH:MM
        var statusKembali = 'Kembali';
        if (/^\d{1,2}:\d{2}/.test(batas)) {
          // Bandingkan jam sekarang (WIB) dengan batas
          var parts  = batas.split(':');
          var batasH = parseInt(parts[0], 10);
          var batasM = parseInt(parts[1], 10);
          var nowParts = Utilities.formatDate(new Date(), 'Asia/Jakarta', 'HH:mm').split(':');
          var nowH = parseInt(nowParts[0], 10);
          var nowM = parseInt(nowParts[1], 10);
          if (nowH < batasH || (nowH === batasH && nowM <= batasM)) {
            statusKembali = 'Kembali Tepat Waktu';
          } else {
            statusKembali = 'Kembali Telat';
          }
        }
        setTextCell(logSheet, l + 1, 7, nowStr);
        setTextCell(logSheet, l + 1, 8, statusKembali);
        SpreadsheetApp.flush();
        break;
      }
    }
    return json({ success: true, type: 'SCAN_IN', message: student.nama + ' telah kembali.', student: student });

  } else {
    // Log penolakan
    appendLogRow(logSheet, [
      'LOG-' + Math.floor(100000 + Math.random() * 900000),
      student.uid_kartu, student.nama,
      nowStr, nowStr, '', '', 'Ditolak'
    ]);
    SpreadsheetApp.flush();
    var pesanTolak = (student.status_izin === STATUS_MENUNGGU)
      ? 'AKSES DITOLAK: izin ' + student.nama + ' masih menunggu persetujuan kepala asrama!'
      : 'AKSES DITOLAK: ' + student.nama + ' belum mendapat izin guru!';
    return json({ success: false, type: 'DENIED', message: pesanTolak, student: student });
  }
}

/* =========================================================
   AMBIL LOG RIWAYAT
========================================================= */
function getLogs() {
  var ss = getSS();
  if (!ss) return json({ success: false, message: 'Tidak dapat membuka spreadsheet' });

  var logSheet = getOrCreateLogSheet(ss);
  // getDisplayValues: ambil teks persis seperti tampil di sheet,
  // sehingga tanggal tidak berubah jadi objek Date / tahun aneh.
  var data     = logSheet.getDataRange().getDisplayValues();
  var logs     = [];

  for (var i = data.length - 1; i >= 1; i--) {
    if (!data[i][0] && !data[i][2]) continue;
    logs.push({
      id_log              : String(data[i][0] || ''),
      uid_kartu           : String(data[i][1] || ''),
      nama_siswa          : String(data[i][2] || ''),
      waktu_diberi_izin   : String(data[i][3] || ''),
      waktu_scan_keluar   : String(data[i][4] || ''),
      batas_waktu_kembali : String(data[i][5] || ''),
      waktu_scan_kembali  : String(data[i][6] || ''),
      status              : String(data[i][7] || '')
    });
  }

  return json({ success: true, logs: logs });
}

/* =========================================================
   IZIN KEDALUWARSA
   Izin "Diizinkan" yang tidak dipakai (siswa tidak scan keluar)
   sampai lewat batas waktu -> otomatis kembali "Tidak Diizinkan".
   Data waktu berakhir disimpan di Script Properties (awet, tidak
   hilang seperti cache).
========================================================= */
var IZIN_PREFIX = 'IZIN_';

// Hitung kapan izin berakhir (epoch ms) dari jam batas "HH:MM" dalam WIB.
// Jika jam itu sudah lewat hari ini, dianggap besok (kasus melewati tengah malam).
function hitungKedaluwarsa(batas, sekarangMs) {
  var now = sekarangMs || Date.now();
  var m = /^(\d{1,2}):(\d{2})/.exec(String(batas || '').trim());
  if (!m) m = [null, '16', '00'];
  var jam  = ('0' + m[1]).slice(-2);
  var hari = Utilities.formatDate(new Date(now), 'Asia/Jakarta', 'yyyy-MM-dd');
  var exp  = new Date(hari + 'T' + jam + ':' + m[2] + ':00+07:00').getTime();
  if (exp <= now) exp += 24 * 60 * 60 * 1000;
  return exp;
}

function simpanIzin(kunci, info) {
  if (!kunci) return;
  PropertiesService.getScriptProperties().setProperty(IZIN_PREFIX + kunci, JSON.stringify(info));
}

function bacaIzin(kunci) {
  if (!kunci) return null;
  var v = PropertiesService.getScriptProperties().getProperty(IZIN_PREFIX + kunci);
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}

function hapusIzin(kunci) {
  if (!kunci) return;
  PropertiesService.getScriptProperties().deleteProperty(IZIN_PREFIX + kunci);
}

function semuaIzin() {
  var all = PropertiesService.getScriptProperties().getProperties();
  var out = {};
  for (var k in all) {
    if (k.indexOf(IZIN_PREFIX) !== 0) continue;
    try { out[k.substring(IZIN_PREFIX.length)] = JSON.parse(all[k]); } catch (e) {}
  }
  return out;
}

// Kembalikan ke "Tidak Diizinkan" semua siswa berstatus "Diizinkan" yang izinnya sudah lewat.
// Murah: kalau belum ada yang jatuh tempo, sheet tidak disentuh sama sekali.
function expireStaleGrants(ss) {
  var izin = semuaIzin();
  var now  = Date.now();
  var jatuhTempo = {};
  var ada = 0;
  for (var k in izin) {
    if (izin[k] && izin[k].exp && now >= izin[k].exp) { jatuhTempo[k] = izin[k]; ada++; }
  }
  if (!ada) return 0;

  ss = ss || getSS();
  if (!ss) return 0;

  var props    = PropertiesService.getScriptProperties();
  var logSheet = null;
  var jumlah   = 0;
  var sheets   = ss.getSheets();

  for (var s = 0; s < sheets.length; s++) {
    var sheet = sheets[s];
    var sn    = sheet.getName().toLowerCase();
    if (sn === 'data_guru' || sn === 'log_perizinan') continue;

    var data = sheet.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var stBaris = String(data[r][4] || '').trim();
      if (stBaris !== STATUS_DIIZINKAN && stBaris !== STATUS_MENUNGGU) continue;
      var kunci = String(data[r][1] || '').trim().toLowerCase() || String(data[r][2] || '').trim().toLowerCase();
      var info  = jatuhTempo[kunci];
      if (!info) continue;

      sheet.getRange(r + 1, 5).setValue('Tidak Diizinkan');
      props.deleteProperty(IZIN_PREFIX + kunci);
      delete jatuhTempo[kunci];

      if (!logSheet) logSheet = getOrCreateLogSheet(ss);
      appendLogRow(logSheet, [
        'LOG-' + Math.floor(100000 + Math.random() * 900000),
        String(data[r][1] || ''), String(data[r][2] || ''),
        info.waktu || '', '', info.batas || '', '',
        stBaris === STATUS_MENUNGGU ? 'Permintaan Izin Kedaluwarsa' : 'Izin Kedaluwarsa'
      ]);
      jumlah++;
    }
  }

  // Sisa catatan jatuh tempo yang siswanya sudah tidak "Diizinkan" (di-reset/diubah manual)
  for (var sisa in jatuhTempo) props.deleteProperty(IZIN_PREFIX + sisa);

  SpreadsheetApp.flush();
  return jumlah;
}

// ---- Dijalankan otomatis oleh trigger waktu (lihat pasangTriggerKedaluwarsa)
function jalankanKedaluwarsa() {
  expireStaleGrants();
}

// Jalankan SEKALI dari editor Apps Script (pilih fungsi ini lalu klik Run).
// Membuat trigger yang memeriksa izin kedaluwarsa tiap 1 menit, bahkan saat
// tidak ada yang membuka aplikasi.
function pasangTriggerKedaluwarsa() {
  var lama = ScriptApp.getProjectTriggers();
  for (var i = 0; i < lama.length; i++) {
    if (lama[i].getHandlerFunction() === 'jalankanKedaluwarsa') ScriptApp.deleteTrigger(lama[i]);
  }
  ScriptApp.newTrigger('jalankanKedaluwarsa').timeBased().everyMinutes(1).create();
}

/* =========================================================
   HELPER
========================================================= */
function getOrCreateLogSheet(ss) {
  var sheet = ss.getSheetByName('Log_Perizinan');
  if (!sheet) {
    sheet = ss.insertSheet('Log_Perizinan');
    sheet.appendRow([
      'id_log', 'uid_kartu', 'nama_siswa',
      'waktu_diberi_izin', 'waktu_scan_keluar',
      'batas_waktu_kembali', 'waktu_scan_kembali', 'status'
    ]);
  }
  return sheet;
}

// Tambah baris log dengan kolom bertipe TEKS (format '@') agar Google Sheets
// tidak mengubah "07/11/2026 07:37" menjadi tanggal yang tertukar hari/bulan.
function appendLogRow(sheet, row) {
  var r = sheet.getLastRow() + 1;
  var range = sheet.getRange(r, 1, 1, row.length);
  range.setNumberFormat('@');
  range.setValues([row]);
}

function setTextCell(sheet, row, col, value) {
  var c = sheet.getRange(row, col);
  c.setNumberFormat('@');
  c.setValue(value);
}

function formatDate(date) {
  return Utilities.formatDate(
    date,
    'Asia/Jakarta',   // WIB eksplisit, bukan bergantung script timezone
    'dd/MM/yyyy HH:mm'
  );
}
