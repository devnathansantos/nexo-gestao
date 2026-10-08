(() => {
  'use strict';

  /*
   * NEXO Gestão — V3, architecture-ready edition.
   *
   * The UI reads/writes through this small storage layer so a future
   * Supabase/API repository can replace localStorage without rewriting views.
   * Data uses stable IDs, integer cents, timestamps, soft-deactivation and
   * schema migration. Years are not hard-coded: 2027, 2028, 2029, 2030 and
   * future years are handled by the same date/month functions.
   */
  const APP_VERSION = '3.6.0';
  const DATA_SCHEMA_VERSION = 4;
  const ACCOUNTS_KEY = 'nexo_accounts_v3';
  const SESSION_KEY = 'nexo_session_v3';
  const DATA_PREFIX = 'nexo_data_v3_';
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const categories = ['Produtos','Combustível','Manutenção','Equipamentos','Aluguel','Energia','Água','Internet','Impostos','Outros'];
  const paymentMethods = ['PIX','Dinheiro','Cartão de débito','Cartão de crédito','Transferência','Boleto','Outro'];
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = cents => new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' }).format((Number(cents) || 0) / 100);
  const amountToCents = value => Math.round((Number(String(value).replace(',', '.')) || 0) * 100);
  const centsFromEntry = entry => Number.isInteger(entry?.amountCents) ? entry.amountCents : amountToCents(entry?.value);
  const valueForInput = cents => ((Number(cents) || 0) / 100).toFixed(2);
  const uid = () => {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (_) {}
    return `nx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
  };
  const nowISO = () => new Date().toISOString();
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const initials = value => String(value || '').trim().split(/\s+/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase() || 'NX';
  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const normalizePlate = value => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const normalizeText = value => String(value || '').trim().replace(/\s+/g, ' ');
  const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const isSafeId = value => SAFE_ID_RE.test(String(value || ''));
  const isValidDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
  const monthKey = date => {
    if (!isValidDate(date)) return '';
    const d = new Date(`${date}T12:00:00`);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  };
  const fmtDate = date => isValidDate(date) ? new Date(`${date}T12:00:00`).toLocaleDateString('pt-BR') : '—';
  const keyForEmail = email => { const normalized=normalizeEmail(email); return `${DATA_PREFIX}${btoa(unescape(encodeURIComponent(normalized))).replace(/=+$/,'')}`; };
  const dateForSelectedPeriod = () => {
    const today = new Date();
    if (today.getFullYear() === selectedMonth.getFullYear() && today.getMonth() === selectedMonth.getMonth()) {
      return dateISO(today);
    }
    return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth()+1).padStart(2,'0')}-01`;
  };
  const dateISO = d => {
    const x = d || new Date();
    const local = new Date(x.getTime() - x.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0,10);
  };

  const StorageRepository = {
    read(key, fallback) {
      try { const raw = localStorage.getItem(key); return raw == null ? fallback : JSON.parse(raw); }
      catch (_) { return fallback; }
    },
    write(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (_) { notify('Não foi possível salvar. O armazenamento do navegador pode estar cheio.'); return false; }
    },
    remove(key) { try { localStorage.removeItem(key); } catch (_) {} }
  };

  let accounts = StorageRepository.read(ACCOUNTS_KEY, {});
  if (!accounts || typeof accounts !== 'object' || Array.isArray(accounts)) accounts = {};
  let currentEmail = normalizeEmail(localStorage.getItem(SESSION_KEY) || '');
  let data = null;
  let selectedMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let currentView = 'dashboard';
  let authMode = 'login';
  let clientFilter = 'active';
  let employeeFilter = 'active';
  let profileEmployeeId = '';
  let profileClientId = '';
  let serviceDraft = null;
  let confirmResolver = null;

  function saveAccounts() { StorageRepository.write(ACCOUNTS_KEY, accounts); }

  function ab64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  function b64ua(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  async function pbkdf2(password, saltB64, iterations = 120000) {
    if (!crypto?.subtle) throw new Error('Web Crypto indisponível');
    const keyMaterial = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({name:'PBKDF2',salt:b64ua(saltB64),iterations,hash:'SHA-256'}, keyMaterial, 256);
    return ab64(bits);
  }
  async function createPasswordRecord(password) {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltB64 = ab64(salt);
    return { passwordHash: await pbkdf2(password, saltB64), passwordSalt: saltB64, passwordIterations: 120000, passwordAlgo: 'PBKDF2-SHA-256' };
  }
  async function legacySHA256(password) {
    if (!crypto?.subtle) throw new Error('Web Crypto indisponível');
    const bits = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2,'0')).join('');
  }
  async function verifyAccountPassword(record, password) {
    if (!record) return false;
    if (record.passwordAlgo === 'PBKDF2-SHA-256' && record.passwordSalt) {
      return (await pbkdf2(password, record.passwordSalt, Number(record.passwordIterations) || 120000)) === record.passwordHash;
    }
    return (await legacySHA256(password)) === record.passwordHash;
  }

  function emptyData(account) {
    const ts = nowISO();
    const companyId = uid();
    return {
      schemaVersion: DATA_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      createdAt: ts,
      updatedAt: ts,
      lastBackupAt: '',
      storagePersistent: false,
      ownerName: account?.name || '',
      ownerEmail: account?.email || '',
      company: { id: companyId, name: 'Minha empresa', short: 'Minha empresa', currency: 'BRL', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo', members: [] },
      clients: [], employees: [], entries: []
    };
  }

  function withTimestamps(record, createdFallback) {
    const createdAt = record.createdAt || createdFallback || nowISO();
    return {...record, createdAt, updatedAt: record.updatedAt || createdAt};
  }

  function migrateData(source) {
    const base = emptyData(accounts[currentEmail] || {});
    const x = (source && typeof source === 'object') ? {...base, ...source} : base;
    x.schemaVersion = DATA_SCHEMA_VERSION;
    x.appVersion = APP_VERSION;
    x.ownerName = normalizeText(x.ownerName || accounts[currentEmail]?.name || '');
    x.ownerEmail = currentEmail || normalizeEmail(x.ownerEmail);
    x.company = {...base.company, ...(x.company || {})};
    if (!Array.isArray(x.company.members)) x.company.members = [];
    if (currentEmail && !x.company.members.some(m => m?.email === currentEmail)) x.company.members.push({id:uid(),email:currentEmail,role:'owner',status:'active',createdAt:x.createdAt||nowISO()});
    if (!normalizeText(x.company.name) || ['Central Estética Automotiva','Central Estética'].includes(x.company.name)) x.company.name = 'Minha empresa';
    if (!normalizeText(x.company.short) || ['Central Estética Automotiva','Central Estética'].includes(x.company.short)) x.company.short = x.company.name;
    x.company.name = normalizeText(x.company.name);
    x.company.short = normalizeText(x.company.short) || x.company.name;
    x.company.id = x.company.id || uid();

    const created = x.createdAt || nowISO();
    const usedIds = new Set();
    const stableId = candidate => {
      const value = String(candidate || '');
      if (isSafeId(value) && !usedIds.has(value)) { usedIds.add(value); return value; }
      let next = uid();
      while (usedIds.has(next)) next = uid();
      usedIds.add(next);
      return next;
    };
    x.company.id = stableId(x.company.id);
    x.company.members = x.company.members.map(member => ({...member, id: stableId(member?.id), email: normalizeEmail(member?.email), role: normalizeText(member?.role) || 'member', status: normalizeText(member?.status) || 'active'}));
    x.clients = Array.isArray(x.clients) ? x.clients : [];
    x.employees = Array.isArray(x.employees) ? x.employees : [];
    x.entries = Array.isArray(x.entries) ? x.entries : [];

    const clientByName = new Map();
    x.clients = x.clients.map(c => {
      const out = withTimestamps({
        id: stableId(c?.id), companyId: x.company.id, name: normalizeText(c?.name), phone: normalizeText(c?.phone), email: normalizeText(c?.email), notes: normalizeText(c?.notes),
        active: c?.active !== false, deletedAt: c?.deletedAt || null,
        vehicles: Array.isArray(c?.vehicles) ? c.vehicles.map(v => withTimestamps({
          id: stableId(v?.id), model: normalizeText(v?.model || v?.vehicle), plate: normalizePlate(v?.plate), year: String(v?.year || '').trim(), active: v?.active !== false, deletedAt: v?.deletedAt || null
        }, created)) .filter(v => v.model) : []
      }, created);
      if (out.name) clientByName.set(out.name.toLowerCase(), out);
      return out;
    }).filter(c => c.name);

    const employeeByName = new Map();
    x.employees = x.employees.map(e => {
      const out = withTimestamps({id:stableId(e?.id),companyId:x.company.id,name:normalizeText(e?.name),role:normalizeText(e?.role),phone:normalizeText(e?.phone),active:e?.active !== false,deletedAt:e?.deletedAt || null}, created);
      if (out.name) employeeByName.set(out.name.toLowerCase(), out);
      return out;
    }).filter(e => e.name);

    x.entries = x.entries.map(e => {
      const out = withTimestamps({
        id: stableId(e?.id), companyId: x.company.id, source: e?.source || 'manual', type: ['service','expense','payroll'].includes(e?.type) ? e.type : 'expense', date: isValidDate(e?.date) ? e.date : dateISO(),
        amountCents: centsFromEntry(e), description: normalizeText(e?.description || e?.reason), category: normalizeText(e?.category) || 'Outros',
        status: e?.status === 'pending' ? 'pending' : (e?.status === 'cancelled' ? 'cancelled' : 'received'), paymentMethod: normalizeText(e?.paymentMethod),
        supplier: normalizeText(e?.supplier), notes: normalizeText(e?.notes), clientId: e?.clientId || '', vehicleId: e?.vehicleId || '', employeeId: e?.employeeId || '',
        clientNameSnapshot: normalizeText(e?.clientNameSnapshot || e?.client), vehicleModelSnapshot: normalizeText(e?.vehicleModelSnapshot || e?.vehicle), plateSnapshot: normalizePlate(e?.plateSnapshot || e?.plate),
        voidedAt: e?.voidedAt || null, voidReason: normalizeText(e?.voidReason)
      }, created);

      if (out.type === 'service') {
        let client = x.clients.find(c => c.id === out.clientId);
        if (!client && out.clientNameSnapshot) client = clientByName.get(out.clientNameSnapshot.toLowerCase());
        if (!client && out.clientNameSnapshot) {
          client = withTimestamps({id:uid(),companyId:x.company.id,name:out.clientNameSnapshot,phone:'',email:'',notes:'',active:true,deletedAt:null,vehicles:[]}, created);
          x.clients.push(client); clientByName.set(client.name.toLowerCase(), client);
        }
        if (client) {
          out.clientId = client.id;
          out.clientNameSnapshot = client.name;
          let vehicle = client.vehicles.find(v => v.id === out.vehicleId);
          if (!vehicle && out.vehicleModelSnapshot) vehicle = client.vehicles.find(v => v.model.toLowerCase() === out.vehicleModelSnapshot.toLowerCase() && v.plate === out.plateSnapshot);
          if (!vehicle && out.vehicleModelSnapshot) {
            vehicle = withTimestamps({id:uid(),companyId:x.company.id,model:out.vehicleModelSnapshot,plate:out.plateSnapshot,year:'',active:true,deletedAt:null}, created);
            client.vehicles.push(vehicle);
          }
          if (vehicle) {
            out.vehicleId = vehicle.id;
            out.vehicleModelSnapshot = vehicle.model;
            out.plateSnapshot = vehicle.plate;
          }
        }
        out.category = '';
        if (!['received','pending','cancelled'].includes(out.status)) out.status = 'received';
        if (!out.paymentMethod && out.status === 'received') out.paymentMethod = 'PIX';
      }
      if (out.type === 'expense') {
        out.status = out.status === 'cancelled' ? 'cancelled' : 'received';
        if (!out.paymentMethod) out.paymentMethod = 'PIX';
        out.category = categories.includes(out.category) ? out.category : 'Outros';
      }
      if (out.type === 'payroll') {
        if (!out.employeeId && e?.employee) {
          let emp = employeeByName.get(normalizeText(e.employee).toLowerCase());
          if (!emp) { emp = withTimestamps({id:uid(),companyId:x.company.id,name:normalizeText(e.employee),role:'',phone:'',active:true,deletedAt:null}, created); x.employees.push(emp); employeeByName.set(emp.name.toLowerCase(),emp); }
          out.employeeId = emp.id;
        }
        out.status = out.status === 'cancelled' ? 'cancelled' : 'received';
        out.description = out.description || 'Comissão';
      }
      out.value = out.amountCents / 100; // compatibility snapshot for old consumers
      return out;
    });

    // Keep historical arrays deterministic and ensure IDs remain stable.
    x.clients = x.clients.map(c => withTimestamps(c, created));
    x.employees = x.employees.map(e => withTimestamps(e, created));
    x.updatedAt = nowISO();
    return x;
  }

  function loadData(email) {
    const saved = StorageRepository.read(keyForEmail(email), null);
    return migrateData(saved || emptyData(accounts[email] || {}));
  }
  function saveData() {
    if (!currentEmail || !data) return false;
    data.updatedAt = nowISO();
    return StorageRepository.write(keyForEmail(currentEmail), data);
  }

  function currentKey() { return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth()+1).padStart(2,'0')}`; }
  function entriesFor(key=currentKey()) { return (data?.entries || []).filter(e => !e.voidedAt && e.status !== 'cancelled' && monthKey(e.date) === key); }
  const services = key => entriesFor(key).filter(e => e.type === 'service');
  const expenses = key => entriesFor(key).filter(e => e.type === 'expense');
  const payroll = key => entriesFor(key).filter(e => e.type === 'payroll');
  const totalCents = entries => entries.reduce((sum,e) => sum + centsFromEntry(e), 0);
  const clientById = id => data?.clients.find(c => c.id === id);
  const employeeById = id => data?.employees.find(e => e.id === id);
  const vehicleById = (client,id) => client?.vehicles?.find(v => v.id === id);
  const currentYear = () => selectedMonth.getFullYear();

  function notify(message) {
    const node = $('#toast');
    if (!node) return;
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(window.__nexoToast);
    window.__nexoToast = setTimeout(() => node.classList.remove('show'), 2800);
  }

  function confirmAction(message, title='Confirmar ação', button='Confirmar') {
    return new Promise(resolve => {
      confirmResolver = resolve;
      $('#confirmTitle').textContent = title;
      $('#confirmMessage').textContent = message;
      $('#confirmOk').textContent = button;
      $('#confirmModal').classList.remove('hidden');
      $('#confirmModal').setAttribute('aria-hidden','false');
    });
  }
  function finishConfirm(result) {
    $('#confirmModal').classList.add('hidden');
    $('#confirmModal').setAttribute('aria-hidden','true');
    if (confirmResolver) { const resolve = confirmResolver; confirmResolver = null; resolve(result); }
  }

  function setAuthMode(mode) {
    authMode = mode === 'register' ? 'register' : 'login';
    const reg = authMode === 'register';
    $('#authEyebrow').textContent = reg ? 'CRIAR CONTA' : 'ACESSO À CONTA';
    $('#authTitle').textContent = reg ? 'Crie sua conta' : 'Entrar no NEXO';
    $('#authSubtitle').textContent = reg ? 'Defina seu nome e o nome da sua empresa.' : 'Acompanhe sua empresa mês a mês.';
    $('#loginNameLabel').hidden = !reg;
    $('#loginName').required = reg;
    $('#registerCompanyLabel').hidden = !reg;
    $('#companyNameRegister').required = reg;
    $('#confirmPasswordLabel').hidden = !reg;
    $('#confirmPassword').required = reg;
    $('#authSubmit').innerHTML = reg ? 'Criar conta <span>→</span>' : 'Entrar <span>→</span>';
    $('#toggleAuth').textContent = reg ? 'Já tenho uma conta' : 'Criar uma conta';
  }

  async function handleAuth(event) {
    event.preventDefault();
    try {
      const email = normalizeEmail($('#loginEmail').value);
      const password = $('#loginPassword').value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return notify('Informe um e-mail válido.');
      if (password.length < 6) return notify('A senha precisa ter pelo menos 6 caracteres.');
      if (!crypto?.subtle) return notify('Abra o site pelo GitHub Pages ou outro endereço HTTPS para usar o login.');

      if (authMode === 'register') {
        const ownerName = normalizeText($('#loginName').value);
        const companyName = normalizeText($('#companyNameRegister').value);
        if (ownerName.length < 2) return notify('Informe seu nome.');
        if (companyName.length < 2) return notify('Informe o nome da empresa.');
        if (password !== $('#confirmPassword').value) return notify('As senhas não conferem.');
        if (accounts[email]) return notify('Este e-mail já possui uma conta. Entre normalmente.');
        const auth = await createPasswordRecord(password);
        const ts = nowISO();
        accounts[email] = {email,name:ownerName,...auth,createdAt:ts,updatedAt:ts};
        saveAccounts();
        const fresh = emptyData(accounts[email]);
        fresh.ownerName = ownerName;
        fresh.ownerEmail = email;
        fresh.company.name = companyName;
        fresh.company.short = companyName;
        StorageRepository.write(keyForEmail(email), fresh);
        currentEmail = email;
        data = fresh;
        localStorage.setItem(SESSION_KEY, email);
        $('#loginForm').reset();
        ensureSession();
        notify('Conta criada. Bem-vindo ao NEXO.');
      } else {
        if (!accounts[email]) return notify('Conta não encontrada. Crie uma conta primeiro.');
        if (!(await verifyAccountPassword(accounts[email], password))) return notify('E-mail ou senha incorretos.');
        // Upgrade the old V3 SHA-256-only record to PBKDF2 after a successful login.
        if (accounts[email].passwordAlgo !== 'PBKDF2-SHA-256') {
          Object.assign(accounts[email], await createPasswordRecord(password), {updatedAt:nowISO()});
          saveAccounts();
        }
        currentEmail = email;
        data = loadData(email);
        localStorage.setItem(SESSION_KEY, email);
        $('#loginForm').reset();
        ensureSession();
        notify(`Bem-vindo, ${accounts[email].name}.`);
      }
    } catch (error) {
      notify(`Não foi possível concluir o acesso: ${error?.message || 'erro inesperado'}.`);
    }
  }

  function ensureSession() {
    const email = normalizeEmail(localStorage.getItem(SESSION_KEY) || '');
    if (email && accounts[email]) {
      currentEmail = email;
      data = loadData(email);
      $('#loginScreen').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#mobileNav').classList.remove('hidden');
      requestPersistentStorage().then(()=>{ if(data){ saveData(); renderAll(); } });
      renderAll();
    } else {
      currentEmail = '';
      data = null;
      StorageRepository.remove(SESSION_KEY);
      $('#loginScreen').classList.remove('hidden');
      $('#app').classList.add('hidden');
      $('#mobileNav').classList.add('hidden');
    }
  }

  function updatePageTitle() {
    const labels = {
      dashboard:['VISÃO GERAL','Dashboard'], clients:['CADASTROS','Clientes'], services:['ENTRADAS','Serviços'], expenses:['SAÍDAS','Despesas'], employees:['EQUIPE','Funcionários'], analysis:['VISÃO ANUAL','Análises'], manage:['MANUTENÇÃO','Gerenciar'], settings:['EMPRESA','Configurações']
    };
    const label = labels[currentView] || labels.dashboard;
    $('#pageEyebrow').textContent = label[0];
    $('#pageTitle').textContent = label[1];
  }
  function go(view) {
    if (!$(`#view-${view}`)) view = 'dashboard';
    currentView = view;
    $$('.view').forEach(v => v.classList.remove('active-view'));
    $(`#view-${view}`).classList.add('active-view');
    $$('.nav-item[data-view], .mobile-nav [data-view]').forEach(n => n.classList.toggle('active', n.dataset.view === view));
    updatePageTitle();
    document.body.classList.remove('mobile-menu-open');
    window.scrollTo({top:0,behavior:'smooth'});
  }

  async function requestPersistentStorage() {
    try {
      if (!navigator.storage?.persist) return false;
      const granted = await navigator.storage.persist();
      if (data) data.storagePersistent = granted;
      return granted;
    } catch (_) { return false; }
  }

  function isStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function renderStorageNotice() {
    const notice = $('#storageNotice');
    if (!notice || !data) return;
    notice.classList.toggle('hidden', isStandalone() || localStorage.getItem(`nexo_install_notice_dismissed_${currentEmail}`) === '1');
  }

  const BACKUP_INTERVAL_MS = 7 * 86400000;

  function backupDaysSince() {
    if (!data?.lastBackupAt) return null;
    const timestamp = new Date(data.lastBackupAt).getTime();
    if (!Number.isFinite(timestamp)) return null;
    return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  }

  function isBackupDue() {
    if (!data?.lastBackupAt) return true;
    const timestamp = new Date(data.lastBackupAt).getTime();
    return !Number.isFinite(timestamp) || Date.now() - timestamp >= BACKUP_INTERVAL_MS;
  }

  function updateBackupStatus() {
    const node = $('#backupStatus');
    if (!node || !data) return;
    const days = backupDaysSince();
    if (days === null) { node.textContent = 'Nenhum backup feito nesta conta ainda.'; return; }
    node.textContent = days <= 0 ? 'Backup feito hoje.' : `Último backup há ${days} ${days === 1 ? 'dia' : 'dias'}.`;
    node.classList.toggle('warning-text', days >= 7);
  }

  function renderBackupReminder() {
    const card = $('#backupReminder');
    const text = $('#backupReminderText');
    if (!card || !text || !data) return;
    const due = isBackupDue();
    card.classList.toggle('hidden', !due);
    if (!due) return;
    const days = backupDaysSince();
    text.textContent = days === null
      ? 'Você ainda não fez nenhum backup. Exporte agora uma cópia dos seus dados e guarde o arquivo em um local seguro.'
      : `Seu último backup foi há ${days} dias. Faça um novo backup agora para manter uma cópia recente dos seus dados.`;
  }

  function renderAll() {
    if (!data) return;
    $('#companyName').value = data.company.name;
    $('#companyShort').value = data.company.short;
    $('#sidebarCompany').textContent = data.company.short || data.company.name;
    $('#companyAvatar').textContent = initials(data.company.short || data.company.name);
    $('#sidebarUser').textContent = data.ownerName || currentEmail;
    $('#accountName').value = data.ownerName || accounts[currentEmail]?.name || '';
    $('#accountSummary').textContent = `Conta: ${currentEmail}`;
    $('#dataSummary').textContent = `${data.clients.length} clientes · ${data.employees.length} funcionários · ${data.entries.filter(e=>!e.voidedAt).length} lançamentos registrados`;
    $('#schemaBadge').textContent = `Schema ${data.schemaVersion} · app ${APP_VERSION}`;
    $('#monthLabel').textContent = `${months[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`;
    $('#dashboardGreeting').textContent = `Olá, vamos aos números de ${months[selectedMonth.getMonth()].toLowerCase()}.`;
    updatePageTitle();
    populateCategoryFilter();
    renderDashboard(); renderClients(); renderServices(); renderExpenses(); renderEmployees(); renderAnalysis(); renderManage(); renderMobileNav(); renderStorageNotice(); updateBackupStatus(); renderBackupReminder();
  }
  function renderMobileNav() { $$('.mobile-nav [data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === currentView)); }

  function previousMonthTotals() {
    const d = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()-1, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const ss=services(key), es=expenses(key), ps=payroll(key);
    return { rev:totalCents(ss), exp:totalCents(es), pay:totalCents(ps), count:ss.length, received:ss.filter(e=>e.status==='received').reduce((s,e)=>s+centsFromEntry(e),0) };
  }
  function trendText(curr, prev) {
    if (prev === 0 && curr === 0) return 'Sem movimentação no mês anterior';
    if (prev === 0) return `Nova movimentação · sem base anterior`;
    const pct = ((curr-prev)/Math.abs(prev))*100;
    return `${pct >= 0 ? '↑' : '↓'} ${Math.abs(pct).toFixed(1)}% vs. mês anterior`;
  }
  function renderDashboard() {
    const ss=services(), es=expenses(), ps=payroll();
    const revenue=totalCents(ss), exp=totalCents(es), pay=totalCents(ps);
    const received=ss.filter(e=>e.status==='received').reduce((s,e)=>s+centsFromEntry(e),0);
    const pending=ss.filter(e=>e.status==='pending').reduce((s,e)=>s+centsFromEntry(e),0);
    const result=revenue-exp-pay;
    const prev=previousMonthTotals();
    const avg=ss.length ? Math.round(revenue/ss.length) : 0;
    $('#metricRevenue').textContent=money(revenue); $('#metricRevenueSub').textContent=`${ss.length} ${ss.length===1?'serviço':'serviços'} · ${trendText(revenue,prev.rev)}`;
    $('#metricReceived').textContent=money(received); $('#metricReceivedSub').textContent=`${ss.filter(e=>e.status==='received').length} pagamentos`;
    $('#metricPending').textContent=money(pending); $('#metricPendingSub').textContent=`${ss.filter(e=>e.status==='pending').length} serviços pendentes`;
    $('#metricExpenses').textContent=money(exp); $('#metricExpensesSub').textContent=`${es.length} lançamentos · ${trendText(exp,prev.exp)}`;
    $('#metricPayroll').textContent=money(pay); $('#metricPayrollSub').textContent=`${ps.length} pagamentos a funcionários`;
    $('#metricResult').textContent=money(result); $('#metricResult').style.color = result >= 0 ? '#fff' : '#ffb8c0';
    $('#metricTicket').textContent=money(avg); $('#metricTicketSub').textContent=ss.length ? 'Faturamento ÷ serviços' : 'Nenhum serviço no mês';
    $('#metricServices').textContent=ss.length; $('#metricServicesSub').textContent=trendText(ss.length,prev.count,'serviços');

    let insight = '<strong>Visão do período:</strong> Comece registrando um serviço, uma despesa ou uma comissão para construir seu painel.';
    if (ss.length) {
      if (pending > 0) insight = `<strong>${money(pending)}</strong> em serviços ainda pendentes de recebimento. Faturamento considera o serviço realizado; “Recebido” mostra o caixa já pago.`;
      else if (result < 0) insight = `<strong>Resultado negativo:</strong> as despesas e comissões superaram o faturamento deste período.`;
      else insight = `<strong>Resultado positivo:</strong> ${money(result)} após despesas e comissões no período selecionado.`;
    }
    $('#dashboardInsight').innerHTML = insight;

    const recent = ss.slice().sort((a,b)=>b.date.localeCompare(a.date) || (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,6);
    $('#recentServices').innerHTML = recent.length ? recent.map(e=>`<div class="list-row"><div class="row-avatar">${initials(e.clientNameSnapshot)}</div><div class="row-main"><b>${esc(e.vehicleModelSnapshot || 'Veículo')}</b><small>${esc(e.clientNameSnapshot || 'Cliente')} · ${esc(e.plateSnapshot || 'Sem placa')} · ${fmtDate(e.date)}</small></div><div class="row-value">${money(centsFromEntry(e))}</div></div>`).join('') : '<div class="empty">Nenhum serviço neste mês.</div>';

    const totals={}; ps.forEach(p=>{const emp=employeeById(p.employeeId);const label=emp?.name || 'Funcionário inativo'; totals[label]=(totals[label]||0)+centsFromEntry(p);});
    const top=Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,4);
    $('#teamSummary').innerHTML = top.length ? top.map(([name,val])=>`<div class="team-row"><div class="row-avatar">${initials(name)}</div><div class="row-main"><b>${esc(name)}</b><small>Pagamentos a funcionários no mês</small></div><div class="row-value">${money(val)}</div></div>`).join('') : '<div class="empty">Nenhuma comissão registrada.</div>';
    renderRevenueChart(); renderExpenseDonut();
  }

  function renderRevenueChart() {
    const vals=[];
    for (let i=5;i>=0;i--) {
      const d=new Date(selectedMonth.getFullYear(), selectedMonth.getMonth()-i, 1);
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      vals.push({label:months[d.getMonth()].slice(0,3), year:d.getFullYear(), value:totalCents(services(key))});
    }
    const max=Math.max(...vals.map(x=>x.value),1);
    $('#revenueChart').innerHTML=vals.map(x=>`<div class="bar-col" title="${months[months.findIndex(m=>m.slice(0,3)===x.label)] || x.label} ${x.year}: ${money(x.value)}"><b>${x.value ? esc(money(x.value).replace(',00','')) : ''}</b><div class="bar" style="height:${Math.max(4,(x.value/max)*145)}px"></div><small>${x.label}${new Date().getFullYear()!==x.year ? ` ${String(x.year).slice(2)}` : ''}</small></div>`).join('');
  }

  function renderExpenseDonut() {
    const map={}; expenses().forEach(e=>{map[e.category]=(map[e.category]||0)+centsFromEntry(e)});
    const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]);
    const total=totalCents(expenses());
    const colors=['#1477f8','#47b6ff','#7b61d1','#5cc88c','#f3a84a','#ef6c77'];
    $('#donutTotal').textContent=money(total).replace(',00','');
    let acc=0;
    const stops=rows.length && total ? rows.map(([c,v],i)=>{const p=v/total*100;const s=`${colors[i%colors.length]} ${acc}% ${acc+p}%`;acc+=p;return s;}).join(',') : '#e8edf2 0 100%';
    $('.donut').style.background=`conic-gradient(${stops})`;
    $('#donutLegend').innerHTML=rows.length ? rows.slice(0,6).map(([c,v],i)=>`<div class="legend-row"><span class="legend-left"><i style="background:${colors[i%colors.length]}"></i>${esc(c)}</span><b>${money(v)}</b></div>`).join('') : '<span class="muted">Sem despesas no período.</span>';
  }

  function renderClients() {
    const q=normalizeText($('#clientSearch')?.value).toLowerCase();
    const all=data.clients.filter(c=>c.active === (clientFilter === 'active'));
    const list=all.filter(c=>`${c.name} ${c.phone} ${c.vehicles.map(v=>`${v.model} ${v.plate}`).join(' ')}`.toLowerCase().includes(q));
    $('#clientCount').textContent=`${list.length} ${list.length===1?'cliente':'clientes'}`;
    $('#clientCards').innerHTML=list.length ? list.map(c=>{
      const hist=data.entries.filter(e=>e.type==='service'&&!e.voidedAt&&e.clientId===c.id);
      const activeVehicles=c.vehicles.filter(v=>v.active!==false);
      return `<article class="client-card"><div class="client-top"><div class="client-avatar">${initials(c.name)}</div><div class="row-main"><h3>${esc(c.name)}</h3><small>${activeVehicles.length} ${activeVehicles.length===1?'veículo':'veículos'} · ${hist.length} ${hist.length===1?'serviço':'serviços'}</small></div><span class="status ${c.active?'active':'inactive'}">${c.active?'Ativo':'Inativo'}</span></div><div class="client-vehicles">${activeVehicles.slice(0,4).map(v=>`<span>${esc(v.model)}${v.plate?' · '+esc(v.plate):''}</span>`).join('')||'<span>Nenhum veículo ativo</span>'}</div><div class="card-actions"><button class="btn secondary small-btn" data-open-client="${esc(c.id)}" type="button">Abrir cliente</button><button class="icon-action" data-edit-client="${esc(c.id)}" title="Editar cliente" type="button">✎</button>${c.active ? `<button class="icon-action danger-action" data-inactivate-client="${esc(c.id)}" title="Inativar" type="button">×</button>` : `<button class="icon-action" data-reactivate-client="${esc(c.id)}" title="Reativar" type="button">↻</button>`}</div></article>`;
    }).join('') : `<div class="empty employee-empty">Nenhum cliente ${clientFilter==='active'?'ativo':'inativo'} encontrado.</div>`;
    $$('[data-client-filter]').forEach(b=>b.classList.toggle('active',b.dataset.clientFilter===clientFilter));
  }

  function serviceName(entry) { const client=clientById(entry.clientId); return client?.name || entry.clientNameSnapshot || 'Cliente'; }
  function renderServices() {
    const q=normalizeText($('#serviceSearch')?.value).toLowerCase();
    const list=services().filter(e=>`${serviceName(e)} ${e.vehicleModelSnapshot||''} ${e.plateSnapshot||''} ${e.description||''}`.toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));
    $('#serviceCount').textContent=`${list.length} ${list.length===1?'serviço':'serviços'} em ${months[selectedMonth.getMonth()].toLowerCase()}`;
    $('#servicesList').innerHTML=`<div class="table-head service-table"><span>Cliente / carro</span><span>Serviço</span><span>Status</span><span>Data</span><span>Valor</span><span></span></div>${list.length ? list.map(e=>`<div class="table-row service-table"><div><b>${esc(serviceName(e))}</b><small>${esc(e.vehicleModelSnapshot||'Veículo')}${e.plateSnapshot?' · '+esc(e.plateSnapshot):''}</small></div><div>${esc(e.description||'Serviço realizado')}</div><div><span class="status ${e.status==='pending'?'pending':'received'}">${e.status==='pending'?'Pendente':'Recebido'}</span></div><div>${fmtDate(e.date)}</div><div><b>${money(centsFromEntry(e))}</b></div><div class="row-actions">${e.status==='pending'?`<button class="icon-action" data-mark-received="${esc(e.id)}" title="Marcar como recebido" type="button">✓</button>`:''}<button class="icon-action" data-edit-entry="${esc(e.id)}" title="Editar" type="button">✎</button><button class="icon-action danger-action" data-void-entry="${esc(e.id)}" title="Anular lançamento" type="button">×</button></div></div>`).join('') : '<div class="empty">Nenhum serviço encontrado neste período.</div>'}`;
  }

  function populateCategoryFilter() {
    const select=$('#expenseCategoryFilter'); if(!select) return;
    const current=select.value || 'all';
    select.innerHTML='<option value="all">Todas as categorias</option>'+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    select.value=categories.includes(current) ? current : 'all';
  }
  function renderExpenses() {
    const q=normalizeText($('#expenseSearch')?.value).toLowerCase(), cat=$('#expenseCategoryFilter')?.value||'all';
    const list=expenses().filter(e=>(cat==='all'||e.category===cat)&&`${e.description} ${e.category} ${e.notes} ${e.supplier}`.toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));
    const topCategory=Object.entries(expenses().reduce((m,e)=>{m[e.category]=(m[e.category]||0)+centsFromEntry(e);return m;},{})).sort((a,b)=>b[1]-a[1])[0];
    $('#expenseMiniStats').innerHTML=`<div class="mini-stat"><span>Total do mês</span><b>${money(totalCents(expenses()))}</b></div><div class="mini-stat"><span>Maior categoria</span><b>${esc(topCategory?.[0]||'—')}</b></div><div class="mini-stat"><span>Lançamentos</span><b>${expenses().length}</b></div>`;
    $('#expensesList').innerHTML=`<div class="table-head expense-table"><span>Descrição / fornecedor</span><span>Categoria</span><span>Pagamento</span><span>Data</span><span>Valor</span><span></span></div>${list.length ? list.map(e=>`<div class="table-row expense-table"><div><b>${esc(e.description)}</b><small>${esc(e.supplier || e.notes || 'Sem observação')}</small></div><div>${esc(e.category)}</div><div>${esc(e.paymentMethod || '—')}</div><div>${fmtDate(e.date)}</div><div><b>${money(centsFromEntry(e))}</b></div><div class="row-actions"><button class="icon-action" data-edit-entry="${esc(e.id)}" title="Editar" type="button">✎</button><button class="icon-action danger-action" data-void-entry="${esc(e.id)}" title="Anular lançamento" type="button">×</button></div></div>`).join('') : '<div class="empty">Nenhuma despesa encontrada neste período.</div>'}`;
  }

  function employeeCommissions(id,key=currentKey()) { return payroll(key).filter(p=>p.employeeId===id); }
  function renderEmployees() {
    const list=data.employees.filter(e=>e.active === (employeeFilter==='active'));
    $('#employeeCards').innerHTML=list.length ? list.map(emp=>{
      const ps=employeeCommissions(emp.id), value=totalCents(ps);
      return `<article class="employee-card"><div class="emp-top"><div class="emp-avatar">${initials(emp.name)}</div><div class="row-main"><h3>${esc(emp.name)}</h3><small>${ps.length} ${ps.length===1?'pagamento':'pagamentos'} em ${months[selectedMonth.getMonth()].toLowerCase()}</small></div><span class="status ${emp.active?'active':'inactive'}">${emp.active?'Ativo':'Inativo'}</span></div><strong>${money(value)}</strong><small>Comissões no período</small><div class="employee-actions"><button class="btn secondary small-btn" data-open-employee="${esc(emp.id)}" type="button">Abrir funcionário</button><button class="icon-action" data-edit-employee="${esc(emp.id)}" title="Editar funcionário" type="button">✎</button>${emp.active?`<button class="icon-action danger-action" data-inactivate-employee="${esc(emp.id)}" title="Inativar" type="button">×</button>`:`<button class="icon-action" data-reactivate-employee="${esc(emp.id)}" title="Reativar" type="button">↻</button>`}</div></article>`;
    }).join('') : `<div class="empty employee-empty">Nenhum funcionário ${employeeFilter==='active'?'ativo':'inativo'} encontrado.</div>`;
    const arr=payroll().sort((a,b)=>b.date.localeCompare(a.date));
    $('#payrollList').innerHTML=`<div class="table-head payroll-table"><span>Funcionário</span><span>Motivo</span><span>Data</span><span>Valor</span><span></span></div>${arr.length?arr.map(e=>{const emp=employeeById(e.employeeId);return `<div class="table-row payroll-table"><div><b>${esc(emp?.name||'Funcionário inativo')}</b></div><div>${esc(e.description||'Comissão')}</div><div>${fmtDate(e.date)}</div><div><b>${money(centsFromEntry(e))}</b></div><div class="row-actions"><button class="icon-action" data-edit-entry="${esc(e.id)}" title="Editar" type="button">✎</button><button class="icon-action danger-action" data-void-entry="${esc(e.id)}" title="Anular lançamento" type="button">×</button></div></div>`}).join(''):'<div class="empty">Nenhuma comissão registrada neste período.</div>'}`;
    $$('[data-employee-filter]').forEach(b=>b.classList.toggle('active',b.dataset.employeeFilter===employeeFilter));
  }

  function openEmployeeProfile(id) {
    const emp=employeeById(id); if(!emp) return;
    profileEmployeeId=id; profileClientId='';
    const allHistory=data.entries.filter(e=>e.type==='payroll'&&!e.voidedAt&&e.employeeId===id).sort((a,b)=>b.date.localeCompare(a.date));
    const monthHistory=employeeCommissions(id), monthTotal=totalCents(monthHistory), allTotal=totalCents(allHistory);
    $('#profileModalCard').innerHTML=`<button class="modal-close" data-close-profile type="button" aria-label="Fechar">×</button><span class="eyebrow">FUNCIONÁRIO</span><div class="profile-header"><div class="profile-avatar">${initials(emp.name)}</div><div><h2>${esc(emp.name)}</h2><p class="muted">${esc(emp.role||'Cadastro de equipe')} · <span class="status ${emp.active?'active':'inactive'}">${emp.active?'Ativo':'Inativo'}</span></p></div></div><div class="profile-stats"><div><span>Comissões no mês</span><b>${money(monthTotal)}</b></div><div><span>Pagamentos no mês</span><b>${monthHistory.length}</b></div><div><span>Total histórico</span><b>${money(allTotal)}</b></div></div><div class="profile-actions">${emp.active?`<button class="btn primary" data-add-commission="${esc(id)}" type="button">＋ Adicionar comissão</button>`:''}<button class="btn secondary" data-edit-employee="${esc(id)}" type="button">Editar funcionário</button>${emp.active?`<button class="btn danger-btn" data-inactivate-employee="${esc(id)}" type="button">Inativar funcionário</button>`:`<button class="btn secondary" data-reactivate-employee="${esc(id)}" type="button">Reativar funcionário</button>`}</div><div class="profile-history"><div class="panel-head"><div><h3>Comissões de ${months[selectedMonth.getMonth()]}</h3><p>${selectedMonth.getFullYear()} · mais recentes primeiro</p></div></div>${monthHistory.length?monthHistory.map(p=>`<div class="history-row"><div><b>${esc(p.description||'Comissão')}</b><small>${fmtDate(p.date)} · ${money(centsFromEntry(p))}</small></div><div class="row-actions"><button class="icon-action" data-edit-entry="${p.id}" title="Editar" type="button">✎</button><button class="icon-action danger-action" data-void-entry="${p.id}" title="Anular" type="button">×</button></div></div>`).join(''):'<div class="empty">Nenhuma comissão neste mês.</div>'}</div>`;
    $('#profileModal').classList.remove('hidden'); $('#profileModal').setAttribute('aria-hidden','false');
  }

  function openClientProfile(id) {
    const client=clientById(id); if(!client) return;
    profileClientId=id; profileEmployeeId='';
    const history=data.entries.filter(e=>e.type==='service'&&!e.voidedAt&&e.clientId===id).sort((a,b)=>b.date.localeCompare(a.date));
    const monthHistory=history.filter(e=>monthKey(e.date)===currentKey());
    const totalHistory=totalCents(history), activeVehicles=client.vehicles.filter(v=>v.active!==false);
    $('#profileModalCard').innerHTML=`<button class="modal-close" data-close-profile type="button" aria-label="Fechar">×</button><span class="eyebrow">CLIENTE</span><div class="profile-header"><div class="profile-avatar">${initials(client.name)}</div><div><h2>${esc(client.name)}</h2><p class="muted">${esc(client.phone||'Sem telefone')} · <span class="status ${client.active?'active':'inactive'}">${client.active?'Ativo':'Inativo'}</span></p></div></div><div class="profile-stats"><div><span>Serviços no mês</span><b>${monthHistory.length}</b></div><div><span>Faturamento histórico</span><b>${money(totalHistory)}</b></div><div><span>Veículos ativos</span><b>${activeVehicles.length}</b></div></div><div class="profile-actions-section"><div class="profile-actions">${client.active?`<button class="btn primary" data-add-client-service="${esc(id)}" type="button">＋ Novo serviço</button>`:''}<button class="btn secondary" data-edit-client="${esc(id)}" type="button">Editar cliente</button><button class="btn secondary" data-add-vehicle="${esc(id)}" type="button">＋ Adicionar veículo</button>${client.active?`<button class="btn danger-btn" data-inactivate-client="${esc(id)}" type="button">Inativar cliente</button>`:`<button class="btn secondary" data-reactivate-client="${esc(id)}" type="button">Reativar cliente</button>`}</div></div><div class="profile-section"><div class="panel-head"><div><h3>Veículos</h3><p>Você pode manter vários veículos por cliente.</p></div></div>${client.vehicles.length?client.vehicles.map(v=>`<div class="history-row"><div><b>${esc(v.model)}</b><small>${esc(v.plate||'Sem placa')}${v.year?' · '+esc(v.year):''} · <span class="status ${v.active?'active':'inactive'}">${v.active?'Ativo':'Inativo'}</span></small></div><div class="row-actions"><button class="icon-action" data-edit-vehicle="${esc(v.id)}" data-client-id="${esc(id)}" title="Editar veículo" type="button">✎</button>${v.active?`<button class="icon-action danger-action" data-inactivate-vehicle="${esc(v.id)}" data-client-id="${esc(id)}" title="Inativar veículo" type="button">×</button>`:`<button class="icon-action" data-reactivate-vehicle="${esc(v.id)}" data-client-id="${esc(id)}" title="Reativar veículo" type="button">↻</button>`}</div></div>`).join(''):'<div class="empty">Nenhum veículo cadastrado.</div>'}</div><div class="profile-history"><div class="panel-head"><div><h3>Histórico de serviços</h3><p>Os serviços antigos permanecem ligados ao cliente.</p></div></div>${history.slice(0,15).length?history.slice(0,15).map(s=>`<div class="history-row"><div><b>${esc(s.description||'Serviço realizado')}</b><small>${fmtDate(s.date)} · ${esc(s.vehicleModelSnapshot||'Veículo')}${s.plateSnapshot?' · '+esc(s.plateSnapshot):''} · ${money(centsFromEntry(s))}</small></div><div class="row-actions">${s.status==='pending'?`<button class="icon-action" data-mark-received="${esc(s.id)}" title="Marcar como recebido" type="button">✓</button>`:''}<button class="icon-action" data-edit-entry="${esc(s.id)}" title="Editar" type="button">✎</button><button class="icon-action danger-action" data-void-entry="${esc(s.id)}" title="Anular" type="button">×</button></div></div>`).join(''):'<div class="empty">Nenhum serviço cadastrado.</div>'}</div>`;
    $('#profileModal').classList.remove('hidden'); $('#profileModal').setAttribute('aria-hidden','false');
  }
  function closeProfile(){profileEmployeeId='';profileClientId='';$('#profileModal').classList.add('hidden');$('#profileModal').setAttribute('aria-hidden','true');}

  function renderAnalysis() {
    const y=currentYear();
    let yearRev=0,yearReceived=0,yearPending=0,yearExp=0,yearPay=0,yearServices=0;
    const rows=months.map((name,m)=>{
      const key=`${y}-${String(m+1).padStart(2,'0')}`, s=services(key), e=expenses(key), p=payroll(key);
      const rev=totalCents(s), rec=s.filter(x=>x.status==='received').reduce((a,x)=>a+centsFromEntry(x),0), pend=s.filter(x=>x.status==='pending').reduce((a,x)=>a+centsFromEntry(x),0), ex=totalCents(e), py=totalCents(p);
      yearRev+=rev;yearReceived+=rec;yearPending+=pend;yearExp+=ex;yearPay+=py;yearServices+=s.length;
      return {m,name,rev,rec,pend,ex,py,res:rev-ex-py,count:s.length};
    });
    $('#analysisCards').innerHTML=`<div class="analysis-card"><span>Faturamento no ano</span><b>${money(yearRev)}</b></div><div class="analysis-card"><span>Recebido no ano</span><b>${money(yearReceived)}</b></div><div class="analysis-card"><span>A receber</span><b>${money(yearPending)}</b></div><div class="analysis-card"><span>Despesas no ano</span><b>${money(yearExp)}</b></div><div class="analysis-card"><span>Funcionários no ano</span><b>${money(yearPay)}</b></div><div class="analysis-card"><span>Resultado no ano</span><b>${money(yearRev-yearExp-yearPay)}</b></div>`;
    $('#analysisSubtitle').textContent=`Janeiro a dezembro de ${y} · ${yearServices} serviços registrados`;
    const todayYear=new Date().getFullYear(),todayMonth=new Date().getMonth();
    $('#annualTable').innerHTML=`<table><thead><tr><th>Mês</th><th>Serviços</th><th>Faturamento</th><th>Recebido</th><th>A receber</th><th>Despesas</th><th>Funcionários</th><th>Resultado</th></tr></thead><tbody>${rows.map(r=>`<tr class="${y>todayYear || (y===todayYear && r.m>todayMonth)?'future-month':''}"><td>${r.name}</td><td>${r.count}</td><td>${money(r.rev)}</td><td>${money(r.rec)}</td><td>${money(r.pend)}</td><td>${money(r.ex)}</td><td>${money(r.py)}</td><td class="${r.res>=0?'positive':'negative'}">${money(r.res)}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderManage() {
    const clients=data.clients.slice().sort((a,b)=>a.name.localeCompare(b.name));
    const employees=data.employees.slice().sort((a,b)=>a.name.localeCompare(b.name));
    const vehicles=[];
    clients.forEach(c=>c.vehicles.forEach(v=>vehicles.push({client:c,vehicle:v})));
    $('#manageClients').innerHTML=clients.length?clients.map(c=>`<div class="manage-item"><div class="row-avatar">${initials(c.name)}</div><div class="manage-main"><b>${esc(c.name)}</b><small>${c.vehicles.length} veículos · ${c.active?'Ativo':'Inativo'}</small></div><div class="manage-actions"><button class="icon-action" data-open-client="${esc(c.id)}" title="Abrir" type="button">↗</button><button class="icon-action" data-edit-client="${esc(c.id)}" title="Editar" type="button">✎</button>${c.active?`<button class="icon-action danger-action" data-inactivate-client="${esc(c.id)}" title="Inativar" type="button">×</button>`:`<button class="icon-action" data-reactivate-client="${esc(c.id)}" title="Reativar" type="button">↻</button>`}</div></div>`).join(''):'<div class="empty">Nenhum cliente.</div>';
    $('#manageEmployees').innerHTML=employees.length?employees.map(e=>`<div class="manage-item"><div class="row-avatar">${initials(e.name)}</div><div class="manage-main"><b>${esc(e.name)}</b><small>${esc(e.role||'Funcionário')} · ${e.active?'Ativo':'Inativo'}</small></div><div class="manage-actions"><button class="icon-action" data-open-employee="${esc(e.id)}" title="Abrir" type="button">↗</button><button class="icon-action" data-edit-employee="${esc(e.id)}" title="Editar" type="button">✎</button>${e.active?`<button class="icon-action danger-action" data-inactivate-employee="${esc(e.id)}" title="Inativar" type="button">×</button>`:`<button class="icon-action" data-reactivate-employee="${esc(e.id)}" title="Reativar" type="button">↻</button>`}</div></div>`).join(''):'<div class="empty">Nenhum funcionário.</div>';
    $('#manageVehicles').innerHTML=vehicles.length?vehicles.map(({client:c,vehicle:v})=>`<div class="manage-item"><div class="row-avatar">🚗</div><div class="manage-main"><b>${esc(v.model)}${v.plate?' · '+esc(v.plate):''}</b><small>${esc(c.name)} · ${v.active?'Ativo':'Inativo'}</small></div><div class="manage-actions"><button class="icon-action" data-edit-vehicle="${esc(v.id)}" data-client-id="${esc(c.id)}" title="Editar" type="button">✎</button>${v.active?`<button class="icon-action danger-action" data-inactivate-vehicle="${esc(v.id)}" data-client-id="${esc(c.id)}" title="Inativar" type="button">×</button>`:`<button class="icon-action" data-reactivate-vehicle="${esc(v.id)}" data-client-id="${esc(c.id)}" title="Reativar" type="button">↻</button>`}</div></div>`).join(''):'<div class="empty">Nenhum veículo.</div>';
  }

  function renderSelect(name, options, value='', placeholder='Selecione') {
    return `<select name="${name}" ${name==='clientId'||name==='vehicleId'?'required':''}><option value="">${placeholder}</option>${options.map(o=>{const val=typeof o==='string'?o:o.value, label=typeof o==='string'?o:o.label;return `<option value="${esc(val)}" ${String(val)===String(value)?'selected':''}>${esc(label)}</option>`;}).join('')}</select>`;
  }

  function openEntry(type, edit=null, extra={}) {
    if (type === 'service') return openServiceForm(edit, extra.clientId || '', extra.vehicleId || '');
    const config = {
      expense:{eyebrow:'NOVA DESPESA',title:'Nova despesa'},
      employee:{eyebrow:'EQUIPE',title:'Novo funcionário'},
      commission:{eyebrow:'COMISSÃO',title:'Nova comissão'}
    }[type];
    if (!config) return;
    $('#modalEyebrow').textContent=edit?`EDITAR ${config.eyebrow}`:config.eyebrow;
    $('#modalTitle').textContent=edit?(type==='commission'?'Editar comissão':type==='employee'?'Editar funcionário':'Editar despesa'):config.title;
    let html='';
    if (type==='expense') {
      html=`<label>Descrição<input name="description" type="text" required maxlength="120" value="${esc(edit?.description||'')}" placeholder="Ex.: Shampoo automotivo"></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required value="${esc(edit?valueForInput(centsFromEntry(edit)):'')}" placeholder="0,00" inputmode="decimal"></label><label>Data<input name="date" type="date" required value="${esc(edit?.date||dateForSelectedPeriod())}"></label><label>Categoria${renderSelect('category',categories,edit?.category||'Outros','Selecione uma categoria')}</label><label>Forma de pagamento${renderSelect('paymentMethod',paymentMethods,edit?.paymentMethod||'PIX','Selecione')}</label><label>Fornecedor <span class="optional">(opcional)</span><input name="supplier" type="text" maxlength="120" value="${esc(edit?.supplier||'')}" placeholder="Ex.: Loja X"></label><label class="full-field">Observação <span class="optional">(opcional)</span><textarea name="notes" maxlength="300" placeholder="Detalhes úteis para a empresa">${esc(edit?.notes||'')}</textarea></label>`;
    } else if (type==='employee') {
      html=`<label>Nome do funcionário<input name="name" type="text" required maxlength="80" value="${esc(edit?.name||'')}" placeholder="Ex.: Carlos"></label><label>Cargo / função <span class="optional">(opcional)</span><input name="role" type="text" maxlength="80" value="${esc(edit?.role||'')}" placeholder="Ex.: Polidor"></label><label>Telefone <span class="optional">(opcional)</span><input name="phone" type="tel" maxlength="30" value="${esc(edit?.phone||'')}" placeholder="(48) 99999-9999"></label>`;
    } else {
      html=`<label>Motivo<input name="description" type="text" required maxlength="120" value="${esc(edit?.description||'Comissão')}" placeholder="Ex.: Comissão do polimento"></label><label>Valor da comissão<input name="amount" type="number" min="0.01" step="0.01" required value="${esc(edit?valueForInput(centsFromEntry(edit)):'')}" placeholder="0,00" inputmode="decimal"></label><label>Dia<input name="date" type="date" required value="${esc(edit?.date||dateForSelectedPeriod())}"></label>`;
    }
    $('#entryForm').innerHTML=`${html}<div class="submit-field"><button class="btn primary" type="submit">${edit?'Salvar alterações':'Salvar'}</button></div>`;
    $('#entryForm').dataset.type=type; $('#entryForm').dataset.id=edit?.id||''; $('#entryForm').dataset.employeeId=extra.employeeId||edit?.employeeId||'';
    $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false');
  }

  function openCustomerForm(edit=null, opts={}) {
    $('#modalEyebrow').textContent=edit?'EDITAR CLIENTE':'CLIENTE'; $('#modalTitle').textContent=edit?'Editar cliente':'Novo cliente';
    $('#entryForm').innerHTML=`<label>Nome do cliente<input name="name" type="text" required maxlength="100" value="${esc(edit?.name||'')}" placeholder="Ex.: João Silva"></label><label>Telefone <span class="optional">(opcional)</span><input name="phone" type="tel" maxlength="30" value="${esc(edit?.phone||'')}" placeholder="(48) 99999-9999"></label><label>E-mail <span class="optional">(opcional)</span><input name="email" type="email" maxlength="160" value="${esc(edit?.email||'')}" placeholder="cliente@email.com"></label><label>Observação <span class="optional">(opcional)</span><input name="notes" type="text" maxlength="200" value="${esc(edit?.notes||'')}" placeholder="Preferências ou informações úteis"></label><div class="submit-field"><button class="btn primary" type="submit">${edit?'Salvar alterações':'Cadastrar cliente'}</button></div>`;
    $('#entryForm').dataset.type='client'; $('#entryForm').dataset.id=edit?.id||''; $('#entryForm').dataset.returnKind=opts.returnKind||'';
    $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false');
  }

  function openVehicleForm(clientId, edit=null, opts={}) {
    const c=clientById(clientId); if(!c) return notify('Cliente não encontrado.');
    $('#modalEyebrow').textContent=edit?'EDITAR VEÍCULO':'VEÍCULO'; $('#modalTitle').textContent=edit?`Editar ${c.name}`:`Novo veículo — ${c.name}`;
    $('#entryForm').innerHTML=`<label>Carro / modelo<input name="model" type="text" required maxlength="100" value="${esc(edit?.model||'')}" placeholder="Ex.: Honda Civic"></label><label>Placa <span class="optional">(opcional)</span><input name="plate" type="text" maxlength="10" value="${esc(edit?.plate||'')}" placeholder="ABC-1D23" autocapitalize="characters"></label><label>Ano <span class="optional">(opcional)</span><input name="year" type="number" min="1950" max="2100" value="${esc(edit?.year||'')}" placeholder="2026"></label><div class="service-note full-field">O mesmo cliente pode ter vários veículos. Ao registrar um serviço, basta selecionar um deles.</div><div class="submit-field"><button class="btn primary" type="submit">${edit?'Salvar alterações':'Cadastrar veículo'}</button></div>`;
    $('#entryForm').dataset.type='vehicle'; $('#entryForm').dataset.id=edit?.id||''; $('#entryForm').dataset.clientId=clientId; $('#entryForm').dataset.returnKind=opts.returnKind||'';
    $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false');
  }

  function serviceClientOptions(selectedId='') {
    const active=data.clients.filter(c=>c.active!==false);
    const selected=data.clients.find(c=>c.id===selectedId);
    const pool=selected && !selected.active ? [selected,...active.filter(c=>c.id!==selected.id)] : active;
    return pool.sort((a,b)=>a.name.localeCompare(b.name));
  }
  function vehicleOptionsForService(client, selectedId='') {
    if (!client) return '<option value="">Selecione um cliente primeiro</option>';
    const active=client.vehicles.filter(v=>v.active!==false);
    const selected=client.vehicles.find(v=>v.id===selectedId);
    const pool=selected && !selected.active ? [selected,...active.filter(v=>v.id!==selected.id)] : active;
    if (!pool.length) return '<option value="">Nenhum veículo ativo</option>';
    return `<option value="">Selecione um veículo</option>${pool.map(v=>`<option value="${esc(v.id)}" ${v.id===selectedId?'selected':''}>${esc(v.model)}${v.plate?' · '+esc(v.plate):''}${v.active?'':' · inativo'}</option>`).join('')}`;
  }
  function openServiceForm(edit=null, initialClientId='', initialVehicleId='') {
    serviceDraft = edit ? {returnKind:'service', clientId:initialClientId || edit.clientId || '', vehicleId:initialVehicleId || edit.vehicleId || '', editId:edit.id} : null;
    const selectedClientId=edit?.clientId || initialClientId || serviceDraft?.clientId || '';
    const selectedVehicleId=edit?.vehicleId || initialVehicleId || serviceDraft?.vehicleId || '';
    const client=clientById(selectedClientId);
    const clients=serviceClientOptions(selectedClientId);
    $('#modalEyebrow').textContent=edit?'EDITAR SERVIÇO':'NOVA ENTRADA'; $('#modalTitle').textContent=edit?'Editar serviço':'Novo serviço';
    $('#entryForm').innerHTML=`<label>Cliente<select id="serviceClientSelect" name="clientId" required><option value="">Selecione um cliente</option>${clients.map(c=>`<option value="${esc(c.id)}" ${c.id===selectedClientId?'selected':''}>${esc(c.name)}${c.active?'':' · inativo'}</option>`).join('')}</select><button id="quickNewClient" class="inline-link" type="button">＋ Novo cliente</button></label><label>Veículo<select id="serviceVehicleSelect" name="vehicleId" required>${vehicleOptionsForService(client,selectedVehicleId)}</select><button id="quickNewVehicle" class="inline-link" type="button" ${client?'':'disabled'}>＋ Novo veículo</button></label><label>Valor<input name="amount" type="number" min="0.01" step="0.01" required value="${esc(edit?valueForInput(centsFromEntry(edit)):'')}" placeholder="0,00" inputmode="decimal"></label><label>Data<input name="date" type="date" required value="${esc(edit?.date||dateForSelectedPeriod())}"></label><label>Serviço realizado <span class="optional">(opcional)</span><input name="description" type="text" maxlength="140" value="${esc(edit?.description||'')}" placeholder="Ex.: Polimento + vitrificação"></label><label>Status do pagamento${renderSelect('status',[{value:'received',label:'Recebido'},{value:'pending',label:'Pendente'}],edit?.status||'received','Selecione')}</label><label>Forma de pagamento${renderSelect('paymentMethod',paymentMethods,edit?.paymentMethod||'PIX','Selecione')}</label><div class="service-note full-field">O cliente e o veículo ficam salvos no cadastro. Você pode ter vários veículos por cliente e escolher outro a cada serviço.</div><div class="submit-field"><button class="btn primary" type="submit">${edit?'Salvar alterações':'Salvar serviço'}</button></div>`;
    $('#entryForm').dataset.type='service'; $('#entryForm').dataset.id=edit?.id||''; $('#entryForm').dataset.employeeId='';
    $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false');

    $('#serviceClientSelect').addEventListener('change', e => {
      const c=clientById(e.target.value);
      $('#serviceVehicleSelect').innerHTML=vehicleOptionsForService(c,'');
      $('#quickNewVehicle').disabled=!c;
    });
    $('#quickNewClient').addEventListener('click',()=>{serviceDraft={returnKind:'service',clientId:$('#serviceClientSelect').value||'',vehicleId:'',editId:edit?.id||''}; closeEntry(true); openCustomerForm(null,{returnKind:'service'});});
    $('#quickNewVehicle').addEventListener('click',()=>{const cid=$('#serviceClientSelect').value;if(!cid) return;serviceDraft={returnKind:'service',clientId:cid,vehicleId:$('#serviceVehicleSelect').value||'',editId:edit?.id||''};closeEntry(true);openVehicleForm(cid,null,{returnKind:'service'});});
  }
  function closeEntry(keepServiceDraft=false){ if(!keepServiceDraft) serviceDraft=null; $('#modal').classList.add('hidden'); $('#modal').setAttribute('aria-hidden','true'); }

  function findDuplicateName(array, name, ignoreId='') { const target=normalizeText(name).toLocaleLowerCase('pt-BR'); return array.find(item=>item.id!==ignoreId&&item.active!==false&&normalizeText(item.name).toLocaleLowerCase('pt-BR')===target) || null; }
  function duplicatePlate(plate, ignoreId='') {
    if(!plate) return false;
    return data.clients.some(c=>c.vehicles?.some(v=>v.active!==false&&v.id!==ignoreId&&v.plate===plate));
  }

  async function saveEntry(event) {
    event.preventDefault();
    const form=event.currentTarget, type=form.dataset.type, id=form.dataset.id, fd=new FormData(form); const obj={}; fd.forEach((v,k)=>obj[k]=String(v));
    const ts=nowISO();

    if (type==='client') {
      const name=normalizeText(obj.name); if(name.length<2) return notify('Informe o nome do cliente.');
      const duplicateClient=findDuplicateName(data.clients,name,id);
      if(duplicateClient){ const ok=await confirmAction(`Já existe “${duplicateClient.name}” cadastrado${duplicateClient.phone ? ` com o telefone ${duplicateClient.phone}` : ''}. Mesmo assim, deseja criar outro cliente com este nome?`,'Cliente com nome parecido','Criar mesmo assim'); if(!ok) return; }
      let c=id?clientById(id):null;
      if(c){Object.assign(c,{name,phone:normalizeText(obj.phone),email:normalizeText(obj.email),notes:normalizeText(obj.notes),updatedAt:ts});}
      else data.clients.push({id:uid(),companyId:data.company.id,name,phone:normalizeText(obj.phone),email:normalizeText(obj.email),notes:normalizeText(obj.notes),active:true,deletedAt:null,vehicles:[],createdAt:ts,updatedAt:ts});
      saveData(); const created = !id ? data.clients[data.clients.length-1] : null; const draft=serviceDraft; closeEntry(Boolean(draft)); renderAll();
      if(draft && draft.editId !== undefined) { serviceDraft=null; openServiceForm(draft.editId?data.entries.find(e=>e.id===draft.editId):null, created?.id||c?.id||draft.clientId, draft.vehicleId||''); }
      else if(profileClientId) openClientProfile(profileClientId);
      notify(id?'Cliente atualizado.':'Cliente cadastrado.'); return;
    }

    if (type==='vehicle') {
      const c=clientById(form.dataset.clientId); if(!c) return notify('Cliente inválido.');
      const model=normalizeText(obj.model), plate=normalizePlate(obj.plate), year=String(obj.year||'').trim();
      if(model.length<2) return notify('Informe o carro/modelo.');
      if(plate && duplicatePlate(plate,id)) return notify('Essa placa já está cadastrada em outro veículo ativo.');
      if(year && (!/^\d{4}$/.test(year)||Number(year)<1950||Number(year)>2100)) return notify('Informe um ano de veículo válido.');
      const v=id?vehicleById(c,id):null;
      if(v) Object.assign(v,{model,plate,year,updatedAt:ts});
      else c.vehicles.push({id:uid(),companyId:data.company.id,model,plate,year,active:true,deletedAt:null,createdAt:ts,updatedAt:ts});
      c.updatedAt=ts; const draft=serviceDraft; saveData(); closeEntry(Boolean(draft)); renderAll();
      const createdVehicle=v||c.vehicles[c.vehicles.length-1];
      if(draft && draft.returnKind==='service') { serviceDraft=null; openServiceForm(draft.editId?data.entries.find(e=>e.id===draft.editId):null,c.id,createdVehicle.id); }
      else if(profileClientId) openClientProfile(profileClientId);
      notify(id?'Veículo atualizado.':'Veículo cadastrado.'); return;
    }

    if (type==='employee') {
      const name=normalizeText(obj.name), role=normalizeText(obj.role), phone=normalizeText(obj.phone);
      if(name.length<2) return notify('Informe o nome do funcionário.');
      const duplicateEmployee=findDuplicateName(data.employees,name,id);
      if(duplicateEmployee){ const ok=await confirmAction(`Já existe “${duplicateEmployee.name}” cadastrado${duplicateEmployee.phone ? ` com o telefone ${duplicateEmployee.phone}` : ''}. Mesmo assim, deseja criar outro funcionário com este nome?`,'Funcionário com nome parecido','Criar mesmo assim'); if(!ok) return; }
      const emp=id?employeeById(id):null;
      if(emp) Object.assign(emp,{name,role,phone,updatedAt:ts});
      else data.employees.push({id:uid(),companyId:data.company.id,name,role,phone,active:true,deletedAt:null,createdAt:ts,updatedAt:ts});
      saveData(); closeEntry(); renderAll(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); notify(id?'Funcionário atualizado.':'Funcionário criado.'); return;
    }

    const amountCents=amountToCents(obj.amount);
    if (type==='service') {
      if(!obj.clientId||!obj.vehicleId) return notify('Selecione um cliente e um veículo.');
      if(amountCents<=0) return notify('Informe um valor maior que zero.');
      if(!isValidDate(obj.date)) return notify('Informe uma data válida.');
      const c=clientById(obj.clientId), v=vehicleById(c,obj.vehicleId); if(!c||!v) return notify('Cliente ou veículo inválido.');
      if(!id && !c.active) return notify('Esse cliente está inativo. Reative o cadastro antes de registrar um novo serviço.');
      if(!id && !v.active) return notify('Esse veículo está inativo. Reative-o ou selecione outro veículo.');
      const entry={id:id||uid(),companyId:data.company.id,source:'manual',type:'service',date:obj.date,amountCents,description:normalizeText(obj.description),status:obj.status==='pending'?'pending':'received',paymentMethod:normalizeText(obj.paymentMethod)||'',category:'',supplier:'',notes:'',clientId:c.id,vehicleId:v.id,employeeId:'',clientNameSnapshot:c.name,vehicleModelSnapshot:v.model,plateSnapshot:v.plate,voidedAt:null,voidReason:'',createdAt:id?(data.entries.find(e=>e.id===id)?.createdAt||ts):ts,updatedAt:ts};
      if(entry.status==='received'&&!entry.paymentMethod) return notify('Selecione a forma de pagamento para um serviço recebido.');
      const idx=data.entries.findIndex(e=>e.id===id); if(idx>=0) data.entries[idx]=entry; else data.entries.push(entry);
      saveData(); closeEntry(); renderAll(); if(profileClientId) openClientProfile(profileClientId); notify(idx>=0?'Serviço atualizado.':'Serviço salvo.'); return;
    }

    if (type==='expense') {
      if(!normalizeText(obj.description)||amountCents<=0) return notify('Informe descrição e valor da despesa.');
      if(!isValidDate(obj.date)) return notify('Informe uma data válida.');
      const entry={id:id||uid(),companyId:data.company.id,source:'manual',type:'expense',date:obj.date,amountCents,description:normalizeText(obj.description),status:'received',paymentMethod:normalizeText(obj.paymentMethod)||'PIX',category:categories.includes(obj.category)?obj.category:'Outros',supplier:normalizeText(obj.supplier),notes:normalizeText(obj.notes),clientId:'',vehicleId:'',employeeId:'',clientNameSnapshot:'',vehicleModelSnapshot:'',plateSnapshot:'',voidedAt:null,voidReason:'',createdAt:id?(data.entries.find(e=>e.id===id)?.createdAt||ts):ts,updatedAt:ts};
      const idx=data.entries.findIndex(e=>e.id===id); if(idx>=0) data.entries[idx]=entry; else data.entries.push(entry); saveData(); closeEntry(); renderAll(); notify(idx>=0?'Despesa atualizada.':'Despesa salva.'); return;
    }

    if (type==='commission') {
      if(!form.dataset.employeeId) return notify('Funcionário inválido.');
      if(!normalizeText(obj.description)||amountCents<=0) return notify('Informe motivo e valor da comissão.');
      if(!isValidDate(obj.date)) return notify('Informe uma data válida.');
      const emp=employeeById(form.dataset.employeeId); if(!emp) return notify('Funcionário não encontrado.');
      if(!id && !emp.active) return notify('Funcionário inativo. Reative o cadastro antes de lançar uma nova comissão.');
      const entry={id:id||uid(),companyId:data.company.id,source:'manual',type:'payroll',date:obj.date,amountCents,description:normalizeText(obj.description),status:'received',paymentMethod:'',category:'',supplier:'',notes:'',clientId:'',vehicleId:'',employeeId:emp.id,clientNameSnapshot:'',vehicleModelSnapshot:'',plateSnapshot:'',voidedAt:null,voidReason:'',createdAt:id?(data.entries.find(e=>e.id===id)?.createdAt||ts):ts,updatedAt:ts};
      const idx=data.entries.findIndex(e=>e.id===id); if(idx>=0) data.entries[idx]=entry; else data.entries.push(entry); saveData(); closeEntry(); renderAll(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); notify(idx>=0?'Comissão atualizada.':'Comissão salva.'); return;
    }
  }

  async function markEntryReceived(id) {
    const entry=data.entries.find(e=>e.id===id);
    if(!entry || entry.type!=='service' || entry.voidedAt || entry.status==='received') return;
    const modal=$('#paymentModal');
    $('#paymentMethodQuick').value=entry.paymentMethod || 'PIX';
    modal.dataset.entryId=id;
    modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false');
  }

  function closePaymentModal() { $('#paymentModal').classList.add('hidden'); $('#paymentModal').setAttribute('aria-hidden','true'); $('#paymentModal').dataset.entryId=''; }

  function saveQuickPayment() {
    const id=$('#paymentModal').dataset.entryId, entry=data.entries.find(e=>e.id===id), method=$('#paymentMethodQuick').value;
    if(!entry || !method) return notify('Selecione a forma de pagamento.');
    entry.status='received'; entry.paymentMethod=method; entry.updatedAt=nowISO(); saveData(); closePaymentModal(); renderAll();
    if(profileClientId===entry.clientId) openClientProfile(profileClientId);
    notify('Serviço marcado como recebido.');
  }

  async function voidEntry(id) {
    const entry=data.entries.find(e=>e.id===id); if(!entry || entry.voidedAt) return;
    const ok=await confirmAction('O lançamento sairá dos totais e ficará preservado como histórico anulado. Você ainda poderá consultar o cadastro depois.','Anular lançamento','Anular');
    if(!ok) return;
    entry.voidedAt=nowISO(); entry.status='cancelled'; entry.voidReason='Anulado pelo usuário'; entry.updatedAt=nowISO(); saveData(); renderAll();
    if(profileClientId&&entry.clientId===profileClientId) openClientProfile(profileClientId);
    if(profileEmployeeId&&entry.employeeId===profileEmployeeId) openEmployeeProfile(profileEmployeeId);
    notify('Lançamento anulado.');
  }

  async function setClientActive(id, active) {
    const c=clientById(id); if(!c) return;
    const ok=await confirmAction(`${active?'Reativar':'Inativar'} o cliente “${c.name}”? ${active?'Ele poderá receber novos serviços novamente.':'Os serviços e veículos históricos serão preservados.'}`,`${active?'Reativar':'Inativar'} cliente`,active?'Reativar':'Inativar');
    if(!ok) return;
    c.active=active; c.deletedAt=active?null:nowISO(); c.updatedAt=nowISO(); saveData(); renderAll();
    if(profileClientId===id) openClientProfile(id); else closeProfile();
    notify(`Cliente ${active?'reativado':'inativado'}.`);
  }
  async function setEmployeeActive(id, active) {
    const e=employeeById(id); if(!e) return;
    const ok=await confirmAction(`${active?'Reativar':'Inativar'} o funcionário “${e.name}”? ${active?'Ele poderá receber novas comissões.':'O histórico de comissões será preservado.'}`,`${active?'Reativar':'Inativar'} funcionário`,active?'Reativar':'Inativar');
    if(!ok) return;
    e.active=active; e.deletedAt=active?null:nowISO(); e.updatedAt=nowISO(); saveData(); renderAll();
    if(profileEmployeeId===id) openEmployeeProfile(id); else closeProfile();
    notify(`Funcionário ${active?'reativado':'inativado'}.`);
  }
  async function setVehicleActive(clientId, vehicleId, active) {
    const c=clientById(clientId), v=vehicleById(c,vehicleId); if(!c||!v) return;
    const ok=await confirmAction(`${active?'Reativar':'Inativar'} o veículo “${v.model}${v.plate?' — '+v.plate:''}”? O histórico de serviços continuará preservado.`,`${active?'Reativar':'Inativar'} veículo`,active?'Reativar':'Inativar');
    if(!ok) return;
    v.active=active; v.deletedAt=active?null:nowISO(); v.updatedAt=nowISO(); saveData(); renderAll(); if(profileClientId===clientId) openClientProfile(clientId); notify(`Veículo ${active?'reativado':'inativado'}.`);
  }

  function openMonth() { renderMonthPicker(); $('#monthModal').classList.remove('hidden'); $('#monthModal').setAttribute('aria-hidden','false'); }
  function renderMonthPicker() {
    const y=selectedMonth.getFullYear(); $('#monthModalTitle').textContent=y;
    $('#monthGrid').innerHTML=months.map((m,i)=>{const key=`${y}-${String(i+1).padStart(2,'0')}`;const has=entriesFor(key).length>0;const now=new Date();const current=now.getFullYear()===y&&now.getMonth()===i;return `<button class="${i===selectedMonth.getMonth()?'active ':''}${has?'has-data ':''}${current?'current-month':''}" data-month="${i}" type="button">${m}</button>`;}).join('');
  }
  function changeMonth(delta) { selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+delta,1); renderAll(); if($('#monthModal')&&!$('#monthModal').classList.contains('hidden')) renderMonthPicker(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); if(profileClientId) openClientProfile(profileClientId); }
  function changeYear(delta) { selectedMonth=new Date(selectedMonth.getFullYear()+delta,selectedMonth.getMonth(),1); renderMonthPicker(); }

  function download(name, content, type) {
    const blob=new Blob([content],{type}), url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1200);
  }
  function exportJson() {
    const exportedAt=nowISO(); data.lastBackupAt=exportedAt; saveData(); const backup={format:'nexo-gestao-backup',exportedAt,appVersion:APP_VERSION,schemaVersion:DATA_SCHEMA_VERSION,company:data.company,ownerName:data.ownerName,ownerEmail:currentEmail,clients:data.clients,employees:data.employees,entries:data.entries};
    download(`nexo-gestao-backup-${currentEmail.replace(/[^a-z0-9]/gi,'-')}.json`,JSON.stringify(backup,null,2),'application/json');
    renderAll(); notify('Backup exportado.');
  }
  async function importJson(file) {
    if(!file) return;
    if(file.size>10*1024*1024) return notify('Backup muito grande.');
    const text=await file.text();
    try {
      const x=JSON.parse(text); if(!x||!Array.isArray(x.entries)||!Array.isArray(x.employees)||!Array.isArray(x.clients)) throw new Error();
      const ok=await confirmAction('Importar este backup substituirá os dados atuais desta conta. Faça um backup antes, se necessário.','Restaurar backup','Restaurar');
      if(!ok) return;
      const merged=migrateData({...x,ownerName:data.ownerName,ownerEmail:currentEmail});
      data=merged; data.lastBackupAt=nowISO(); saveData(); renderAll(); notify('Backup restaurado com sucesso.');
    } catch (_) { notify('Arquivo de backup inválido ou incompatível.'); }
  }
  function csvCell(value) { return `"${String(value??'').replaceAll('"','""')}"`; }
  function exportCsv() {
    const year=currentYear(), rows=[['Tipo','Data','Cliente','Carro','Placa','Descrição/Motivo','Status','Categoria','Pagamento','Fornecedor','Funcionário','Valor (R$)']];
    data.entries.filter(e=>!e.voidedAt && String(e.date).startsWith(String(year))).sort((a,b)=>a.date.localeCompare(b.date)).forEach(e=>{const emp=e.type==='payroll'?employeeById(e.employeeId):null;rows.push([e.type,e.date,e.type==='service'?serviceName(e):'',e.vehicleModelSnapshot||'',e.plateSnapshot||'',e.description||'',e.status||'',e.category||'',e.paymentMethod||'',e.supplier||'',emp?.name||'',(centsFromEntry(e)/100).toFixed(2).replace('.',',')]);});
    download(`nexo-gestao-${year}.csv`,rows.map(r=>r.map(csvCell).join(';')).join('\n'),'text/csv;charset=utf-8'); notify(`CSV de ${year} exportado.`);
  }

  async function saveCompanySettings() {
    const name=normalizeText($('#companyName').value), short=normalizeText($('#companyShort').value), ownerName=normalizeText($('#accountName').value);
    if(name.length<2) return notify('Informe o nome da empresa.');
    if(short.length<1) return notify('Informe o nome curto da empresa.');
    if(ownerName.length<2) return notify('Informe seu nome.');
    data.company.name=name; data.company.short=short; data.ownerName=ownerName;
    if(accounts[currentEmail]) { accounts[currentEmail].name=ownerName; accounts[currentEmail].updatedAt=nowISO(); saveAccounts(); }
    saveData(); renderAll(); notify('Configurações salvas.');
  }

  function handleDelegatedClick(event) {
    const t=event.target.closest('button'); if(!t) return;
    if(t.dataset.view) { go(t.dataset.view); return; }
    if(t.dataset.editEntry) { const e=data.entries.find(x=>x.id===t.dataset.editEntry); if(!e||e.voidedAt) return; openEntry(e.type==='payroll'?'commission':e.type,e,{employeeId:e.employeeId}); return; }
    if(t.dataset.markReceived) { markEntryReceived(t.dataset.markReceived); return; }
    if(t.dataset.voidEntry) { voidEntry(t.dataset.voidEntry); return; }
    if(t.dataset.openEmployee) { openEmployeeProfile(t.dataset.openEmployee); return; }
    if(t.dataset.editEmployee) { const e=employeeById(t.dataset.editEmployee); if(e) openEntry('employee',e); return; }
    if(t.dataset.inactivateEmployee) { setEmployeeActive(t.dataset.inactivateEmployee,false); return; }
    if(t.dataset.reactivateEmployee) { setEmployeeActive(t.dataset.reactivateEmployee,true); return; }
    if(t.dataset.addCommission) { openEntry('commission',null,{employeeId:t.dataset.addCommission}); return; }
    if(t.dataset.openClient) { openClientProfile(t.dataset.openClient); return; }
    if(t.dataset.editClient) { const c=clientById(t.dataset.editClient); if(c) openCustomerForm(c); return; }
    if(t.dataset.inactivateClient) { setClientActive(t.dataset.inactivateClient,false); return; }
    if(t.dataset.reactivateClient) { setClientActive(t.dataset.reactivateClient,true); return; }
    if(t.dataset.addClientService) { openServiceForm(null,t.dataset.addClientService,''); return; }
    if(t.dataset.addVehicle) { openVehicleForm(t.dataset.addVehicle); return; }
    if(t.dataset.editVehicle) { const c=clientById(t.dataset.clientId),v=vehicleById(c,t.dataset.editVehicle); if(c&&v) openVehicleForm(c.id,v); return; }
    if(t.dataset.inactivateVehicle) { setVehicleActive(t.dataset.clientId,t.dataset.inactivateVehicle,false); return; }
    if(t.dataset.reactivateVehicle) { setVehicleActive(t.dataset.clientId,t.dataset.reactivateVehicle,true); return; }
  }

  // Static event wiring
  $('#loginForm').addEventListener('submit',handleAuth);
  $('#toggleAuth').addEventListener('click',()=>{setAuthMode(authMode==='login'?'register':'login'); $('#loginName').value=''; $('#companyNameRegister').value=''; $('#loginEmail').focus();});
  $('#logoutBtn').addEventListener('click',async()=>{const ok=await confirmAction('Sair desta conta neste navegador?','Sair','Sair');if(!ok)return;closeEntry();closeProfile();closePaymentModal();StorageRepository.remove(SESSION_KEY);ensureSession();setAuthMode('login');notify('Você saiu da conta.');});
  $('#headerAdd').addEventListener('click',()=>openEntry('service'));
    $$('[data-add-type]').forEach(b=>b.addEventListener('click',()=>openEntry(b.dataset.addType)));
  $('#newEmployeeBtn').addEventListener('click',()=>openEntry('employee'));
  $('#newClientBtn').addEventListener('click',()=>openCustomerForm());
  $('#manageNewClient').addEventListener('click',()=>openCustomerForm());
  $('#manageNewEmployee').addEventListener('click',()=>openEntry('employee'));
  $('#monthPrev').addEventListener('click',()=>changeMonth(-1)); $('#monthNext').addEventListener('click',()=>changeMonth(1)); $('#monthLabel').addEventListener('click',openMonth);
  $('#yearPrev').addEventListener('click',()=>changeYear(-1)); $('#yearNext').addEventListener('click',()=>changeYear(1));
  $('#monthModal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop,[data-close-month]')){e.currentTarget.classList.add('hidden');e.currentTarget.setAttribute('aria-hidden','true');} if(e.target.matches('[data-month]')){selectedMonth=new Date(selectedMonth.getFullYear(),Number(e.target.dataset.month),1);e.currentTarget.classList.add('hidden');e.currentTarget.setAttribute('aria-hidden','true');renderAll();}});
  $('#closeModal').addEventListener('click',closeEntry); $('#modal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop'))closeEntry();}); $('#entryForm').addEventListener('submit',saveEntry);
  $('#profileModal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop,[data-close-profile]'))closeProfile();});
  $('#confirmModal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop,#confirmCancel'))finishConfirm(false);if(e.target.matches('#confirmOk'))finishConfirm(true);});
  $('#confirmOk').addEventListener('keydown',e=>{if(e.key==='Escape')finishConfirm(false);});
  $('#paymentModal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop,[data-close-payment]')) closePaymentModal();});
  $('#paymentCancel').addEventListener('click',closePaymentModal);
  $('#paymentSave').addEventListener('click',saveQuickPayment);
  $('#dismissStorageNotice').addEventListener('click',()=>{localStorage.setItem(`nexo_install_notice_dismissed_${currentEmail}`,'1');renderStorageNotice();});
  $('#serviceSearch').addEventListener('input',renderServices); $('#clientSearch').addEventListener('input',renderClients); $('#expenseSearch').addEventListener('input',renderExpenses); $('#expenseCategoryFilter').addEventListener('change',renderExpenses);
  $$('[data-client-filter]').forEach(b=>b.addEventListener('click',()=>{clientFilter=b.dataset.clientFilter;renderClients();}));
  $$('[data-employee-filter]').forEach(b=>b.addEventListener('click',()=>{employeeFilter=b.dataset.employeeFilter;renderEmployees();}));
  $('#saveCompany').addEventListener('click',saveCompanySettings);
  $('#exportJson').addEventListener('click',exportJson);
  $('#backupReminderBtn').addEventListener('click',exportJson);
  $('#importJson').addEventListener('change',e=>{const f=e.target.files?.[0]; if(f) importJson(f); e.target.value='';});
  $('#exportCsvBtn').addEventListener('click',exportCsv);
  $('#clearData').addEventListener('click',async()=>{const ok=await confirmAction('Isso apagará todos os clientes, veículos, funcionários e lançamentos desta conta neste navegador. A conta de login continuará existindo.','Apagar dados','Apagar tudo');if(!ok)return;data=emptyData(accounts[currentEmail]);saveData();renderAll();notify('Dados da empresa apagados.');});
  $('#mobileMenu').addEventListener('click',()=>document.body.classList.add('mobile-menu-open'));
  $('#closeMobileMenu').addEventListener('click',()=>document.body.classList.remove('mobile-menu-open'));
  $('#mobileMenuOverlay').addEventListener('click',()=>document.body.classList.remove('mobile-menu-open'));
  document.addEventListener('click',handleDelegatedClick);
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){
      if(!$('#confirmModal').classList.contains('hidden')) finishConfirm(false);
      else if(!$('#paymentModal').classList.contains('hidden')) closePaymentModal();
      else if(!$('#modal').classList.contains('hidden')) closeEntry();
      else if(!$('#profileModal').classList.contains('hidden')) closeProfile();
      else if(!$('#monthModal').classList.contains('hidden')) {$('#monthModal').classList.add('hidden');}
      else document.body.classList.remove('mobile-menu-open');
    }
  });

  setAuthMode('login');
  ensureSession();
})();
