/**
 * APP.JS - Sistem Perizinan Keluar Masuk Siswa
 * Login terhubung ke sheet Data_Guru, pilih kelas sebelum lihat siswa
 */

document.addEventListener('DOMContentLoaded', function () {

  /* =========================================================
     CONFIG
  ========================================================= */
  // URL GAS tetap (pengaturan URL di tab sudah dihapus)
  var GAS_URL    = 'https://script.google.com/macros/s/AKfycbwo2CifAvr1X4IcIbdDBH4ybqB5xLKF2h0bGqzuO6T2_PZVoCrMk1ZE8yRpDoVGb_ZozA/exec';
  var LOGIN_KEY  = 'SISWA_SESSION';
  try { localStorage.removeItem('SISWA_GAS_URL'); } catch(e) {}

  var currentUser = null;
  var appMode     = 'LIVE'; // Coba LIVE dulu, fallback ke MOCK
  var classList   = [];
  var studentList = [];
  var selectedClass = '';
  var selectedUids  = {};   // uid -> true, siswa yang dicentang untuk izin massal
  var bulkUids      = null; // daftar uid saat modal izin massal terbuka
  var searchMode    = false; // true = daftar siswa berasal dari pencarian semua kelas
  var searchTimer   = null;
  var searchSeq     = 0;     // penanda agar hasil pencarian lama diabaikan
  var approvalList  = [];    // permintaan izin menunggu persetujuan (khusus kepala asrama)
  var selectedApproval = {}; // uid -> true, permintaan yang dicentang di tab Approval
  var STATUS_MENUNGGU = 'Menunggu Persetujuan';

  // Data siswa lokal (fallback jika GAS tidak tersedia)
  var mockStudents = {
    'kelas 10': [
      { id_kartu:'K10-001', uid_kartu:'CARD-1001', nama:'Afsar Hava Ardana',            kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-002', uid_kartu:'CARD-1002', nama:'Dihya Fuadi Khalifah',          kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-003', uid_kartu:'CARD-1003', nama:'Fadhel Sonneos Wilson Diaby',   kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-004', uid_kartu:'CARD-1004', nama:'Habiburrahma Al Farizi',        kelas:'10', status_izin:'Sedang Diluar'   },
      { id_kartu:'K10-005', uid_kartu:'CARD-1005', nama:'Kgs M. Novriza Harasya',        kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-006', uid_kartu:'CARD-1006', nama:'Muhammad Aji Ghiffari',         kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-007', uid_kartu:'CARD-1007', nama:'Muhammad Azzam Maldini',        kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-008', uid_kartu:'CARD-1008', nama:'Muhammad Fazia Fath',           kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-009', uid_kartu:'CARD-1009', nama:'Muhammad Nur Zakhi',            kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-010', uid_kartu:'CARD-1010', nama:'R. Habibi Musthafa Kamil',      kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-011', uid_kartu:'CARD-1011', nama:'Rizki Ramadhani',               kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-012', uid_kartu:'CARD-1012', nama:'Syariiql Albaasith Gusnadi',    kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-013', uid_kartu:'CARD-1013', nama:'Tb. Ahmad Dzakwan Zain Hibban', kelas:'10', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K10-014', uid_kartu:'CARD-1014', nama:'Zaidan Almaisan Zhafran',       kelas:'10', status_izin:'Tidak Diizinkan' }
    ],
    'kelas 8': [
      { id_kartu:'K8-001', uid_kartu:'CARD-2001', nama:'Siswa Kelas 8 A', kelas:'8', status_izin:'Tidak Diizinkan' },
      { id_kartu:'K8-002', uid_kartu:'CARD-2002', nama:'Siswa Kelas 8 B', kelas:'8', status_izin:'Tidak Diizinkan' }
    ]
  };

  /* =========================================================
     HELPER
  ========================================================= */
  function el(id) { return document.getElementById(id); }

  // Akun dengan mata_pelajaran "kepala asrama" punya dua perizinan (beri izin langsung + approval).
  // Guru lain hanya satu: izin yang mereka beri menunggu persetujuan kepala asrama.
  function isKepala() {
    return !!(currentUser && (currentUser.kepala_asrama || /kepala[\s_]*asrama/i.test(currentUser.mata_pelajaran || '')));
  }

  // Status yang tampil langsung setelah izin diberikan (server tetap penentu akhir)
  function statusLokalBaru() { return isKepala() ? 'Diizinkan' : STATUS_MENUNGGU; }

  function showToast(msg, type) {
    var c = { success:'#059669', warning:'#d97706', info:'#2563eb', error:'#dc2626' };
    var t = document.createElement('div');
    t.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;' +
      'background:' + (c[type]||c.info) + ';color:#fff;padding:12px 20px;' +
      'border-radius:10px;font-size:14px;font-weight:600;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.4);max-width:360px;';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ if(t.parentNode) t.remove(); }, 4000);
  }

  function callGAS(params, timeoutMs) {
    return new Promise(function(resolve, reject) {
      var qs  = Object.keys(params).map(function(k){ return k + '=' + encodeURIComponent(params[k]||''); }).join('&');
      var url = GAS_URL + '?' + qs;
      var id  = setTimeout(function(){ reject(new Error('timeout')); }, timeoutMs || 6000);
      fetch(url, { method:'GET' })
        .then(function(r){ return r.json(); })
        .then(function(d){ clearTimeout(id); resolve(d); })
        .catch(function(e){ clearTimeout(id); reject(e); });
    });
  }

  /* =========================================================
     SISTEM LOGIN
  ========================================================= */
  // Cek sesi yang sudah ada
  try { var s = sessionStorage.getItem(LOGIN_KEY); if (s) currentUser = JSON.parse(s); } catch(e){}

  function doLogin(username, password) {
    var btn  = el('loginBtn');
    var errEl= el('loginError');
    if (btn)  { btn.disabled = true; btn.textContent = 'Memeriksa...'; }
    if (errEl)  errEl.classList.add('hidden');

    function loginFail(msg) {
      if (btn)  { btn.disabled = false; btn.textContent = 'Masuk'; }
      if (errEl){ errEl.textContent = msg || 'Username atau sandi salah.'; errEl.classList.remove('hidden'); }
    }

    function loginOK(user) {
      currentUser = user;
      sessionStorage.setItem(LOGIN_KEY, JSON.stringify(user));
      if (btn) { btn.disabled = false; btn.textContent = 'Masuk'; }
      showMainApp(user.nama || user.username);
    }

    // Login HANYA lewat sheet Data_Guru di Google Sheets.
    // Akun baru/nonaktif cukup diatur admin langsung di spreadsheet.
    callGAS({ action: 'loginGuru', username: username, password: password }, 10000)
      .then(function(res) {
        if (res && res.success) {
          loginOK({
            username       : res.username || username,
            nama           : res.nama || username,
            mata_pelajaran : res.mata_pelajaran || '',
            kepala_asrama  : !!res.kepala_asrama || /kepala[\s_]*asrama/i.test(res.mata_pelajaran || ''),
            role           : (res.mata_pelajaran || '').toLowerCase().indexOf('security') !== -1 ? 'security' : 'guru'
          });
        } else {
          loginFail(res && res.message ? res.message : 'Username atau sandi salah.');
        }
      })
      .catch(function() {
        loginFail('Tidak dapat terhubung ke Google Sheets. Periksa koneksi internet lalu coba lagi.');
      });
  }

  // Form login
  var loginForm = el('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var u = (el('loginUsername')||{}).value || '';
      var p = (el('loginPassword')||{}).value || '';
      if (u.trim() && p) doLogin(u.trim(), p);
    });
  }

  // Tampilkan / sembunyikan sandi
  var toggleBtn = el('togglePassword');
  var pwdField  = el('loginPassword');
  if (toggleBtn && pwdField) {
    toggleBtn.addEventListener('click', function(){
      var show = pwdField.type === 'password';
      pwdField.type = show ? 'text' : 'password';
      toggleBtn.classList.toggle('is-visible', show);
      toggleBtn.setAttribute('aria-pressed', show ? 'true' : 'false');
      toggleBtn.setAttribute('aria-label', show ? 'Sembunyikan sandi' : 'Tampilkan sandi');
    });
  }

  function showLoginScreen() {
    var ls = el('loginScreen');
    var ma = el('mainApp');
    if (ls) ls.style.display = 'flex';
    if (ma) ma.classList.add('hidden');
  }

  function showMainApp(namaGuru) {
    var ls = el('loginScreen');
    var ma = el('mainApp');
    if (ls) ls.style.display = 'none';
    if (ma) ma.classList.remove('hidden');

    // Tampilkan info guru di header
    var headerRight = el('headerRight') || document.querySelector('.header-actions');
    if (headerRight && !el('loggedInInfo')) {
      var div = document.createElement('div');
      div.id = 'loggedInInfo';
      div.style.cssText = 'display:flex;align-items:center;gap:0.5rem;';
      div.innerHTML = '<span class="logged-in-info">👤 ' + namaGuru + '</span>' +
                      '<button class="logout-btn" id="logoutBtn">🚪 Keluar</button>';
      headerRight.insertBefore(div, headerRight.firstChild);

      el('logoutBtn').addEventListener('click', function(){
        if (!confirm('Yakin ingin keluar?')) return;
        sessionStorage.removeItem(LOGIN_KEY);
        currentUser = null;
        studentList = [];
        approvalList = [];
        selectedApproval = {};
        searchMode = false;
        div.remove();
        // Reset form login
        if (el('loginUsername')) el('loginUsername').value = '';
        if (el('loginPassword')) el('loginPassword').value = '';
        if (el('loginError')) el('loginError').classList.add('hidden');
        showLoginScreen();
      });
    }

    // Inisialisasi app (hanya sekali)
    if (!appInitialized) initApp();
    applyRoleUI();
  }

  // Langsung masuk jika sudah login di sesi ini
  if (currentUser) {
    showMainApp(currentUser.nama || currentUser.username);
  } else {
    showLoginScreen();
  }

  /* =========================================================
     INISIALISASI APLIKASI UTAMA
  ========================================================= */
  var appInitialized = appInitialized || false;

  function initApp() {
    appInitialized = true;
    startClock();
    setupTabs();
    setupClassSelect();
    setupSearch();
    setupSelection();
    setupApproval();
    setupModal();
    setupScanForm();
    setupLogFilter();
    setupEditModal();
    loadClasses();
    setInterval(tickIzinKedaluwarsa, 5000);        // cabut tampilan izin yang lewat waktu
    setInterval(refreshStudentsSilently, 30000);   // ambil status terbaru dari Sheets
    setInterval(pollApproval, 15000);              // kepala asrama: cek permintaan izin baru
  }

  // Izin yang sudah lewat batas waktu langsung tampil "Tidak Diizinkan" tanpa menunggu server
  function tickIzinKedaluwarsa() {
    var berubah = false;
    studentList.forEach(function (s) {
      if ((s.status_izin === 'Diizinkan' || s.status_izin === STATUS_MENUNGGU) && s.izin_berakhir && Date.now() >= s.izin_berakhir) {
        s.status_izin   = 'Tidak Diizinkan';
        s.izin_berakhir = null;
        berubah = true;
      }
    });
    if (berubah) renderStudentTable();
  }

  // Muat ulang daftar siswa kelas terpilih tanpa tulisan "Memuat..." dan tanpa fallback demo
  function refreshStudentsSilently() {
    if (document.hidden) return;
    if (!selectedClass) {
      // Mode pencarian semua kelas: segarkan hasil pencarian tanpa tulisan "Memuat..."
      if (searchMode && searchQuery().length >= 2) cariSiswaGlobal(searchQuery(), true);
      return;
    }
    var kelas = selectedClass;
    callGAS({ action: 'getStudentsByClass', className: kelas }, 8000)
      .then(function (res) {
        if (kelas !== selectedClass) return;
        if (res && res.success && res.students && res.students.length > 0) {
          studentList = res.students;
          renderStudentTable();
        }
      })
      .catch(function () {});
  }

  /* =========================================================
     JAM DIGITAL
  ========================================================= */
  function startClock() {
    var clock = el('liveClock');
    if (!clock) return;
    function tick(){ clock.textContent = new Date().toLocaleTimeString('id-ID',{hour12:false}); }
    tick(); setInterval(tick, 1000);
  }

  /* =========================================================
     NAVIGASI TAB
  ========================================================= */
  function setupTabs() {
    document.querySelectorAll('.nav-tab').forEach(function(tab){
      tab.addEventListener('click', function(){
        document.querySelectorAll('.nav-tab').forEach(function(t){ t.classList.remove('active'); });
        document.querySelectorAll('.tab-content').forEach(function(c){ c.classList.remove('active'); });
        tab.classList.add('active');
        var tgt = el(tab.getAttribute('data-tab'));
        if (tgt) tgt.classList.add('active');
        if (tab.getAttribute('data-tab') === 'tab-logs') loadLogs();
        if (tab.getAttribute('data-tab') === 'tab-approval') loadPending(false);
      });
    });
  }

  /* =========================================================
     MUAT DAFTAR KELAS
  ========================================================= */
  function loadClasses() {
    var sel = el('classSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Pilih Kelas --</option>';

    callGAS({ action: 'getClasses' }, 6000)
      .then(function(res) {
        if (res && res.success && res.classes && res.classes.length > 0) {
          classList = res.classes;
          populateClassSelect(res.classes);
        } else {
          loadClassesMock();
        }
      })
      .catch(function() { loadClassesMock(); });
  }

  function loadClassesMock() {
    classList = Object.keys(mockStudents).map(function(k){
      return { sheetName: k, className: k };
    });
    populateClassSelect(classList);
  }

  function populateClassSelect(classes) {
    var sel = el('classSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Pilih Kelas --</option>';
    classes.forEach(function(c){
      var opt = document.createElement('option');
      opt.value = c.className || c.sheetName;
      opt.textContent = c.className || c.sheetName;
      sel.appendChild(opt);
    });
  }

  function setupClassSelect() {
    var sel = el('classSelect');
    var refreshBtn = el('refreshStudentsBtn');
    if (sel) {
      sel.addEventListener('change', function(){
        selectedClass = sel.value;
        selectedUids = {};
        searchMode = false;
        searchSeq++;
        if (selectedClass) loadStudents(selectedClass);
        else {
          studentList = [];
          var q0 = searchQuery();
          if (q0.length >= 2) cariSiswaGlobal(q0);
          else renderStudentTable();
        }
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', function(){
        if (selectedClass) loadStudents(selectedClass);
        else if (searchMode && searchQuery().length >= 2) cariSiswaGlobal(searchQuery());
        else loadClasses();
        showToast('Data diperbarui!', 'info');
      });
    }
  }

  /* =========================================================
     MUAT & RENDER DATA SISWA
  ========================================================= */
  function loadStudents(kelas) {
    var tbody = el('studentTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:#64748b;">Memuat data siswa...</td></tr>';

    callGAS({ action: 'getStudentsByClass', className: kelas }, 7000)
      .then(function(res) {
        if (res && res.success && res.students && res.students.length > 0) {
          studentList = res.students;
          renderStudentTable();
        } else {
          loadStudentsMock(kelas);
        }
      })
      .catch(function() { loadStudentsMock(kelas); });
  }

  function loadStudentsMock(kelas) {
    // Cari di mockStudents yang cocok
    var key = Object.keys(mockStudents).find(function(k){
      return k.toLowerCase().indexOf(kelas.toLowerCase()) !== -1 ||
             kelas.toLowerCase().indexOf(k.replace('kelas ', '').toLowerCase()) !== -1;
    });
    studentList = key ? mockStudents[key].slice() : [];
    renderStudentTable();
    if (studentList.length === 0) {
      showToast('Data kelas "' + kelas + '" tidak tersedia di mode offline.', 'warning');
    }
  }

  function renderStudentTable() {
    var tbody = el('studentTableBody');
    if (!tbody) return;

    // Statistik
    var total    = studentList.length;
    var allowed  = studentList.filter(function(s){ return s.status_izin === 'Diizinkan'; }).length;
    var outside  = studentList.filter(function(s){ return s.status_izin === 'Sedang Diluar'; }).length;
    var notAllow = studentList.filter(function(s){ return s.status_izin === 'Tidak Diizinkan'; }).length;

    if (el('statTotalStudents')) el('statTotalStudents').textContent = total;
    if (el('statAllowed'))       el('statAllowed').textContent       = allowed;
    if (el('statOutside'))       el('statOutside').textContent       = outside;
    if (el('statNotAllowed'))    el('statNotAllowed').textContent    = notAllow;
    if (el('statPending'))       el('statPending').textContent       = studentList.filter(function(s){ return s.status_izin === STATUS_MENUNGGU; }).length;

    // Filter search (mode pencarian semua kelas: hasil sudah disaring server)
    var filtered = visibleStudents();

    // Buang centang untuk siswa yang statusnya sudah berubah / tidak ada lagi
    Object.keys(selectedUids).forEach(function (u) {
      var st = studentList.find(function (x) { return x.uid_kartu === u; });
      if (!st || st.status_izin !== 'Tidak Diizinkan') delete selectedUids[u];
    });
    updateSelectionUI(filtered);

    if (!selectedClass && !searchMode) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:#64748b;">Pilih kelas, atau ketik minimal 2 huruf nama siswa untuk mencari di semua kelas.</td></tr>';
      return;
    }
    if (filtered.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:#64748b;">Tidak ada siswa ditemukan.</td></tr>';
      return;
    }

    tbody.innerHTML = filtered.map(function(s){
      var badge, aksi;
      if (s.status_izin === 'Diizinkan') {
        badge = '<span class="status-badge status-allowed">✓ Diizinkan</span>';
        aksi  = '<button class="btn btn-sm btn-warning" onclick="window.resetIzin(\''+s.uid_kartu+'\',\''+encodeURIComponent(s.nama)+'\')">🔄 Reset</button>';
      } else if (s.status_izin === STATUS_MENUNGGU) {
        badge = '<span class="status-badge status-pending">⏳ Menunggu Approval</span>' +
                (s.peminta ? '<span class="sub-note">diminta oleh ' + escAttr(s.peminta) + '</span>' : '');
        aksi  = (isKepala() ? '<button class="btn btn-sm btn-success" onclick="window.setujuiIzin(\''+s.uid_kartu+'\')">✓ Setujui</button> ' : '') +
                '<button class="btn btn-sm btn-warning" onclick="window.resetIzin(\''+s.uid_kartu+'\',\''+encodeURIComponent(s.nama)+'\')">✗ Batalkan</button>';
      } else if (s.status_izin === 'Sedang Diluar') {
        badge = '<span class="status-badge status-outside">↗ Sedang Diluar</span>';
        aksi  = '<button class="btn btn-sm btn-warning" onclick="window.resetIzin(\''+s.uid_kartu+'\',\''+encodeURIComponent(s.nama)+'\')">🔄 Reset</button>';
      } else {
        badge = '<span class="status-badge status-not-allowed">✗ Tidak Diizinkan</span>';
        aksi  = '<button class="btn btn-sm btn-success" onclick="window.bukaBeriIzin(\''+s.uid_kartu+'\',\''+encodeURIComponent(s.nama)+'\',\''+s.kelas+'\')">🔓 Beri Izin</button>';
      }
      var bisaDipilih = s.status_izin === 'Tidak Diizinkan';
      var dipilih     = !!selectedUids[s.uid_kartu];
      var cek = '<td class="col-check"><input type="checkbox" class="row-check" data-uid="' + escAttr(s.uid_kartu) + '"' +
                (dipilih ? ' checked' : '') + (bisaDipilih ? '' : ' disabled') +
                ' aria-label="Pilih ' + escAttr(s.nama) + '"></td>';
      return '<tr' + (dipilih ? ' class="is-selected"' : '') + '>' + cek +
        '<td><span class="code-font" style="color:#94a3b8;font-size:.8rem;">'+(s.id_kartu||'-')+'</span></td>'+
        '<td><span class="code-font" style="color:#60a5fa;font-size:.8rem;">'+s.uid_kartu+'</span></td>'+
        '<td style="font-weight:600;">'+s.nama+'</td>'+
        '<td><span style="background:rgba(139,92,246,.15);color:#a78bfa;padding:3px 10px;border-radius:99px;font-size:.78rem;">Kelas '+s.kelas+'</span></td>'+
        '<td>'+badge+'</td>'+
        '<td>'+aksi+'</td>'+
        '</tr>';
    }).join('');
  }

  function escAttr(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Siswa yang bisa dipilih = belum diizinkan, dan sedang tampil (ikut filter pencarian)
  function eligibleVisible() {
    return visibleStudents().filter(function (s) { return s.status_izin === 'Tidak Diizinkan'; });
  }

  function searchQuery() {
    var si = el('studentSearchInput');
    return si ? si.value.toLowerCase().trim() : '';
  }

  // Siswa yang tampil di tabel: hasil pencarian semua kelas, atau daftar kelas yang difilter kolom cari
  function visibleStudents() {
    var q = searchQuery();
    if (searchMode || !q) return studentList;
    return studentList.filter(function (s) {
      return s.nama.toLowerCase().indexOf(q) !== -1 || s.uid_kartu.toLowerCase().indexOf(q) !== -1;
    });
  }

  // Cari siswa di SEMUA kelas (dipakai saat belum ada kelas dipilih)
  function cariSiswaGlobal(q, silent) {
    var seq   = ++searchSeq;
    var tbody = el('studentTableBody');
    searchMode = true;
    if (!silent && tbody) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:#64748b;">Mencari siswa...</td></tr>';
    }
    callGAS({ action: 'searchStudents', q: q }, 10000)
      .then(function (res) {
        if (seq !== searchSeq || selectedClass) return;   // hasil usang / sudah pindah ke mode kelas
        if (res && res.success) { studentList = res.students || []; renderStudentTable(); }
        else if (!silent) cariSiswaMock(q);
      })
      .catch(function () {
        if (seq !== searchSeq || selectedClass) return;
        if (!silent) cariSiswaMock(q);
      });
  }

  // Cadangan saat Google Sheets tidak bisa dihubungi
  function cariSiswaMock(q) {
    var needle = String(q || '').toLowerCase();
    var hasil  = [];
    Object.keys(mockStudents).forEach(function (k) {
      mockStudents[k].forEach(function (s) {
        if (s.nama.toLowerCase().indexOf(needle) !== -1 || s.uid_kartu.toLowerCase().indexOf(needle) !== -1) hasil.push(s);
      });
    });
    studentList = hasil;
    renderStudentTable();
  }

  // Sinkronkan kotak "Pilih semua" dan bar aksi dengan pilihan saat ini
  function updateSelectionUI() {
    var elig  = eligibleVisible();
    var n     = Object.keys(selectedUids).length;
    var semua = el('selectAllStudents');
    if (semua) {
      var terpilih = elig.filter(function (s) { return selectedUids[s.uid_kartu]; }).length;
      semua.disabled      = elig.length === 0;
      semua.checked       = elig.length > 0 && terpilih === elig.length;
      semua.indeterminate = terpilih > 0 && terpilih < elig.length;
    }
    var bar = el('bulkBar');
    if (bar) bar.classList.toggle('hidden', n === 0);
    if (el('bulkCount'))    el('bulkCount').textContent    = n + ' siswa dipilih';
    if (el('bulkGrantBtn')) el('bulkGrantBtn').textContent = 'Beri Izin (' + n + ')';
  }

  function setupSelection() {
    var tbody = el('studentTableBody');
    if (tbody) tbody.addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb || !cb.classList || !cb.classList.contains('row-check')) return;
      var uid = cb.getAttribute('data-uid');
      if (!uid) return;
      if (cb.checked) selectedUids[uid] = true; else delete selectedUids[uid];
      var tr = cb.closest('tr');
      if (tr) tr.classList.toggle('is-selected', cb.checked);
      updateSelectionUI();
    });

    var semua = el('selectAllStudents');
    if (semua) semua.addEventListener('change', function () {
      var elig = eligibleVisible();
      elig.forEach(function (s) {
        if (semua.checked) selectedUids[s.uid_kartu] = true; else delete selectedUids[s.uid_kartu];
      });
      renderStudentTable();
    });

    var clearBtn = el('bulkClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', function () { selectedUids = {}; renderStudentTable(); });

    var grantBtn = el('bulkGrantBtn');
    if (grantBtn) grantBtn.addEventListener('click', bukaBeriIzinBanyak);
  }

  function setupSearch() {
    var si = el('studentSearchInput');
    if (si) si.addEventListener('input', function(){
      // Kelas sudah dipilih: saring daftar kelas itu saja
      if (selectedClass) { renderStudentTable(); return; }

      // Belum pilih kelas: cari ke semua kelas (ditunda sebentar agar tidak membanjiri server)
      clearTimeout(searchTimer);
      searchSeq++;
      var q = si.value.trim();
      if (q.length < 2) {
        searchMode = false;
        studentList = [];
        selectedUids = {};
        renderStudentTable();
        return;
      }
      searchTimer = setTimeout(function(){ cariSiswaGlobal(q); }, 350);
    });
  }

  /* =========================================================
     UTILITAS WAKTU (selalu WIB / UTC+7)
  ========================================================= */
  function getNowWIB() {
    // Selalu WIB (Asia/Jakarta), tidak bergantung zona waktu perangkat
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  }

  function getTimeHHMM() {
    var d = getNowWIB();
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  function getDateTimeStr() {
    // Format: DD/MM/YYYY HH:MM
    var d = getNowWIB();
    var dd   = String(d.getDate()).padStart(2,'0');
    var mm   = String(d.getMonth()+1).padStart(2,'0');
    var yyyy = d.getFullYear();
    var hh   = String(d.getHours()).padStart(2,'0');
    var min  = String(d.getMinutes()).padStart(2,'0');
    return dd + '/' + mm + '/' + yyyy + ' ' + hh + ':' + min;
  }

  // Kapan izin berakhir (epoch ms perangkat) dari jam batas "HH:MM" WIB.
  // Sama dengan aturan server: jam yang sudah lewat dianggap besok.
  function hitungBerakhirLokal(batas) {
    var m = /^(\d{1,2}):(\d{2})/.exec(String(batas || ''));
    if (!m) return null;
    var now  = getNowWIB();
    var end  = new Date(now.getTime());
    end.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    var diff = end.getTime() - now.getTime();
    if (diff <= 0) diff += 24 * 60 * 60 * 1000;
    return Date.now() + diff;
  }

  function getFutureTime(addMin) {
    var d = getNowWIB();
    d.setMinutes(d.getMinutes() + addMin);
    return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }

  window.bukaBeriIzin = function(uid, namaEnc, kelas) {
    var nama = decodeURIComponent(namaEnc);
    var modal = el('permissionModal');
    if (!modal) return;
    bulkUids = null;
    if (el('submitGrantLabel')) el('submitGrantLabel').textContent = isKepala() ? 'KONFIRMASI IZINKAN' : 'AJUKAN KE KEPALA ASRAMA';
    if (el('modalStudentName'))  el('modalStudentName').textContent  = nama;
    if (el('modalStudentMeta'))  el('modalStudentMeta').textContent  = 'Kelas ' + kelas + ' | UID: ' + uid;
    if (el('modalStudentUid'))   el('modalStudentUid').value         = uid;
    if (el('modalStudentClass')) el('modalStudentClass').value       = kelas;
    if (el('modalStudentNama'))  el('modalStudentNama').value        = nama;
    if (el('batasWaktuInput'))   el('batasWaktuInput').value         = getFutureTime(60);
    document.querySelectorAll('.btn-preset').forEach(function(b){ b.classList.remove('active'); });
    modal.classList.remove('hidden');
  };

  // Buka modal izin untuk semua siswa yang dicentang (satu batas waktu untuk semuanya)
  function bukaBeriIzinBanyak() {
    var daftar = Object.keys(selectedUids);
    if (!daftar.length) return;
    var modal = el('permissionModal');
    if (!modal) return;
    bulkUids = daftar;

    var nama = daftar.map(function (u) {
      var s = studentList.find(function (x) { return x.uid_kartu === u; });
      return s ? s.nama : u;
    });
    var ringkas = nama.slice(0, 3).join(', ') + (nama.length > 3 ? ' dan ' + (nama.length - 3) + ' lainnya' : '');

    if (el('modalStudentName'))  el('modalStudentName').textContent  = daftar.length + ' siswa dipilih';
    if (el('modalStudentMeta'))  el('modalStudentMeta').textContent  = ringkas;
    if (el('modalStudentUid'))   el('modalStudentUid').value         = '';
    if (el('modalStudentClass')) el('modalStudentClass').value       = '';
    if (el('modalStudentNama'))  el('modalStudentNama').value        = '';
    if (el('batasWaktuInput'))   el('batasWaktuInput').value         = getFutureTime(60);
    if (el('submitGrantLabel'))  el('submitGrantLabel').textContent  = (isKepala() ? 'IZINKAN ' : 'AJUKAN ') + daftar.length + ' SISWA';
    document.querySelectorAll('.btn-preset').forEach(function (b) { b.classList.remove('active'); });
    modal.classList.remove('hidden');
  }

  window.resetIzin = function(uid, namaEnc) {
    var nama = decodeURIComponent(namaEnc || '');
    if (!confirm('Reset status "' + nama + '" menjadi "Tidak Diizinkan"?')) return;
    // Update lokal
    var s = studentList.find(function(x){ return x.uid_kartu === uid; });
    if (s) s.status_izin = 'Tidak Diizinkan';
    renderStudentTable();
    showToast('Status ' + nama + ' di-reset.', 'info');
    // Kirim ke GAS
    callGAS({ action: 'resetPermission', uid_kartu: uid, nama: nama }).catch(function(){});
  };

  /* =========================================================
     MODAL BERI IZIN
  ========================================================= */
  function closeModal() { bulkUids = null; var m = el('permissionModal'); if (m) m.classList.add('hidden'); }

  function setupModal() {
    if (el('closeModalBtn'))  el('closeModalBtn').addEventListener('click',  closeModal);
    if (el('cancelModalBtn')) el('cancelModalBtn').addEventListener('click', closeModal);

    // Preset tombol waktu
    document.querySelectorAll('.btn-preset').forEach(function(btn){
      btn.addEventListener('click', function(){
        document.querySelectorAll('.btn-preset').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        var mins = parseInt(btn.getAttribute('data-minutes'), 10);
        if (el('batasWaktuInput')) el('batasWaktuInput').value = getFutureTime(mins);
      });
    });

    var form      = el('grantPermissionForm');
    var submitBtn = el('submitGrantBtn');

    function prosesIzin(e) {
      if (e && e.preventDefault) e.preventDefault();
      var uid   = (el('modalStudentUid')   ||{}).value || '';
      var nama  = (el('modalStudentNama')  ||{}).value || '';
      var kelas = (el('modalStudentClass') ||{}).value || '';
      var batas = (el('batasWaktuInput')   ||{}).value || getFutureTime(60);

      // ---- Izin massal: semua siswa yang dicentang, satu permintaan ke server
      if (bulkUids && bulkUids.length) {
        var daftar   = bulkUids.slice();
        var berakhir = hitungBerakhirLokal(batas);
        daftar.forEach(function (u) {
          var st = studentList.find(function (x) { return x.uid_kartu === u; });
          if (st) {
            st.status_izin         = statusLokalBaru();
            st.batas_waktu_kembali = batas;
            st.izin_berakhir       = berakhir;
          }
        });
        selectedUids = {};
        closeModal();                       // juga mengosongkan bulkUids
        renderStudentTable();
        showToast('Mengirim izin untuk ' + daftar.length + ' siswa...', 'info');

        callGAS({ action: 'setDiizinkanBanyak', uids: JSON.stringify(daftar), batas_waktu_kembali: batas,
                  username: currentUser ? currentUser.username : '', peminta: currentUser ? currentUser.nama : '' }, 20000)
          .then(function (res) {
            if (res && res.success) {
              var extra = [];
              if (res.tidak_ditemukan && res.tidak_ditemukan.length) extra.push(res.tidak_ditemukan.length + ' tidak ditemukan');
              if (res.dilewati && res.dilewati.length) extra.push(res.dilewati.length + ' sedang di luar');
              showToast('✓ ' + res.jumlah + (res.status === STATUS_MENUNGGU ? ' permintaan izin dikirim, menunggu kepala asrama' : ' siswa diizinkan') + (extra.length ? ' (' + extra.join(', ') + ')' : ''),
                        extra.length ? 'warning' : 'success');
              if (extra.length) refreshStudentsSilently();
            } else {
              showToast('Gagal memberi izin: ' + ((res && res.message) || 'tidak ada respons') + '. Tampilan disegarkan.', 'error');
              refreshStudentsSilently();
            }
          })
          .catch(function () {
            showToast('Koneksi ke Google Sheets gagal. Periksa status siswa, tampilan disegarkan.', 'error');
            refreshStudentsSilently();
          });
        return;
      }

      // Update lokal langsung
      var s = studentList.find(function(x){ return x.uid_kartu === uid || x.nama === nama; });
      if (s) {
        s.status_izin = statusLokalBaru();
        s.batas_waktu_kembali = batas;
        s.izin_berakhir       = hitungBerakhirLokal(batas);
      }

      closeModal();
      renderStudentTable();
      showToast(isKepala()
        ? 'Status ' + (nama||uid) + ' berhasil diubah menjadi "Diizinkan"!'
        : 'Permintaan izin ' + (nama||uid) + ' dikirim, menunggu persetujuan kepala asrama.', 'success');

      // Kirim ke GAS (tanggal/jam izin dicatat oleh server dalam WIB)
      callGAS({
        action                : 'setDiizinkan',
        uid_kartu             : uid,
        nama                  : nama,
        batas_waktu_kembali   : batas,
        username              : currentUser ? currentUser.username : '',
        peminta               : currentUser ? currentUser.nama : ''
      })
        .then(function(res){
          if (res && res.success) { showToast('✓ Google Sheets ter-update!', 'success'); refreshStudentsSilently(); }
          else showToast('Gagal menyimpan izin: ' + ((res && res.message) || 'tidak ada respons'), 'error');
        })
        .catch(function(){});
    }

    if (form)      form.addEventListener('submit', prosesIzin);
    if (submitBtn) submitBtn.addEventListener('click', prosesIzin);
  }

  /* =========================================================
     PORTAL SECURITY — WEBCAM QR SCANNER
  ========================================================= */
  var html5QrCode = null;
  var cameraActive = false;
  var lastScannedUid = '';
  var lastScanTime   = 0;

  function setupScanForm() {
    // Manual input form (fallback)
    var form = el('scanForm');
    var inp  = el('uidInput');
    if (form) {
      form.addEventListener('submit', function(e) {
        e.preventDefault();
        var uid = inp ? inp.value.trim() : '';
        if (uid) { processScan(uid); if (inp) inp.value = ''; }
      });
    }

    // Tombol kamera
    var startBtn  = el('startCameraBtn');
    var stopBtn   = el('stopCameraBtn');
    var statusBar = el('cameraStatus');
    var placeholder = el('qr-reader-placeholder');

    if (startBtn) {
      startBtn.addEventListener('click', function() {
        startWebcamScanner(startBtn, stopBtn, statusBar, placeholder);
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', function() {
        stopWebcamScanner(startBtn, stopBtn, statusBar, placeholder);
      });
    }

    // Sim buttons
    var qsc = el('quickSimContainer');
    if (qsc) renderQuickSim();
  }

  function startWebcamScanner(startBtn, stopBtn, statusBar, placeholder) {
    if (cameraActive) return;

    if (typeof Html5Qrcode === 'undefined') {
      showToast('Library kamera belum dimuat. Pastikan ada koneksi internet.', 'error');
      return;
    }

    // Sembunyikan placeholder
    if (placeholder) placeholder.style.display = 'none';

    html5QrCode = new Html5Qrcode('qr-reader');

    var config = {
      fps: 10,
      qrbox: function(w, h) {
        var size = Math.min(w, h) * 0.7;
        return { width: Math.floor(size), height: Math.floor(size) };
      },
      aspectRatio: 1.0
    };

    html5QrCode.start(
      { facingMode: 'environment' }, // kamera belakang (HP) atau depan (laptop)
      config,
      function onScanSuccess(decodedText) {
        // Hindari scan berulang dalam 2 detik
        var now = Date.now();
        if (decodedText === lastScannedUid && (now - lastScanTime) < 2000) return;
        lastScannedUid = decodedText;
        lastScanTime   = now;

        // Proses scan
        processScan(decodedText.trim());
      },
      function onScanError() { /* abaikan error frame */ }
    )
    .then(function() {
      cameraActive = true;
      if (startBtn)  startBtn.style.display  = 'none';
      if (stopBtn)   stopBtn.style.display   = '';
      if (statusBar) statusBar.style.display = 'flex';
      showToast('📷 Kamera aktif! Arahkan QR Code kartu siswa.', 'success');
    })
    .catch(function(err) {
      if (placeholder) placeholder.style.display = '';
      // Jika kamera belakang tidak ada, coba kamera depan
      html5QrCode.start(
        { facingMode: 'user' },
        config,
        function onScanSuccess(decodedText) {
          var now = Date.now();
          if (decodedText === lastScannedUid && (now - lastScanTime) < 2000) return;
          lastScannedUid = decodedText;
          lastScanTime   = now;
          processScan(decodedText.trim());
        },
        function() {}
      )
      .then(function() {
        cameraActive = true;
        if (startBtn)  startBtn.style.display  = 'none';
        if (stopBtn)   stopBtn.style.display   = '';
        if (statusBar) statusBar.style.display = 'flex';
        if (placeholder) placeholder.style.display = 'none';
        showToast('📷 Kamera depan aktif.', 'info');
      })
      .catch(function(err2) {
        showToast('❌ Gagal akses kamera: ' + (err2 || err), 'error');
      });
    });
  }

  function stopWebcamScanner(startBtn, stopBtn, statusBar, placeholder) {
    if (!cameraActive || !html5QrCode) return;
    html5QrCode.stop()
      .then(function() {
        html5QrCode.clear();
        html5QrCode  = null;
        cameraActive = false;
        if (startBtn)   startBtn.style.display   = '';
        if (stopBtn)    stopBtn.style.display    = 'none';
        if (statusBar)  statusBar.style.display  = 'none';
        if (placeholder) {
          placeholder.style.display = '';
          el('qr-reader').innerHTML = '';
        }
        showToast('Kamera dimatikan.', 'info');
      })
      .catch(function() {});
  }

  function renderQuickSim() {
    var qsc = el('quickSimContainer');
    if (!qsc) return;
    if (studentList.length === 0) { qsc.innerHTML = '<p style="color:#64748b;font-size:.8rem;">Pilih kelas untuk melihat tombol simulasi.</p>'; return; }
    qsc.innerHTML = studentList.slice(0,6).map(function(s){
      var color = s.status_izin === 'Diizinkan' ? '#10b981' : (s.status_izin === 'Sedang Diluar' ? '#f59e0b' : '#3b82f6');
      return '<button onclick="simulateScan(\''+s.uid_kartu+'\')" style="background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);color:#93c5fd;padding:5px 10px;border-radius:6px;font-size:.75rem;cursor:pointer;margin:2px;">'+
        s.nama.split(' ')[0]+'</button>';
    }).join('');
  }

  window.simulateScan = function(uid) {
    var inp = el('uidInput');
    if (inp) { inp.value = uid; el('scanForm').dispatchEvent(new Event('submit')); }
  };

  // Kartu hasil scan hilang otomatis 3 detik setelah scan
  var SCAN_RESULT_MS = 3000;
  var scanHideTimer  = null;
  function scheduleHideScanResult() {
    clearTimeout(scanHideTimer);          // scan baru -> hitung ulang 3 detik
    scanHideTimer = setTimeout(function () {
      var ph = el('resultPlaceholder');
      var rd = el('resultDisplay');
      if (rd) rd.classList.add('hidden');
      if (ph) ph.classList.remove('hidden');
    }, SCAN_RESULT_MS);
  }

  function processScan(uid) {
    var ph  = el('resultPlaceholder');
    var rd  = el('resultDisplay');
    var rt  = el('resultTitle');
    var rm  = el('resultMessage');
    var rb  = el('resultBadge');

    if (ph) ph.classList.add('hidden');
    if (rd) rd.classList.remove('hidden');
    scheduleHideScanResult();

    // Cari di semua student yang sedang aktif
    var allStudents = [];
    Object.keys(mockStudents).forEach(function(k){ allStudents = allStudents.concat(mockStudents[k]); });
    if (studentList.length > 0) allStudents = studentList.concat(allStudents);

    var student = allStudents.find(function(s){
      return s.uid_kartu.toLowerCase() === uid.toLowerCase() ||
             s.id_kartu.toLowerCase()  === uid.toLowerCase() ||
             s.nama.toLowerCase()      === uid.toLowerCase();
    });

    if (!student) {
      if (rt) rt.textContent = 'AKSES DITOLAK';
      if (rm) rm.textContent = 'Kartu tidak terdaftar: ' + uid;
      if (rb) { rb.className = 'result-badge denied'; rb.textContent = 'DITOLAK'; }
      return;
    }

    if (el('resNama'))  el('resNama').textContent  = student.nama;
    if (el('resKelas')) el('resKelas').textContent = 'Kelas ' + student.kelas;
    if (el('resUid'))   el('resUid').textContent   = student.uid_kartu;

    var kedaluwarsa = false;
    if (student.status_izin === 'Diizinkan' && student.izin_berakhir && Date.now() >= student.izin_berakhir) {
      student.status_izin  = 'Tidak Diizinkan';
      student.izin_berakhir = null;
      kedaluwarsa = true;
    }

    if (student.status_izin === 'Diizinkan') {
      student.izin_berakhir = null;
      student.status_izin = 'Sedang Diluar';
      if (rt) rt.textContent = 'AKSES DITERIMA — KELUAR';
      if (rm) rm.textContent = student.nama + ' diizinkan keluar kelas.';
      if (rb) { rb.className = 'result-badge allowed'; rb.textContent = 'KELUAR ↗'; }
    } else if (student.status_izin === 'Sedang Diluar') {
      student.status_izin = 'Tidak Diizinkan';
      if (rt) rt.textContent = 'SCAN MASUK — SELAMAT DATANG';
      if (rm) rm.textContent = student.nama + ' telah kembali ke kelas.';
      if (rb) { rb.className = 'result-badge allowed'; rb.textContent = '↙ MASUK'; }
    } else {
      if (rt) rt.textContent = 'AKSES DITOLAK';
      if (rm) rm.textContent = kedaluwarsa
        ? 'Izin ' + student.nama + ' sudah kedaluwarsa. Minta izin guru lagi.'
        : (student.status_izin === STATUS_MENUNGGU
            ? 'Izin ' + student.nama + ' masih menunggu persetujuan kepala asrama.'
            : student.nama + ' belum mendapat izin guru!');
      if (rb) { rb.className = 'result-badge denied'; rb.textContent = 'DITOLAK'; }
    }
    renderStudentTable();
    // Kirim ke GAS
    callGAS({ action: 'scanCard', uid_kartu: uid }).catch(function(){});
  }

  /* =========================================================
     LOG RIWAYAT — dengan filter status aktif
  ========================================================= */
  var allLogsCache = [];   // simpan semua log agar filter bisa dipakai
  var activeLogFilter = 'ALL';

  function loadLogs() {
    callGAS({ action: 'getLogs' }, 10000)
      .then(function(res){
        allLogsCache = (res && res.success) ? (res.logs || []) : [];
        applyLogFilter();   // hormati filter & pencarian yang sedang aktif
      })
      .catch(function(){ allLogsCache = []; applyLogFilter(); });
  }

  // Kelompokkan status log ke salah satu kategori filter
  function logCategory(status) {
    var s = String(status || '').toLowerCase();
    if (s.indexOf('tolak') !== -1 || s.indexOf('denied') !== -1) return 'Ditolak';
    if (s.indexOf('telat') !== -1 || s.indexOf('terlambat') !== -1) return 'Telat';
    if (s.indexOf('tepat') !== -1) return 'Tepat Waktu';
    if (s.indexOf('diluar') !== -1) return 'Diluar';
    return 'Lainnya';
  }

  // Pasang listener ke tombol filter pills log
  function setupLogFilter() {
    document.querySelectorAll('.status-filter-pills .pill').forEach(function(btn) {
      btn.addEventListener('click', function() {
        // Update active state visual
        document.querySelectorAll('.status-filter-pills .pill').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');

        activeLogFilter = btn.getAttribute('data-filter') || 'ALL';
        applyLogFilter();
      });
    });

    var refreshLogsBtn = el('refreshLogsBtn');
    if (refreshLogsBtn) refreshLogsBtn.addEventListener('click', loadLogs);

    var logSearch = el('logSearchInput');
    if (logSearch) logSearch.addEventListener('input', applyLogFilter);
  }

  function applyLogFilter() {
    var q = '';
    var si = el('logSearchInput');
    if (si) q = si.value.toLowerCase().trim();

    var filtered = allLogsCache.filter(function(l) {
      if (activeLogFilter !== 'ALL' && logCategory(l.status || l.status_akhir) !== activeLogFilter) return false;
      if (q) {
        var hay = (String(l.nama_siswa || '') + ' ' + String(l.uid_kartu || '')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    renderLogTable(filtered);
  }

  function getStatusStyle(status) {
    var s = String(status || '').toLowerCase();
    if (s.indexOf('tepat') !== -1)  return 'background:#D1FAE5;color:#065F46;';
    if (s.indexOf('telat') !== -1 || s.indexOf('terlambat') !== -1) return 'background:#FEF3C7;color:#92400E;';
    if (s.indexOf('diluar') !== -1) return 'background:#EEF2FF;color:#3B3AAB;';
    if (s.indexOf('tolak') !== -1 || s.indexOf('denied') !== -1)   return 'background:#FEE2E2;color:#991B1B;';
    return 'background:#F1F5F9;color:#475569;';
  }

  function renderLogTable(logs) {
    var tbody = el('logTableBody');
    if (!tbody) return;
    logs = logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:1.5rem;color:#64748b;font-size:.85rem;">' +
        (activeLogFilter === 'ALL' ? 'Belum ada riwayat perizinan.' : 'Tidak ada data dengan status "' + activeLogFilter + '".') +
        '</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(function(l){
      var statusStyle = getStatusStyle(l.status || l.status_akhir);
      return '<tr>' +
        '<td style="font-size:.75rem;color:#64748b;">'+(l.id_log||'-')+'</td>'+
        '<td style="font-size:.8rem;color:#3B3AAB;font-family:monospace;">'+(l.uid_kartu||'-')+'</td>'+
        '<td style="font-weight:600;color:#1E293B;">'+(l.nama_siswa||'-')+'</td>'+
        '<td style="font-size:.8rem;color:#1E293B;">'+(l.waktu_diberi_izin||'-')+'</td>'+
        '<td style="font-size:.8rem;color:#1E293B;">'+(l.waktu_scan_keluar||'-')+'</td>'+
        '<td style="font-size:.8rem;color:#1E293B;font-weight:600;">'+(l.batas_waktu_kembali||'-')+'</td>'+
        '<td style="font-size:.8rem;color:#1E293B;">'+(l.waktu_scan_kembali||'-')+'</td>'+
        '<td><span style="'+statusStyle+'padding:3px 10px;border-radius:99px;font-size:.73rem;font-weight:700;white-space:nowrap;">'+(l.status||l.status_akhir||'-')+'</span></td>'+
        '</tr>';
    }).join('');
  }

  /* =========================================================
     MODAL EDIT SISWA
  ========================================================= */
  function setupEditModal() {
    // Edit
    function closeEdit() { var m = el('editStudentModal'); if (m) m.classList.add('hidden'); }
    if (el('closeEditModalBtn'))  el('closeEditModalBtn').addEventListener('click',  closeEdit);
    if (el('cancelEditModalBtn')) el('cancelEditModalBtn').addEventListener('click', closeEdit);
    var editForm = el('editStudentForm');
    if (editForm) editForm.addEventListener('submit', function(e){
      e.preventDefault();
      var oldUid = (el('editOldUid')||{}).value || '';
      var nama   = (el('editNama')||{}).value   || '';
      var uid    = (el('editUid')||{}).value    || '';
      var idK    = (el('editIdKartu')||{}).value|| '';
      var kls    = (el('editKelas')||{}).value  || '';
      var s = studentList.find(function(x){ return x.uid_kartu === oldUid; });
      if (s){ s.nama = nama; s.uid_kartu = uid; s.id_kartu = idK; s.kelas = kls; }
      closeEdit(); renderStudentTable();
      showToast('Data siswa berhasil diperbarui!', 'success');
      callGAS({ action:'updateStudent', old_uid_kartu:oldUid, nama:nama, uid_kartu:uid, id_kartu:idK, kelas:kls }).catch(function(){});
    });

    window.editSiswa = function(uid) {
      var s = studentList.find(function(x){ return x.uid_kartu === uid; });
      if (!s) return;
      if (el('editOldUid'))  el('editOldUid').value  = s.uid_kartu;
      if (el('editNama'))    el('editNama').value     = s.nama;
      if (el('editUid'))     el('editUid').value      = s.uid_kartu;
      if (el('editIdKartu')) el('editIdKartu').value  = s.id_kartu;
      if (el('editKelas'))   el('editKelas').value    = s.kelas;
      var m = el('editStudentModal'); if (m) m.classList.remove('hidden');
    };
  } // end setupEditModal

  /* =========================================================
     APPROVAL KEPALA ASRAMA
     Hanya akun dengan mata_pelajaran "kepala asrama".
     Guru lain: izin yang mereka beri masuk ke sini dulu.
  ========================================================= */
  function applyRoleUI() {
    var tabBtn = el('approvalTabBtn');
    var kepala = isKepala();
    if (tabBtn) tabBtn.classList.toggle('hidden', !kepala);
    if (kepala) {
      loadPending(false);
    } else {
      var sec = el('tab-approval');
      if (sec && sec.classList.contains('active')) {
        var guruTab = document.querySelector('.nav-tab[data-tab="tab-guru"]');
        if (guruTab) guruTab.click();
      }
      approvalList = [];
      selectedApproval = {};
      renderApproval();
    }
  }

  function updateApprovalBadge() {
    var b = el('approvalBadge');
    if (!b) return;
    b.textContent = approvalList.length;
    b.classList.toggle('hidden', approvalList.length === 0);
  }

  function loadPending(silent) {
    if (!isKepala()) return;
    callGAS({ action: 'getPending', username: currentUser.username }, 10000)
      .then(function (res) {
        if (res && res.success) {
          var baru = res.pending || [];
          var adaBaru = baru.some(function (p) {
            return !approvalList.some(function (o) { return o.uid_kartu === p.uid_kartu; });
          });
          approvalList = baru;
          Object.keys(selectedApproval).forEach(function (u) {
            if (!approvalList.some(function (p) { return p.uid_kartu === u; })) delete selectedApproval[u];
          });
          renderApproval();
          if (silent && adaBaru) showToast('Ada permintaan izin baru menunggu persetujuan Anda.', 'info');
        } else if (!silent) {
          showToast((res && res.message) || 'Gagal memuat daftar approval.', 'error');
        }
      })
      .catch(function () {
        if (!silent) showToast('Tidak dapat terhubung ke Google Sheets.', 'error');
      });
  }

  function pollApproval() {
    if (isKepala() && !document.hidden) loadPending(true);
  }

  function renderApproval() {
    updateApprovalBadge();
    var tbody = el('approvalTableBody');
    if (!tbody) return;

    var n   = Object.keys(selectedApproval).length;
    var all = el('approvalSelectAll');
    if (all) {
      var terpilih = approvalList.filter(function (p) { return selectedApproval[p.uid_kartu]; }).length;
      all.disabled      = approvalList.length === 0;
      all.checked       = approvalList.length > 0 && terpilih === approvalList.length;
      all.indeterminate = terpilih > 0 && terpilih < approvalList.length;
    }
    var bar = el('approvalBar');
    if (bar) bar.classList.toggle('hidden', n === 0);
    if (el('approvalCount'))      el('approvalCount').textContent      = n + ' permintaan dipilih';
    if (el('approvalApproveBtn')) el('approvalApproveBtn').textContent = 'Setujui (' + n + ')';
    if (el('approvalRejectBtn'))  el('approvalRejectBtn').textContent  = 'Tolak (' + n + ')';

    if (!approvalList.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4" style="color:#64748b;">Tidak ada permintaan izin yang menunggu persetujuan.</td></tr>';
      return;
    }

    tbody.innerHTML = approvalList.map(function (p) {
      var dipilih = !!selectedApproval[p.uid_kartu];
      return '<tr' + (dipilih ? ' class="is-selected"' : '') + '>' +
        '<td class="col-check"><input type="checkbox" class="row-check approval-check" data-uid="' + escAttr(p.uid_kartu) + '"' +
          (dipilih ? ' checked' : '') + ' aria-label="Pilih ' + escAttr(p.nama) + '"></td>' +
        '<td style="font-weight:600;">' + escAttr(p.nama) + '<span class="sub-note code-font">' + escAttr(p.uid_kartu) + '</span></td>' +
        '<td>Kelas ' + escAttr(p.kelas) + '</td>' +
        '<td>' + escAttr(p.peminta || '-') + '</td>' +
        '<td style="font-size:.8rem;">' + escAttr(p.waktu || '-') + '</td>' +
        '<td style="font-weight:700;">' + escAttr(p.batas || '-') + '</td>' +
        '<td><div class="approval-actions">' +
          '<button class="btn btn-sm btn-success" data-act="approve" data-uid="' + escAttr(p.uid_kartu) + '">✓ Setujui</button>' +
          '<button class="btn btn-sm btn-danger" data-act="reject" data-uid="' + escAttr(p.uid_kartu) + '">✗ Tolak</button>' +
        '</div></td>' +
        '</tr>';
    }).join('');
  }

  function prosesApproval(uids, setuju) {
    if (!isKepala() || !uids || !uids.length) return;
    if (!setuju && !confirm('Tolak ' + uids.length + ' permintaan izin?')) return;

    // Tampilan langsung berubah; server tetap sumber kebenaran (disegarkan setelah respons)
    approvalList = approvalList.filter(function (p) { return uids.indexOf(p.uid_kartu) === -1; });
    uids.forEach(function (u) { delete selectedApproval[u]; });
    studentList.forEach(function (s) {
      if (uids.indexOf(s.uid_kartu) !== -1 && s.status_izin === STATUS_MENUNGGU) {
        s.status_izin = setuju ? 'Diizinkan' : 'Tidak Diizinkan';
        if (!setuju) s.izin_berakhir = null;
      }
    });
    renderApproval();
    renderStudentTable();

    callGAS({
      action  : setuju ? 'approveIzin' : 'rejectIzin',
      uids    : JSON.stringify(uids),
      username: currentUser.username,
      peminta : currentUser.nama
    }, 20000)
      .then(function (res) {
        if (res && res.success) {
          var extra = (res.dilewati && res.dilewati.length) ? ' (' + res.dilewati.length + ' sudah diproses/kedaluwarsa)' : '';
          showToast('✓ ' + res.jumlah + (setuju ? ' izin disetujui' : ' izin ditolak') + extra, extra ? 'warning' : 'success');
        } else {
          showToast('Gagal memproses: ' + ((res && res.message) || 'tidak ada respons'), 'error');
        }
        loadPending(false);
        refreshStudentsSilently();
      })
      .catch(function () {
        showToast('Koneksi ke Google Sheets gagal. Daftar disegarkan.', 'error');
        loadPending(false);
        refreshStudentsSilently();
      });
  }

  window.setujuiIzin = function (uid) { prosesApproval([uid], true); };

  function setupApproval() {
    var tbody = el('approvalTableBody');
    if (tbody) {
      tbody.addEventListener('change', function (e) {
        var cb = e.target;
        if (!cb || !cb.classList || !cb.classList.contains('approval-check')) return;
        var uid = cb.getAttribute('data-uid');
        if (!uid) return;
        if (cb.checked) selectedApproval[uid] = true; else delete selectedApproval[uid];
        renderApproval();
      });
      tbody.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button[data-act]') : null;
        if (!b) return;
        prosesApproval([b.getAttribute('data-uid')], b.getAttribute('data-act') === 'approve');
      });
    }

    var semua = el('approvalSelectAll');
    if (semua) semua.addEventListener('change', function () {
      approvalList.forEach(function (p) {
        if (semua.checked) selectedApproval[p.uid_kartu] = true; else delete selectedApproval[p.uid_kartu];
      });
      renderApproval();
    });

    if (el('approvalApproveBtn')) el('approvalApproveBtn').addEventListener('click', function () {
      prosesApproval(Object.keys(selectedApproval), true);
    });
    if (el('approvalRejectBtn')) el('approvalRejectBtn').addEventListener('click', function () {
      prosesApproval(Object.keys(selectedApproval), false);
    });
    if (el('refreshApprovalBtn')) el('refreshApprovalBtn').addEventListener('click', function () { loadPending(false); });
  }

}); // end DOMContentLoaded
