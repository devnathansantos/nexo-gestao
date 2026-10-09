(() => {
  'use strict';

  /*
   * NEXO Gestão — V4.2, incremental local-first edition.
   *
   * The UI reads/writes through this small storage layer so a future
   * Supabase/API repository can replace localStorage without rewriting views.
   * Data uses stable IDs, integer cents, timestamps, soft-deactivation and
   * schema migration. Years are not hard-coded: 2027, 2028, 2029, 2030 and
   * future years are handled by the same date/month functions.
   */
  const APP_VERSION = '4.2.1';
  const DATA_SCHEMA_VERSION = 6;
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
  const normalizeMultiline = value => String(value || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).join('\n').trim();
  const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
  const isSafeId = value => SAFE_ID_RE.test(String(value || ''));
  const isValidDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  };
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

  function saveAccounts() { return StorageRepository.write(ACCOUNTS_KEY, accounts); }

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
      company: { id: companyId, name: 'Minha empresa', short: 'Minha empresa', currency: 'BRL', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo', phone: '', whatsapp: '', address: '', logoDataUrl: '', quoteColor: '#1477f8', members: [] },
      ownerAvatarDataUrl: '',
      clients: [], employees: [], entries: [], servicePackages: [], quotes: [], monthlyGoals: {}
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
    if (typeof x.ownerAvatarDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(x.ownerAvatarDataUrl) || x.ownerAvatarDataUrl.length > 600000) x.ownerAvatarDataUrl = '';
    x.company.phone = normalizeText(x.company.phone); x.company.whatsapp = normalizeText(x.company.whatsapp); x.company.address = normalizeMultiline(x.company.address);
    if (!/^#[0-9a-f]{6}$/i.test(String(x.company.quoteColor || ''))) x.company.quoteColor = '#1477f8';
    if (typeof x.company.logoDataUrl !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/i.test(x.company.logoDataUrl) || x.company.logoDataUrl.length > 600000) x.company.logoDataUrl = '';
    x.servicePackages = Array.isArray(x.servicePackages) ? x.servicePackages : [];
    x.quotes = Array.isArray(x.quotes) ? x.quotes : [];
    x.monthlyGoals = x.monthlyGoals && typeof x.monthlyGoals === 'object' && !Array.isArray(x.monthlyGoals) ? x.monthlyGoals : {};
    if (!Array.isArray(x.company.members)) x.company.members = [];
    if (currentEmail && !x.company.members.some(m => m?.email === currentEmail)) x.company.members.push({id:uid(),email:currentEmail,role:'owner',status:'active',createdAt:x.createdAt||nowISO()});
    // Never replace a non-empty company name: it may be the owner's real business name.
    if (!normalizeText(x.company.name)) x.company.name = 'Minha empresa';
    if (!normalizeText(x.company.short)) x.company.short = x.company.name;
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
        amountCents: centsFromEntry(e), description: normalizeMultiline(e?.description || e?.reason), category: normalizeText(e?.category) || 'Outros',
        status: e?.status === 'pending' ? 'pending' : (e?.status === 'cancelled' ? 'cancelled' : 'received'), paymentMethod: normalizeText(e?.paymentMethod),
        supplier: normalizeText(e?.supplier), notes: normalizeMultiline(e?.notes), clientId: e?.clientId || '', vehicleId: e?.vehicleId || '', employeeId: e?.employeeId || '', quoteId: e?.quoteId || '',
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

    x.servicePackages = x.servicePackages.map(item => withTimestamps({
      id: stableId(item?.id), name: normalizeText(item?.name), description: normalizeMultiline(item?.description),
      services: Array.isArray(item?.services) ? item.services.map(line => normalizeText(line).replace(/^•\s*/, '')).filter(Boolean).slice(0,30) : [],
      notes: normalizeMultiline(item?.notes), active: item?.active !== false, deletedAt: item?.deletedAt || null
    }, created)).filter(item => item.name);
    x.quotes = x.quotes.map(q => withTimestamps({
      id: stableId(q?.id), number: normalizeText(q?.number) || `ORC-${String(q?.id || uid()).slice(0,8).toUpperCase()}`,
      clientId: String(q?.clientId || ''), vehicleId: String(q?.vehicleId || ''), clientNameSnapshot: normalizeText(q?.clientNameSnapshot),
      vehicleModelSnapshot: normalizeText(q?.vehicleModelSnapshot), plateSnapshot: normalizePlate(q?.plateSnapshot),
      items: Array.isArray(q?.items) ? q.items.map(it => ({id: stableId(it?.id), name: normalizeText(it?.name), description: normalizeMultiline(it?.description), quantity: Math.max(1, Math.min(999, Number(it?.quantity)||1)), amountCents: Math.max(0, Math.round(Number(it?.amountCents)||0))})).filter(it => it.name) : [],
      discountCents: Math.max(0, Math.round(Number(q?.discountCents)||0)), notes: normalizeMultiline(q?.notes), terms: normalizeMultiline(q?.terms), validityDays: Math.max(1, Math.min(365, Number(q?.validityDays)||7)),
      status: ['draft','sent','approved','refused'].includes(q?.status) ? q.status : 'draft', convertedServiceId: String(q?.convertedServiceId || ''), sentAt: q?.sentAt || '', approvedAt: q?.approvedAt || '',
      active: q?.active !== false
    }, created)).filter(q => q.items.length && q.number);
    Object.keys(x.monthlyGoals).forEach(key => { if (!/^\d{4}-\d{2}$/.test(key)) delete x.monthlyGoals[key]; else x.monthlyGoals[key] = Math.max(0, Math.round(Number(x.monthlyGoals[key]) || 0)); });

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

  // Snapshot allows the UI to restore the last in-memory state if localStorage is full/unavailable.
  function snapshotData() { return data ? JSON.parse(JSON.stringify(data)) : null; }
  function persistMutation(snapshot, shouldRender = true) {
    if (saveData()) return true;
    data = snapshot;
    if (shouldRender && data) renderAll();
    return false;
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
        if (!saveAccounts()) { delete accounts[email]; return; }
        const fresh = emptyData(accounts[email]);
        fresh.ownerName = ownerName;
        fresh.ownerEmail = email;
        fresh.company.name = companyName;
        fresh.company.short = companyName;
        if (!StorageRepository.write(keyForEmail(email), fresh)) {
          delete accounts[email];
          StorageRepository.remove(keyForEmail(email));
          saveAccounts();
          return;
        }
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
      dashboard:['VISÃO GERAL','Dashboard'], clients:['CADASTROS','Clientes'], services:['ENTRADAS','Serviços'], expenses:['SAÍDAS','Despesas'], employees:['EQUIPE','Funcionários'], analysis:['VISÃO ANUAL','Análises'], manage:['MANUTENÇÃO','Gerenciar'], quotes:['COMERCIAL','Orçamentos'], catalog:['SERVIÇOS','Catálogo'], retention:['RELACIONAMENTO','Retorno de clientes'], settings:['EMPRESA','Configurações']
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

  function renderCompanyAvatar() {
    const node = $('#companyAvatar');
    if (!node || !data) return;
    const owner = data.ownerName || currentEmail || 'Administrador';
    const photo = data.ownerAvatarDataUrl;
    if (photo && /^data:image\/(png|jpeg|webp);base64,/i.test(photo)) {
      node.innerHTML = `<img src="${esc(photo)}" alt="Foto de perfil de ${esc(owner)}"/>`;
      node.classList.add('has-image');
      node.setAttribute('aria-label', `Foto de perfil de ${owner}`);
      node.setAttribute('title', owner);
      const image = node.querySelector('img');
      image.addEventListener('error', () => {
        if (!node.contains(image)) return;
        node.textContent = initials(owner);
        node.classList.remove('has-image');
        node.setAttribute('aria-label', `Iniciais de ${owner}`);
        node.removeAttribute('title');
      }, { once: true });
    } else {
      node.textContent = initials(owner);
      node.classList.remove('has-image');
      node.setAttribute('aria-label', `Iniciais de ${owner}`);
      node.removeAttribute('title');
    }
  }

  function renderAll() {
    if (!data) return;
    $('#companyName').value = data.company.name;
    $('#companyShort').value = data.company.short;
    $('#sidebarCompany').textContent = 'Administrador';
    renderCompanyAvatar();
    $('#sidebarUser').textContent = data.ownerName || currentEmail;
    $('#accountName').value = data.ownerName || accounts[currentEmail]?.name || '';
    $('#accountSummary').textContent = `Conta: ${currentEmail}`;
    $('#dataSummary').textContent = `${data.clients.length} clientes · ${data.employees.length} funcionários · ${data.entries.filter(e=>!e.voidedAt).length} lançamentos registrados`;
    $('#schemaBadge').textContent = `Schema ${data.schemaVersion} · app ${APP_VERSION}`;
    $('#monthLabel').textContent = `${months[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`;
    $('#dashboardGreeting').textContent = `Olá, vamos aos números de ${months[selectedMonth.getMonth()].toLowerCase()}.`;
    updatePageTitle();
    populateCategoryFilter();
    renderDashboard(); renderClients(); renderServices(); renderExpenses(); renderEmployees(); renderAnalysis(); renderManage(); renderMobileNav(); renderStorageNotice(); updateBackupStatus(); renderBackupReminder(); renderQuotes(); renderCatalog(); renderRetention(); renderCompanySettingsFields(); renderGoalFields();
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

    let insight = '<strong>Visão do período:</strong> Comece registrando um serviço, uma despesa ou um pagamento a funcionário para construir seu painel.';
    if (ss.length) {
      if (pending > 0) insight = `<strong>${money(pending)}</strong> em serviços ainda pendentes de recebimento. Faturamento considera o serviço realizado; “Recebido” mostra o caixa já pago.`;
      else if (result < 0) insight = `<strong>Resultado negativo:</strong> as despesas e os pagamentos a funcionários superaram o faturamento deste período.`;
      else insight = `<strong>Resultado positivo:</strong> ${money(result)} após despesas e pagamentos a funcionários no período selecionado.`;
    }
    $('#dashboardInsight').innerHTML = insight;

    const recent = ss.slice().sort((a,b)=>b.date.localeCompare(a.date) || (b.createdAt||'').localeCompare(a.createdAt||'')).slice(0,6);
    $('#recentServices').innerHTML = recent.length ? recent.map(e=>`<div class="list-row"><div class="row-avatar">${initials(e.clientNameSnapshot)}</div><div class="row-main"><b>${esc(e.vehicleModelSnapshot || 'Veículo')}</b><small>${esc(e.clientNameSnapshot || 'Cliente')} · ${esc(e.plateSnapshot || 'Sem placa')} · ${fmtDate(e.date)}</small></div><div class="row-value">${money(centsFromEntry(e))}</div></div>`).join('') : '<div class="empty">Nenhum serviço neste mês.</div>';

    const totals={}; ps.forEach(p=>{const emp=employeeById(p.employeeId);const label=emp?.name || 'Funcionário inativo'; totals[label]=(totals[label]||0)+centsFromEntry(p);});
    const top=Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,4);
    $('#teamSummary').innerHTML = top.length ? top.map(([name,val])=>`<div class="team-row"><div class="row-avatar">${initials(name)}</div><div class="row-main"><b>${esc(name)}</b><small>Pagamentos a funcionários no mês</small></div><div class="row-value">${money(val)}</div></div>`).join('') : '<div class="empty">Nenhum pagamento a funcionário registrado.</div>';
    const quoteRows=(data.quotes||[]).filter(q=>{const d=q.createdAt?new Date(q.createdAt):null;return d&&!Number.isNaN(d.getTime())&&dateISO(d).slice(0,7)===currentKey();});
    const qSent=quoteRows.filter(q=>['sent','approved','refused'].includes(q.status)).length, qApproved=quoteRows.filter(q=>q.status==='approved').length, qRefused=quoteRows.filter(q=>q.status==='refused').length;
    $('#dashboardQuoteStats').innerHTML=`<div class="quote-mini-stat"><b>${quoteRows.length}</b><small>Propostas</small></div><div class="quote-mini-stat"><b>${qSent}</b><small>Enviados</small></div><div class="quote-mini-stat"><b>${qApproved}</b><small>Aprovados</small></div><div class="quote-mini-stat"><b>${qRefused}</b><small>Recusados</small></div>`;
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
      return `<article class="employee-card"><div class="emp-top"><div class="emp-avatar">${initials(emp.name)}</div><div class="row-main"><h3>${esc(emp.name)}</h3><small>${ps.length} ${ps.length===1?'pagamento':'pagamentos'} em ${months[selectedMonth.getMonth()].toLowerCase()}</small></div><span class="status ${emp.active?'active':'inactive'}">${emp.active?'Ativo':'Inativo'}</span></div><strong>${money(value)}</strong><small>Pagamentos a funcionários no período</small><div class="employee-actions"><button class="btn secondary small-btn" data-open-employee="${esc(emp.id)}" type="button">Abrir funcionário</button><button class="icon-action" data-edit-employee="${esc(emp.id)}" title="Editar funcionário" type="button">✎</button>${emp.active?`<button class="icon-action danger-action" data-inactivate-employee="${esc(emp.id)}" title="Inativar" type="button">×</button>`:`<button class="icon-action" data-reactivate-employee="${esc(emp.id)}" title="Reativar" type="button">↻</button>`}</div></article>`;
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
  function closeProfile(){profileEmployeeId='';profileClientId='';$('#profileModal').classList.add('hidden');$('#profileModal').setAttribute('aria-hidden','true');cropImage=null;cropDrag=null;}

  function renderAnalysis() {
    const y=currentYear();
    let yearRev=0,yearReceived=0,yearPending=0,yearExp=0,yearPay=0,yearServices=0;
    const rows=months.map((name,m)=>{
      const key=`${y}-${String(m+1).padStart(2,'0')}`, s=services(key), e=expenses(key), p=payroll(key);
      const rev=totalCents(s), rec=s.filter(x=>x.status==='received').reduce((a,x)=>a+centsFromEntry(x),0), pend=s.filter(x=>x.status==='pending').reduce((a,x)=>a+centsFromEntry(x),0), ex=totalCents(e), py=totalCents(p);
      yearRev+=rev;yearReceived+=rec;yearPending+=pend;yearExp+=ex;yearPay+=py;yearServices+=s.length;
      return {m,name,rev,rec,pend,ex,py,res:rev-ex-py,count:s.length};
    });
    const yearQuotes=(data.quotes||[]).filter(q=>{const d=q.createdAt?new Date(q.createdAt):null;return d&&!Number.isNaN(d.getTime())&&dateISO(d).startsWith(String(y));}); const sentQuotes=yearQuotes.filter(q=>['sent','approved','refused'].includes(q.status)).length; const approvedQuotes=yearQuotes.filter(q=>q.status==='approved').length; const refusedQuotes=yearQuotes.filter(q=>q.status==='refused').length; const conversion=sentQuotes?Math.round(approvedQuotes/sentQuotes*100):0;
    $('#analysisCards').innerHTML=`<div class="analysis-card"><span>Faturamento no ano</span><b>${money(yearRev)}</b></div><div class="analysis-card"><span>Recebido no ano</span><b>${money(yearReceived)}</b></div><div class="analysis-card"><span>A receber</span><b>${money(yearPending)}</b></div><div class="analysis-card"><span>Despesas no ano</span><b>${money(yearExp)}</b></div><div class="analysis-card"><span>Funcionários no ano</span><b>${money(yearPay)}</b></div><div class="analysis-card"><span>Resultado no ano</span><b>${money(yearRev-yearExp-yearPay)}</b></div><div class="analysis-card"><span>Orçamentos enviados</span><b>${sentQuotes}</b></div><div class="analysis-card"><span>Orçamentos aprovados</span><b>${approvedQuotes}</b></div><div class="analysis-card"><span>Orçamentos recusados</span><b>${refusedQuotes}</b></div><div class="analysis-card"><span>Conversão de enviados em aprovados</span><b>${conversion}%</b></div>`;
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
      const before=snapshotData();
      let c=id?clientById(id):null;
      if(c){Object.assign(c,{name,phone:normalizeText(obj.phone),email:normalizeText(obj.email),notes:normalizeText(obj.notes),updatedAt:ts});}
      else data.clients.push({id:uid(),companyId:data.company.id,name,phone:normalizeText(obj.phone),email:normalizeText(obj.email),notes:normalizeText(obj.notes),active:true,deletedAt:null,vehicles:[],createdAt:ts,updatedAt:ts});
      if (!persistMutation(before)) return; const created = !id ? data.clients[data.clients.length-1] : null; const draft=serviceDraft; closeEntry(Boolean(draft)); renderAll();
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
      const before=snapshotData();
      const v=id?vehicleById(c,id):null;
      if(v) Object.assign(v,{model,plate,year,updatedAt:ts});
      else c.vehicles.push({id:uid(),companyId:data.company.id,model,plate,year,active:true,deletedAt:null,createdAt:ts,updatedAt:ts});
      c.updatedAt=ts; const draft=serviceDraft; if(!persistMutation(before)) return; closeEntry(Boolean(draft)); renderAll();
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
      const before=snapshotData();
      const emp=id?employeeById(id):null;
      if(emp) Object.assign(emp,{name,role,phone,updatedAt:ts});
      else data.employees.push({id:uid(),companyId:data.company.id,name,role,phone,active:true,deletedAt:null,createdAt:ts,updatedAt:ts});
      if(!persistMutation(before)) return; closeEntry(); renderAll(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); notify(id?'Funcionário atualizado.':'Funcionário criado.'); return;
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
      const before=snapshotData();
      const idx=data.entries.findIndex(e=>e.id===id); if(idx>=0) data.entries[idx]=entry; else data.entries.push(entry);
      if(!persistMutation(before)) return; closeEntry(); renderAll(); if(profileClientId) openClientProfile(profileClientId); notify(idx>=0?'Serviço atualizado.':'Serviço salvo.'); return;
    }

    if (type==='expense') {
      if(!normalizeText(obj.description)||amountCents<=0) return notify('Informe descrição e valor da despesa.');
      if(!isValidDate(obj.date)) return notify('Informe uma data válida.');
      const entry={id:id||uid(),companyId:data.company.id,source:'manual',type:'expense',date:obj.date,amountCents,description:normalizeText(obj.description),status:'received',paymentMethod:normalizeText(obj.paymentMethod)||'PIX',category:categories.includes(obj.category)?obj.category:'Outros',supplier:normalizeText(obj.supplier),notes:normalizeMultiline(obj.notes),clientId:'',vehicleId:'',employeeId:'',clientNameSnapshot:'',vehicleModelSnapshot:'',plateSnapshot:'',voidedAt:null,voidReason:'',createdAt:id?(data.entries.find(e=>e.id===id)?.createdAt||ts):ts,updatedAt:ts};
      const before=snapshotData(); const idx=data.entries.findIndex(e=>e.id===id); if(idx>=0) data.entries[idx]=entry; else data.entries.push(entry); if(!persistMutation(before)) return; closeEntry(); renderAll(); notify(idx>=0?'Despesa atualizada.':'Despesa salva.'); return;
    }

    if (type==='commission') {
      if(!form.dataset.employeeId) return notify('Funcionário inválido.');
      if(!normalizeText(obj.description)||amountCents<=0) return notify('Informe motivo e valor da comissão.');
      if(!isValidDate(obj.date)) return notify('Informe uma data válida.');
      const emp=employeeById(form.dataset.employeeId); if(!emp) return notify('Funcionário não encontrado.');
      if(!id && !emp.active) return notify('Funcionário inativo. Reative o cadastro antes de lançar uma nova comissão.');
      const entry={id:id||uid(),companyId:data.company.id,source:'manual',type:'payroll',date:obj.date,amountCents,description:normalizeText(obj.description),status:'received',paymentMethod:'',category:'',supplier:'',notes:'',clientId:'',vehicleId:'',employeeId:emp.id,clientNameSnapshot:'',vehicleModelSnapshot:'',plateSnapshot:'',voidedAt:null,voidReason:'',createdAt:id?(data.entries.find(e=>e.id===id)?.createdAt||ts):ts,updatedAt:ts};
      const before=snapshotData(); const idx=data.entries.findIndex(e=>e.id===id); if(idx>=0) data.entries[idx]=entry; else data.entries.push(entry); if(!persistMutation(before)) return; closeEntry(); renderAll(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); notify(idx>=0?'Comissão atualizada.':'Comissão salva.'); return;
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
    const before=snapshotData(); entry.status='received'; entry.paymentMethod=method; entry.updatedAt=nowISO(); if(!persistMutation(before)) return; closePaymentModal(); renderAll();
    if(profileClientId===entry.clientId) openClientProfile(profileClientId);
    notify('Serviço marcado como recebido.');
  }

  async function voidEntry(id) {
    const entry=data.entries.find(e=>e.id===id); if(!entry || entry.voidedAt) return;
    const ok=await confirmAction('O lançamento sairá dos totais e ficará preservado como histórico anulado. Você ainda poderá consultar o cadastro depois.','Anular lançamento','Anular');
    if(!ok) return;
    const before=snapshotData(); entry.voidedAt=nowISO(); entry.status='cancelled'; entry.voidReason='Anulado pelo usuário'; entry.updatedAt=nowISO(); if(!persistMutation(before)) return; renderAll();
    if(profileClientId&&entry.clientId===profileClientId) openClientProfile(profileClientId);
    if(profileEmployeeId&&entry.employeeId===profileEmployeeId) openEmployeeProfile(profileEmployeeId);
    notify('Lançamento anulado.');
  }

  async function setClientActive(id, active) {
    const c=clientById(id); if(!c) return;
    const ok=await confirmAction(`${active?'Reativar':'Inativar'} o cliente “${c.name}”? ${active?'Ele poderá receber novos serviços novamente.':'Os serviços e veículos históricos serão preservados.'}`,`${active?'Reativar':'Inativar'} cliente`,active?'Reativar':'Inativar');
    if(!ok) return;
    const before=snapshotData(); c.active=active; c.deletedAt=active?null:nowISO(); c.updatedAt=nowISO(); if(!persistMutation(before)) return; renderAll();
    if(profileClientId===id) openClientProfile(id); else closeProfile();
    notify(`Cliente ${active?'reativado':'inativado'}.`);
  }
  async function setEmployeeActive(id, active) {
    const e=employeeById(id); if(!e) return;
    const ok=await confirmAction(`${active?'Reativar':'Inativar'} o funcionário “${e.name}”? ${active?'Ele poderá receber novas comissões.':'O histórico de comissões será preservado.'}`,`${active?'Reativar':'Inativar'} funcionário`,active?'Reativar':'Inativar');
    if(!ok) return;
    const before=snapshotData(); e.active=active; e.deletedAt=active?null:nowISO(); e.updatedAt=nowISO(); if(!persistMutation(before)) return; renderAll();
    if(profileEmployeeId===id) openEmployeeProfile(id); else closeProfile();
    notify(`Funcionário ${active?'reativado':'inativado'}.`);
  }
  async function setVehicleActive(clientId, vehicleId, active) {
    const c=clientById(clientId), v=vehicleById(c,vehicleId); if(!c||!v) return;
    const ok=await confirmAction(`${active?'Reativar':'Inativar'} o veículo “${v.model}${v.plate?' — '+v.plate:''}”? O histórico de serviços continuará preservado.`,`${active?'Reativar':'Inativar'} veículo`,active?'Reativar':'Inativar');
    if(!ok) return;
    const before=snapshotData(); v.active=active; v.deletedAt=active?null:nowISO(); v.updatedAt=nowISO(); if(!persistMutation(before)) return; renderAll(); if(profileClientId===clientId) openClientProfile(clientId); notify(`Veículo ${active?'reativado':'inativado'}.`);
  }

  function openMonth() { renderMonthPicker(); $('#monthModal').classList.remove('hidden'); $('#monthModal').setAttribute('aria-hidden','false'); }
  function renderMonthPicker() {
    const y=selectedMonth.getFullYear(); $('#monthModalTitle').textContent=y;
    $('#monthGrid').innerHTML=months.map((m,i)=>{const key=`${y}-${String(i+1).padStart(2,'0')}`;const has=entriesFor(key).length>0;const now=new Date();const current=now.getFullYear()===y&&now.getMonth()===i;return `<button class="${i===selectedMonth.getMonth()?'active ':''}${has?'has-data ':''}${current?'current-month':''}" data-month="${i}" type="button">${m}</button>`;}).join('');
  }
  function changeMonth(delta) { selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+delta,1); renderAll(); if($('#monthModal')&&!$('#monthModal').classList.contains('hidden')) renderMonthPicker(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); if(profileClientId) openClientProfile(profileClientId); }
  function changeYear(delta) { selectedMonth=new Date(selectedMonth.getFullYear()+delta,selectedMonth.getMonth(),1); renderMonthPicker(); }

  function download(name, content, type) {
    let url = '';
    try {
      const blob = new Blob([content], {type});
      url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 30000);
      return true;
    } catch (error) {
      if (url) { try { URL.revokeObjectURL(url); } catch (_) {} }
      console.error('Falha ao iniciar download', error); return false;
    }
  }
  async function exportJson() {
    if (!data) return notify('Entre na sua conta antes de exportar.');
    try {
      const exportedAt = nowISO();
      const backup = {format:'nexo-gestao-backup', exportedAt, appVersion:APP_VERSION, schemaVersion:DATA_SCHEMA_VERSION,
        company:data.company, ownerName:data.ownerName, ownerAvatarDataUrl:data.ownerAvatarDataUrl || '', ownerEmail:currentEmail, clients:data.clients, employees:data.employees,
        entries:data.entries, servicePackages:data.servicePackages, quotes:data.quotes, monthlyGoals:data.monthlyGoals, lastBackupAt:exportedAt};
      const ok = download(`nexo-gestao-backup-${dateISO().replaceAll('-','')}.json`, JSON.stringify(backup,null,2), 'application/json');
      if (!ok) return notify('Não foi possível iniciar a exportação. Tente novamente.');
      const confirmed = await confirmAction('O download foi iniciado. Confira Downloads/Arquivos e guarde o JSON em um local seguro, como iCloud Drive, Google Drive ou pendrive. Você conseguiu localizar e guardar o arquivo?', 'Confirmar backup', 'Sim, guardei');
      if (!confirmed) { notify('Lembrete mantido. Confirme o backup depois de guardar o arquivo.'); return; }
      const previousBackupAt = data.lastBackupAt; data.lastBackupAt = exportedAt;
      if (!saveData()) { data.lastBackupAt = previousBackupAt; notify('O arquivo foi gerado, mas não foi possível registrar a data do backup neste navegador.'); return; }
      renderAll(); notify('Backup confirmado. O lembrete volta em 7 dias.');
    } catch (error) { console.error(error); notify('Falha ao preparar o backup. Nenhum lembrete foi reiniciado.'); }
  }
  async function importJson(file) {
    if(!file) return;
    if(file.size>10*1024*1024) return notify('Backup muito grande.');
    try {
      const text=await file.text();
      const x=JSON.parse(text); if(!x || x.format !== 'nexo-gestao-backup' || !Array.isArray(x.entries) || !Array.isArray(x.employees) || !Array.isArray(x.clients) || !x.company || typeof x.company !== 'object') throw new Error();
      const ok=await confirmAction('Importar este backup substituirá os dados atuais desta conta. Faça um backup antes, se necessário.','Restaurar backup','Restaurar');
      if(!ok) return;
      const merged=migrateData({...x,ownerName:data.ownerName,ownerEmail:currentEmail,ownerAvatarDataUrl:typeof x.ownerAvatarDataUrl==='string'&&x.ownerAvatarDataUrl.startsWith('data:image/')?x.ownerAvatarDataUrl:(data.ownerAvatarDataUrl||''),lastBackupAt:data.lastBackupAt||''});
      const savedBefore = data; data=merged; if (!saveData()) { data=savedBefore; return notify('Não foi possível salvar a restauração. Os dados anteriores foram mantidos na memória.'); } renderAll(); notify('Backup restaurado. O lembrete de backup não foi reiniciado; faça uma nova exportação após conferir os dados.');
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
    const before=snapshotData();
    data.company.name=name; data.company.short=short; data.company.phone=normalizeText($('#companyPhone').value); data.company.whatsapp=normalizeText($('#companyWhatsapp').value); data.company.address=normalizeMultiline($('#companyAddress').value); data.company.quoteColor=$('#quoteColor')?.value && /^#[0-9a-f]{6}$/i.test($('#quoteColor').value) ? $('#quoteColor').value : '#1477f8'; data.ownerName=ownerName;
    if (!persistMutation(before)) return;
    if(accounts[currentEmail]) {
      const previousAccountName=accounts[currentEmail].name;
      accounts[currentEmail].name=ownerName; accounts[currentEmail].updatedAt=nowISO();
      if(!saveAccounts()) {
        accounts[currentEmail].name=previousAccountName;
        notify('Os dados da empresa foram salvos, mas o nome da conta não pôde ser atualizado. Verifique o armazenamento do navegador.');
        renderAll(); return;
      }
    }
    renderAll(); notify('Configurações salvas.');
  }

  // V4 modules: local-first catalog, quotes, customer return and monthly goals.
  const quoteStatusLabel = status => ({draft:'Rascunho',sent:'Enviado',approved:'Aprovado',refused:'Recusado'}[status] || 'Rascunho');
  const quoteTotal = q => Math.max(0, (q.items || []).reduce((sum, item) => sum + Math.max(0, Number(item.amountCents)||0) * Math.max(1, Number(item.quantity)||1), 0) - Math.max(0, Number(q.discountCents)||0));
  const quoteById = id => data?.quotes?.find(q => q.id === id);
  const packageById = id => data?.servicePackages?.find(q => q.id === id);
  function renderCompanySettingsFields() {
    if (!data || !$('#companyPhone')) return;
    $('#companyPhone').value = data.company.phone || ''; $('#companyWhatsapp').value = data.company.whatsapp || ''; $('#companyAddress').value = data.company.address || '';
    if ($('#quoteColor')) $('#quoteColor').value = /^#[0-9a-f]{6}$/i.test(data.company.quoteColor || '') ? data.company.quoteColor : '#1477f8';
    const img = $('#companyLogoPreview'); if (img) { img.src = data.company.logoDataUrl || ''; img.classList.toggle('hidden', !data.company.logoDataUrl); }
    const ownerImg = $('#ownerPhotoPreview'); if (ownerImg) { ownerImg.src = data.ownerAvatarDataUrl || ''; ownerImg.classList.toggle('hidden', !data.ownerAvatarDataUrl); }
  }
  function renderGoalFields() {
    if (!data || !$('#monthlyGoalInput')) return;
    const key = currentKey(), target = Number(data.monthlyGoals?.[key] || 0), actual = totalCents(services(key));
    $('#monthlyGoalInput').value = target ? (target/100).toFixed(2) : '';
    const pct = target ? Math.min(100, Math.round(actual/target*100)) : 0;
    $('#goalProgressLabel').textContent = target ? `${Math.round(actual/target*100)}%` : 'Sem meta';
    $('#goalProgressBar').style.width = `${pct}%`;
    $('#goalProgressText').textContent = target ? `${money(actual)} de ${money(target)} · faltam ${money(Math.max(0,target-actual))}.` : 'Defina uma meta para acompanhar o faturamento do mês.';
  }
  function renderCatalog() {
    const node = $('#packageList'); if (!node || !data) return;
    const items = [...(data.servicePackages||[])].sort((a,b)=>Number(b.active)-Number(a.active)||a.name.localeCompare(b.name));
    node.innerHTML = items.length ? items.map(item=>`<article class="package-card panel ${item.active?'':'is-inactive'}"><div class="package-card-head"><span class="package-symbol">☷</span><span class="status ${item.active?'active':'inactive'}">${item.active?'Ativo':'Inativo'}</span></div><h3>${esc(item.name)}</h3><p>${esc(item.description||'Sem descrição')}</p>${item.services.length?`<ul>${item.services.map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`:''}${item.notes?`<small class="muted">${esc(item.notes)}</small>`:''}<div class="package-actions"><button class="btn secondary" data-edit-package="${esc(item.id)}" type="button">Editar</button>${item.active?`<button class="btn ghost" data-package-active="${esc(item.id)}" data-active="false" type="button">Inativar</button>`:`<button class="btn ghost" data-package-active="${esc(item.id)}" data-active="true" type="button">Reativar</button>`}</div></article>`).join('') : '<div class="empty panel">Nenhum pacote cadastrado. Crie modelos para agilizar seus orçamentos.</div>';
  }
  function openPackageForm(id='') {
    const item = id ? packageById(id) : null; if (id && !item) return;
    const card = $('#profileModalCard');
    card.innerHTML = `<button class="modal-close" data-close-profile type="button" aria-label="Fechar">×</button><span class="eyebrow">CATÁLOGO</span><h2>${item?'Editar pacote':'Novo pacote'}</h2><form id="packageForm" class="form-grid"><label class="full-field">Nome do pacote<input name="name" required maxlength="100" value="${esc(item?.name||'')}"/></label><label class="full-field">Descrição<textarea name="description" maxlength="500" rows="3">${esc(item?.description||'')}</textarea></label><label class="full-field">Serviços incluídos <small>(um por linha)</small><textarea name="services" maxlength="1500" rows="5">${esc((item?.services||[]).join('\n'))}</textarea></label><label class="full-field">Observações<textarea name="notes" maxlength="500" rows="2">${esc(item?.notes||'')}</textarea></label><div class="submit-field"><button class="btn secondary" data-close-profile type="button">Cancelar</button><button class="btn primary" type="submit">Salvar pacote</button></div></form>`;
    $('#profileModal').classList.remove('hidden'); $('#profileModal').setAttribute('aria-hidden','false');
    $('#packageForm').addEventListener('submit', e=>{e.preventDefault();const fd=new FormData(e.currentTarget), name=normalizeText(fd.get('name'));if(name.length<2)return notify('Informe o nome do pacote.');const duplicate=data.servicePackages.find(x=>x.id!==id&&x.active&&x.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'));if(duplicate&&!confirm('Já existe um pacote ativo com esse nome. Deseja salvar mesmo assim?'))return;const ts=nowISO();const next={id:item?.id||uid(),name,description:normalizeMultiline(fd.get('description')),services:String(fd.get('services')||'').split(/\r?\n/).map(line=>normalizeText(line).replace(/^•\s*/, '')).filter(Boolean).slice(0,30),notes:normalizeMultiline(fd.get('notes')),active:item?.active!==false,createdAt:item?.createdAt||ts,updatedAt:ts};const before=snapshotData();if(item)Object.assign(item,next);else data.servicePackages.push(next);if(!persistMutation(before))return;closeProfile();renderAll();notify('Pacote salvo.');});
  }
  function renderQuotes() {
    const node=$('#quotesList');if(!node||!data)return;
    const query=normalizeText($('#quoteSearch')?.value||'').toLocaleLowerCase('pt-BR'), status=$('#quoteStatusFilter')?.value||'all';
    const items=[...(data.quotes||[])].filter(q=>(status==='all'||q.status===status)&&(!query||`${q.number} ${q.clientNameSnapshot} ${q.vehicleModelSnapshot} ${q.plateSnapshot}`.toLocaleLowerCase('pt-BR').includes(query))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    node.innerHTML=items.length?items.map(q=>`<article class="quote-card panel"><div class="quote-card-main"><div class="quote-number">${esc(q.number)}</div><h3>${esc(q.clientNameSnapshot||clientById(q.clientId)?.name||'Cliente não encontrado')}</h3><p>${esc(q.vehicleModelSnapshot||'Veículo não informado')}${q.plateSnapshot?' · '+esc(q.plateSnapshot):''}</p><span class="status ${q.status==='approved'?'active':q.status==='refused'?'inactive':'pending'}">${quoteStatusLabel(q.status)}</span></div><div class="quote-card-total"><small>Total</small><strong>${money(quoteTotal(q))}</strong><small>${fmtDate(q.createdAt?.slice(0,10)||'')}</small></div><div class="quote-actions"><button class="btn secondary" data-quote-print="${esc(q.id)}" type="button">PDF / Imprimir</button><button class="btn secondary" data-quote-whatsapp="${esc(q.id)}" type="button">Compartilhar PDF</button>${q.convertedServiceId?'':`<button class="btn secondary" data-edit-quote="${esc(q.id)}" type="button">Editar</button>`}${q.status==='draft'?`<button class="btn ghost" data-quote-status="${esc(q.id)}" data-status="sent" type="button">Marcar enviado</button>`:''}${q.status==='sent'?`<button class="btn ghost" data-quote-status="${esc(q.id)}" data-status="approved" type="button">Aprovar</button><button class="btn ghost" data-quote-status="${esc(q.id)}" data-status="refused" type="button">Recusar</button>`:''}${q.status==='approved'&&!q.convertedServiceId?`<button class="btn primary" data-quote-convert="${esc(q.id)}" type="button">Converter em serviço</button>`:''}${q.convertedServiceId?'<span class="status active">Serviço criado</span>':''}</div></article>`).join(''):'<div class="empty panel">Nenhum orçamento encontrado. Crie um orçamento para começar.</div>';
  }
  function openQuoteForm(id='') {
    const q=id?quoteById(id):null;
    if(id&&!q)return;
    if(q?.convertedServiceId)return notify('Este orçamento já foi convertido em serviço e não pode mais ser editado.');

    const activeClients=data.clients.filter(c=>c.active!==false);
    const selectedClient=q?clientById(q.clientId):null;
    const clientsForForm=selectedClient&&!selectedClient.active
      ? [selectedClient,...activeClients.filter(c=>c.id!==selectedClient.id)]
      : activeClients;
    const chosen=q?.clientId||'';
    const clientOptions=`<option value="">Selecione um cliente</option>${clientsForForm.map(c=>`<option value="${esc(c.id)}" ${c.id===chosen?'selected':''}>${esc(c.name)}${c.active?'':' · inativo (histórico)'}</option>`).join('')}`;

    const buildVehicleOptions=(client,selectedVehicleId='')=>{
      if(!client)return '<option value="">Selecione um cliente primeiro</option>';
      const active=client.vehicles.filter(v=>v.active!==false);
      const selected=client.vehicles.find(v=>v.id===selectedVehicleId);
      const pool=selected&&!selected.active?[selected,...active.filter(v=>v.id!==selected.id)]:active;
      return `<option value="">Selecione um veículo</option>${pool.map(v=>`<option value="${esc(v.id)}" ${v.id===selectedVehicleId?'selected':''}>${esc(v.model)}${v.plate?' · '+esc(v.plate):''}${v.active?'':' · inativo (histórico)'}</option>`).join('')}`;
    };
    const initialItems=q?.items?.length?q.items:[];
    const itemMarkup=it=>`<div class="quote-line-editor" data-quote-line data-line-id="${esc(it.id||uid())}"><label>Pacote / serviço<input data-line-name required maxlength="120" value="${esc(it.name||'')}" placeholder="Nome do pacote ou serviço avulso"/></label><label>Serviços incluídos<textarea data-line-description maxlength="1000" rows="3" placeholder="Lista dos serviços incluídos">${esc(it.description||'')}</textarea></label><label>Qtd.<input data-line-quantity type="number" min="1" max="999" step="1" value="${Math.max(1,Number(it.quantity)||1)}" required/></label><label>Valor unitário (R$)<input data-line-value type="number" min="0" step="0.01" inputmode="decimal" value="${(Number(it.amountCents||0)/100).toFixed(2)}" required/></label><button class="icon-action danger-action" data-remove-quote-line type="button" aria-label="Remover item">×</button></div>`;

    const card=$('#profileModalCard');
    card.innerHTML=`<button class="modal-close" data-close-profile type="button" aria-label="Fechar">×</button><span class="eyebrow">ORÇAMENTO</span><h2>${q?'Editar orçamento':'Novo orçamento'}</h2><form id="quoteForm"><div class="form-grid"><label>Cliente<select name="clientId" id="quoteClient" required>${clientOptions}</select></label><label>Veículo<select name="vehicleId" id="quoteVehicle" required>${buildVehicleOptions(selectedClient,q?.vehicleId||'')}</select></label><label>Validade (dias)<input name="validityDays" type="number" min="1" max="365" value="${q?.validityDays||7}" required/></label><label>Desconto (R$)<input name="discount" type="number" min="0" step="0.01" inputmode="decimal" value="${(Number(q?.discountCents||0)/100).toFixed(2)}"/></label><div class="full-field quote-line-wrap"><div class="quote-line-heading"><b>Pacotes e serviços</b><button class="btn secondary" id="addQuoteLine" type="button">＋ Serviço avulso</button></div><div id="quoteLines">${initialItems.map(itemMarkup).join('')}</div><div class="quote-line-heading"><label>Adicionar pacote do catálogo<select id="quotePackageSelect"><option value="">Escolher pacote (opcional)</option>${data.servicePackages.filter(p=>p.active).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><button class="btn secondary" id="applyQuotePackage" type="button">Usar pacote</button></div></div><label class="full-field">Observações<textarea name="notes" rows="2" maxlength="1000">${esc(q?.notes||'')}</textarea></label><label class="full-field">Condições / validade<textarea name="terms" rows="2" maxlength="1000">${esc(q?.terms||'Validade conforme informado acima. Valores sujeitos à avaliação do veículo.')}</textarea></label><div class="full-field quote-total-preview">Total previsto: <strong id="quoteTotalPreview">R$ 0,00</strong></div><div class="submit-field"><button class="btn secondary" data-close-profile type="button">Cancelar</button><button class="btn primary" type="submit">Salvar orçamento</button></div></div></form>`;
    $('#profileModal').classList.remove('hidden');$('#profileModal').setAttribute('aria-hidden','false');

    const form=$('#quoteForm'),lines=$('#quoteLines');
    const refreshVehicles=(clientId,vehicleId='')=>{
      const client=clientById(clientId);
      $('#quoteVehicle').innerHTML=buildVehicleOptions(client,vehicleId);
    };
    const addLine=(it={})=>{
      const temp=document.createElement('div');
      temp.innerHTML=itemMarkup({id:it.id||uid(),name:it.name||'',description:it.description||'',quantity:it.quantity||1,amountCents:it.amountCents||0});
      lines.appendChild(temp.firstElementChild);
    };
    const totalPreview=()=>{
      const sum=[...lines.querySelectorAll('[data-quote-line]')].reduce((acc,row)=>acc+Math.max(0,amountToCents(row.querySelector('[data-line-value]').value))*Math.max(1,Number(row.querySelector('[data-line-quantity]').value)||1),0);
      const discount=Math.max(0,amountToCents(form.elements.discount.value));
      $('#quoteTotalPreview').textContent=money(Math.max(0,sum-discount));
    };
    $('#quoteClient').addEventListener('change',()=>refreshVehicles($('#quoteClient').value,''));
    $('#addQuoteLine').addEventListener('click',()=>{addLine();totalPreview();});
    lines.addEventListener('input',totalPreview);
    form.elements.discount.addEventListener('input',totalPreview);
    lines.addEventListener('click',e=>{
      const button=e.target.closest('[data-remove-quote-line]');
      if(!button)return;
      if(lines.querySelectorAll('[data-quote-line]').length<=1)return notify('O orçamento precisa ter pelo menos um item.');
      button.closest('[data-quote-line]').remove();totalPreview();
    });
    $('#applyQuotePackage').addEventListener('click',()=>{
      const pkg=packageById($('#quotePackageSelect').value);
      if(!pkg||!pkg.active)return notify('Escolha um pacote ativo do catálogo.');
      const included=(pkg.services||[]).map(item=>`• ${item}`).join('\n');
      const description=[pkg.description,included,pkg.notes?`Observações: ${pkg.notes}`:''].filter(Boolean).join('\n');
      const rows=[...lines.querySelectorAll('[data-quote-line]')];
      const blank=rows.length===1&&!rows[0].querySelector('[data-line-name]').value.trim()&&!rows[0].querySelector('[data-line-description]').value.trim()&&amountToCents(rows[0].querySelector('[data-line-value]').value)===0;
      if(blank){
        const row=rows[0];row.querySelector('[data-line-name]').value=pkg.name;row.querySelector('[data-line-description]').value=description;row.querySelector('[data-line-quantity]').value='1';row.querySelector('[data-line-value]').value='0.00';
      } else addLine({name:pkg.name,description,quantity:1,amountCents:0});
      totalPreview();notify(`Pacote “${pkg.name}” adicionado. Confira a descrição e defina o preço deste trabalho.`);
    });
    totalPreview();

    form.addEventListener('submit',e=>{
      e.preventDefault();
      const client=clientById($('#quoteClient').value),vehicle=vehicleById(client,$('#quoteVehicle').value);
      if(!client||!vehicle)return notify('Selecione um cliente e um veículo válido.');
      if((client.active===false||vehicle.active===false)&&(!q||client.id!==q.clientId||vehicle.id!==q.vehicleId))return notify('Para um novo orçamento, selecione um cliente e um veículo ativos.');
      const newItems=[...lines.querySelectorAll('[data-quote-line]')].map(row=>({id:row.dataset.lineId||uid(),name:normalizeText(row.querySelector('[data-line-name]').value),description:normalizeMultiline(row.querySelector('[data-line-description]').value),quantity:Math.max(1,Math.min(999,Math.round(Number(row.querySelector('[data-line-quantity]').value)||1))),amountCents:Math.max(0,amountToCents(row.querySelector('[data-line-value]').value))}));
      if(!newItems.length||newItems.some(item=>!item.name))return notify('Preencha o nome de todos os itens.');
      const ts=nowISO(),subtotalCents=newItems.reduce((sum,item)=>sum+item.amountCents*item.quantity,0),discountCents=Math.max(0,amountToCents(form.elements.discount.value));
      if(discountCents>subtotalCents)return notify('O desconto não pode ser maior que o subtotal do orçamento.');
      const wasNonDraft=Boolean(q&&q.status!=='draft');
      const before=snapshotData();
      const next={id:q?.id||uid(),number:q?.number||`ORC-${dateISO().replaceAll('-','')}-${String(data.quotes.length+1).padStart(3,'0')}`,clientId:client.id,vehicleId:vehicle.id,clientNameSnapshot:client.name,vehicleModelSnapshot:vehicle.model,plateSnapshot:vehicle.plate||'',items:newItems,discountCents,notes:normalizeMultiline(form.elements.notes.value),terms:normalizeMultiline(form.elements.terms.value),validityDays:Math.max(1,Math.min(365,Math.round(Number(form.elements.validityDays.value)||7))),status:wasNonDraft?'draft':(q?.status||'draft'),convertedServiceId:q?.convertedServiceId||'',sentAt:wasNonDraft?'':(q?.sentAt||''),approvedAt:wasNonDraft?'':(q?.approvedAt||''),active:true,createdAt:q?.createdAt||ts,updatedAt:ts};
      if(q)Object.assign(q,next);else data.quotes.push(next);
      if(!persistMutation(before))return;
      closeProfile();renderAll();notify(wasNonDraft?'Orçamento alterado e devolvido a rascunho para nova aprovação.':'Orçamento salvo.');
    });
  }

  function renderRetention() {
    const node=$('#retentionList');if(!node||!data)return;
    const days=Math.max(30,Number($('#retentionDays')?.value)||30), query=normalizeText($('#retentionSearch')?.value||'').toLocaleLowerCase('pt-BR'), today=new Date();today.setHours(12,0,0,0);
    const list=data.clients.filter(c=>c.active!==false).map(c=>{const history=data.entries.filter(e=>e.type==='service'&&!e.voidedAt&&e.status==='received'&&e.clientId===c.id&&isValidDate(e.date)).sort((a,b)=>b.date.localeCompare(a.date));const last=history[0]?.date||'';const age=last?Math.floor((today-new Date(`${last}T12:00:00`))/86400000):null;return {c,last,age,count:history.length};}).filter(x=>(x.age===null||x.age>=days)&&(!query||`${x.c.name} ${x.c.phone}`.toLocaleLowerCase('pt-BR').includes(query))).sort((a,b)=>(b.age??99999)-(a.age??99999));
    node.innerHTML=list.length?list.map(x=>`<article class="retention-card panel"><div class="row-avatar">${initials(x.c.name)}</div><div class="retention-main"><h3>${esc(x.c.name)}</h3><p>${esc(x.c.phone||'Sem telefone cadastrado')} · ${x.count} serviços históricos</p><small>${x.last?`Último atendimento: ${fmtDate(x.last)} · há ${x.age} dias`:'Nenhum serviço concluído registrado'}</small></div><div class="retention-actions"><button class="btn secondary" data-open-client="${esc(x.c.id)}" type="button">Ver cliente</button><button class="btn primary" data-retention-whatsapp="${esc(x.c.id)}" type="button">Preparar WhatsApp</button></div></article>`).join(''):'<div class="empty panel">Nenhum cliente atende a esse filtro. Confira se os serviços realizados estão registrados.</div>';
  }
  function prepareWhatsApp(phone, message) {
    const digits=String(phone||'').replace(/\D/g,'');if(digits.length<10)return notify('Cadastre um telefone com DDD para preparar o WhatsApp.');
    const normalized=digits.startsWith('55')?digits:`55${digits}`;
    window.open(`https://wa.me/${normalized}?text=${encodeURIComponent(message)}`,'_blank','noopener,noreferrer');
  }
  function quoteMessage(q) {const lines=q.items.map(i=>`• ${i.name}${i.description?` — ${i.description}`:''}: ${i.quantity} × ${money(i.amountCents)}`).join('\n');const client=clientById(q.clientId);return `Olá${client?.name?` ${client.name}`:''}! Segue o orçamento ${q.number} da ${data.company.name}.\nVeículo: ${q.vehicleModelSnapshot}${q.plateSnapshot?` (${q.plateSnapshot})`:''}\n${lines}\nDesconto: ${money(q.discountCents)}\nTotal: ${money(quoteTotal(q))}\nValidade: ${q.validityDays} dias${q.notes?`\nObservações: ${q.notes}`:''}${q.terms?`\nCondições: ${q.terms}`:''}\n${data.company.phone?`Contato: ${data.company.phone}`:''}`;}
  function quotePdfBlob(q) {
    if (!window.jspdf?.jsPDF) throw new Error('A biblioteca PDF ainda não carregou. Conecte-se à internet e tente novamente.');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({unit:'mm',format:'a4'});
    const rawColor = /^#[0-9a-f]{6}$/i.test(data.company.quoteColor||'') ? data.company.quoteColor : '#1477f8';
    const rgb = [1,3,5].map(i=>parseInt(rawColor.slice(i,i+2),16));
    const client=clientById(q.clientId), pageW=210, pageH=297, margin=16, right=194, usable=right-margin, bottom=274;
    const name=data.company.name||'Empresa';
    let y=18;
    const setAccent=()=>doc.setTextColor(...rgb);
    const fitLines=(value,width)=>String(value||'').split(/\r?\n/).flatMap(part=>part?doc.splitTextToSize(part,width):[' ']);
    const drawContinuationHeader=()=>{
      doc.setFillColor(...rgb);doc.rect(0,0,pageW,4,'F');
      doc.setFont('helvetica','bold');doc.setFontSize(9);setAccent();
      doc.text(`ORÇAMENTO ${q.number} · CONTINUAÇÃO`,margin,13);
      y=22;
    };
    const newPage=(tableHeader=false)=>{
      doc.addPage();drawContinuationHeader();
      if(tableHeader)drawTableHeader();
    };
    const ensureSpace=(needed)=>{if(y+needed>bottom){newPage(false);return true;}return false;};
    const drawTableHeader=()=>{
      doc.setFillColor(...rgb);doc.rect(margin,y-4,usable,8,'F');
      doc.setTextColor(255,255,255);doc.setFont('helvetica','bold');doc.setFontSize(8);
      doc.text('PACOTE / DESCRIÇÃO',margin+2,y+1);
      doc.text('QTD.',137,y+1,{align:'center'});doc.text('UNITÁRIO',161,y+1,{align:'right'});doc.text('TOTAL',192,y+1,{align:'right'});
      y+=8;
    };

    // First-page header: the business logo is separate from the administrator's profile photo.
    doc.setFillColor(...rgb);doc.rect(0,0,pageW,5,'F');
    let left=margin, companyWidth=112;
    if(data.company.logoDataUrl){
      try{
        const logo=data.company.logoDataUrl;
        const format=logo.startsWith('data:image/png')?'PNG':logo.startsWith('data:image/webp')?'WEBP':'JPEG';
        doc.addImage(logo,format,margin,13,25,25,'nexo-company-logo','FAST');left=margin+31;companyWidth=83;
      }catch(error){console.warn('O logotipo não pôde ser inserido no PDF.',error);}
    }
    doc.setTextColor(25,43,61);doc.setFont('helvetica','bold');doc.setFontSize(15);
    const companyLines=doc.splitTextToSize(name,companyWidth).slice(0,3);
    doc.text(companyLines,left,19);
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(90,108,126);
    const contact=[data.company.short,data.company.phone,data.company.whatsapp?`WhatsApp: ${data.company.whatsapp}`:'',data.company.address].filter(Boolean).join(' · ');
    const contactLines=doc.splitTextToSize(contact,companyWidth).slice(0,6);
    doc.text(contactLines,left,19+companyLines.length*5.3+1);
    doc.setFont('helvetica','bold');doc.setFontSize(11);setAccent();doc.text('ORÇAMENTO',right,17,{align:'right'});
    doc.setFontSize(10);doc.text(q.number,right,23,{align:'right'});
    doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(90,108,126);
    const createdDate=q.createdAt&&isValidDate(String(q.createdAt).slice(0,10))?String(q.createdAt).slice(0,10):dateISO(q.createdAt?new Date(q.createdAt):new Date());
    doc.text(`Emitido: ${fmtDate(createdDate)}`,right,29,{align:'right'});
    doc.text(`Validade: ${q.validityDays} dias`,right,35,{align:'right'});
    y=Math.max(48,19+companyLines.length*5.3+1+contactLines.length*3.5+5);
    ensureSpace(18);
    doc.setDrawColor(...rgb);doc.setLineWidth(.7);doc.line(margin,y,right,y);y+=7;

    const section=title=>{
      ensureSpace(13);doc.setFont('helvetica','bold');doc.setFontSize(10);setAccent();doc.text(title,margin,y);y+=6;
    };
    section('CLIENTE E VEÍCULO');
    const clientName=client?.name||q.clientNameSnapshot||'Cliente';
    doc.setTextColor(25,43,61);doc.setFont('helvetica','bold');doc.setFontSize(10);
    const clientLines=doc.splitTextToSize(clientName,usable);ensureSpace(clientLines.length*4+5);doc.text(clientLines,margin,y);y+=clientLines.length*4+1;
    doc.setFont('helvetica','normal');doc.setFontSize(9);
    const vehicleLine=[client?.phone,q.vehicleModelSnapshot,q.plateSnapshot].filter(Boolean).join(' · ');
    const vehicleLines=doc.splitTextToSize(vehicleLine,usable);ensureSpace(vehicleLines.length*4+7);doc.text(vehicleLines,margin,y);y+=vehicleLines.length*4+6;

    section('PACOTES E SERVIÇOS');
    drawTableHeader();
    doc.setFontSize(8);
    for(const item of q.items){
      const nameLines=doc.splitTextToSize(String(item.name||''),85).map(text=>({text,kind:'name'}));
      const descLines=fitLines(item.description,85).map(text=>({text,kind:'description'}));
      const rowLines=[...nameLines,...descLines];
      let offset=0,firstChunk=true;
      while(offset<rowLines.length){
        const available=Math.floor((bottom-y-4)/3.6);
        if(available<1){newPage(true);continue;}
        const count=Math.min(available,rowLines.length-offset);
        const chunk=rowLines.slice(offset,offset+count);
        chunk.forEach((entry,index)=>{
          doc.setFont('helvetica',entry.kind==='name'?'bold':'normal');
          doc.setTextColor(...(entry.kind==='name'?[25,43,61]:[90,108,126]));
          doc.text(entry.text||' ',margin+2,y+index*3.6);
        });
        if(firstChunk){
          doc.setFont('helvetica','normal');doc.setTextColor(25,43,61);
          doc.text(String(item.quantity),137,y,{align:'center'});
          doc.text(money(item.amountCents),161,y,{align:'right'});
          doc.setFont('helvetica','bold');doc.text(money(item.amountCents*item.quantity),192,y,{align:'right'});
          firstChunk=false;
        }
        y+=count*3.6+3;offset+=count;
        if(offset<rowLines.length)newPage(true);
      }
      doc.setDrawColor(225,234,242);doc.line(margin,y-2,right,y-2);y+=1;
    }

    y+=2;ensureSpace(28);
    const subtotal=q.items.reduce((sum,item)=>sum+item.amountCents*item.quantity,0);
    doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(80,96,112);
    doc.text('Subtotal',145,y,{align:'right'});doc.text(money(subtotal),right,y,{align:'right'});y+=6;
    doc.text('Desconto',145,y,{align:'right'});doc.text(money(q.discountCents),right,y,{align:'right'});y+=8;
    doc.setDrawColor(...rgb);doc.line(130,y-4,right,y-4);doc.setFont('helvetica','bold');doc.setFontSize(13);setAccent();
    doc.text('TOTAL',145,y+2,{align:'right'});doc.text(money(quoteTotal(q)),right,y+2,{align:'right'});y+=13;

    const addTextSection=(title,text)=>{
      if(!String(text||'').trim())return;
      section(title);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(25,43,61);
      const lines=fitLines(text,usable);let offset=0;
      while(offset<lines.length){
        const available=Math.floor((bottom-y-3)/4.2);
        if(available<1){newPage(false);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(25,43,61);continue;}
        const chunk=lines.slice(offset,offset+available);doc.text(chunk,margin,y);y+=chunk.length*4.2+2;offset+=chunk.length;
      }
      y+=2;
    };
    addTextSection('OBSERVAÇÕES',q.notes);
    addTextSection('CONDIÇÕES E VALIDADE',q.terms);

    // Consistent footer on every page; keep content above the footer safe area.
    const pageCount=doc.getNumberOfPages();
    for(let page=1;page<=pageCount;page++){
      doc.setPage(page);doc.setDrawColor(225,234,242);doc.setLineWidth(.3);doc.line(margin,284,right,284);
      doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(110,124,138);
      doc.text(`${name} · Documento gerado pelo NEXO Gestão`,margin,289);
      doc.text(`Página ${page} de ${pageCount}`,right,289,{align:'right'});
    }
    return doc.output('blob');
  }

  function quoteHtmlPreview(q){
    const color=/^#[0-9a-f]{6}$/i.test(data.company.quoteColor||'')?data.company.quoteColor:'#1477f8';
    const client=clientById(q.clientId);
    const logo=data.company.logoDataUrl?`<img class="quote-preview-logo" src="${esc(data.company.logoDataUrl)}" alt="Logotipo da empresa">`:`<div class="quote-preview-logo quote-preview-logo-fallback">${esc(initials(data.company.name))}</div>`;
    const createdDate=q.createdAt&&isValidDate(String(q.createdAt).slice(0,10))?String(q.createdAt).slice(0,10):dateISO(q.createdAt?new Date(q.createdAt):new Date());
    const rows=q.items.map(item=>`<article class="quote-preview-item"><div class="quote-preview-item-description"><b>${esc(item.name)}</b>${item.description?`<p>${esc(item.description)}</p>`:''}</div><span>${item.quantity}</span><span>${money(item.amountCents)}</span><strong>${money(item.amountCents*item.quantity)}</strong></article>`).join('');
    return `<div class="quote-html-preview" style="--quote-accent:${esc(color)}"><div class="quote-html-band"></div><div class="quote-html-content"><header class="quote-html-header">${logo}<div class="quote-html-company"><h3>${esc(data.company.name||'Empresa')}</h3><p>${esc([data.company.short,data.company.phone,data.company.whatsapp?`WhatsApp: ${data.company.whatsapp}`:'',data.company.address].filter(Boolean).join(' · '))}</p></div><div class="quote-html-number"><b>ORÇAMENTO</b><strong>${esc(q.number)}</strong><small>Emitido: ${fmtDate(createdDate)}</small><small>Validade: ${q.validityDays} dias</small></div></header><div class="quote-html-client"><h4>CLIENTE E VEÍCULO</h4><b>${esc(client?.name||q.clientNameSnapshot||'Cliente')}</b><p>${esc([client?.phone,q.vehicleModelSnapshot,q.plateSnapshot].filter(Boolean).join(' · '))}</p></div><h4 class="quote-html-section">PACOTES E SERVIÇOS</h4><div class="quote-html-table-head"><span>PACOTE / DESCRIÇÃO</span><span>QTD.</span><span>UNITÁRIO</span><span>TOTAL</span></div><div class="quote-html-items">${rows}</div><div class="quote-html-totals"><span>Subtotal</span><b>${money(q.items.reduce((sum,item)=>sum+item.amountCents*item.quantity,0))}</b><span>Desconto</span><b>${money(q.discountCents)}</b><strong>TOTAL</strong><strong>${money(quoteTotal(q))}</strong></div>${q.notes?`<section class="quote-html-text"><h4>OBSERVAÇÕES</h4><p>${esc(q.notes)}</p></section>`:''}${q.terms?`<section class="quote-html-text"><h4>CONDIÇÕES E VALIDADE</h4><p>${esc(q.terms)}</p></section>`:''}<footer>${esc(data.company.name)} · Orçamento gerado pelo NEXO Gestão</footer></div></div>`;
  }

  function safeFileName(q){return `orcamento-${String(q.number||q.id).replace(/[^a-z0-9_-]/gi,'-')}.pdf`;}
  function printQuote(id){
    const q=quoteById(id);if(!q)return;
    try{
      const card=$('#profileModalCard');
      card.innerHTML=`<button class="modal-close" data-close-profile type="button" aria-label="Fechar prévia">×</button><span class="eyebrow">PRÉVIA DO ORÇAMENTO</span><h2>${esc(q.number)}</h2><p class="muted">Esta é uma prévia dentro do NEXO. Toque em Baixar PDF para gerar o documento e em Voltar ao NEXO para retornar à lista.</p><div class="quote-html-preview-scroll">${quoteHtmlPreview(q)}</div><div class="crop-actions"><button class="btn secondary" data-close-profile type="button">Voltar ao NEXO</button><button class="btn primary" id="downloadQuotePdf" type="button">Baixar PDF</button></div>`;
      $('#profileModal').classList.remove('hidden');$('#profileModal').setAttribute('aria-hidden','false');
      $('#downloadQuotePdf').addEventListener('click',()=>{try{const blob=quotePdfBlob(q);const ok=download(safeFileName(q),blob,'application/pdf');if(ok)notify('Exportação do PDF iniciada. Confira Downloads/Arquivos.');else notify('Não foi possível iniciar o download do PDF.');}catch(error){console.error(error);notify(error.message||'Não foi possível gerar o PDF.');}});
    }catch(error){console.error(error);notify(error.message||'Não foi possível abrir a prévia do orçamento.');}
  }

  async function shareQuotePdf(id){const q=quoteById(id);if(!q)return;try{const blob=quotePdfBlob(q),file=new File([blob],safeFileName(q),{type:'application/pdf'});if(navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){await navigator.share({files:[file],title:`Orçamento ${q.number}`,text:`Orçamento ${q.number} — ${data.company.name}`});return;}const ok=download(safeFileName(q),await blob.arrayBuffer(),'application/pdf');if(!ok)return notify('Não foi possível baixar o PDF.');notify('O PDF foi baixado. Neste dispositivo, o navegador não oferece compartilhamento direto de arquivos; abra o WhatsApp e anexe o PDF baixado.');}catch(e){if(e?.name==='AbortError')return;console.error(e);notify(e.message||'Não foi possível preparar o PDF para compartilhar.');}}
  async function convertQuote(id) {
    const q=quoteById(id);if(!q||q.status!=='approved'||q.convertedServiceId)return;
    const client=clientById(q.clientId),vehicle=vehicleById(client,q.vehicleId);if(!client||!vehicle)return notify('O cliente ou veículo deste orçamento não existe mais.');
    const ok=await confirmAction(`Converter ${q.number} em serviço de ${money(quoteTotal(q))}? A conversão será feita uma única vez.`,'Converter orçamento','Criar serviço');if(!ok)return;
    if(q.convertedServiceId||data.entries.some(e=>e.quoteId===q.id))return notify('Este orçamento já foi convertido em serviço.');
    const before=snapshotData(); const ts=nowISO(), entry={id:uid(),companyId:data.company.id,source:'quote',quoteId:q.id,type:'service',date:dateISO(),amountCents:quoteTotal(q),value:quoteTotal(q)/100,description:q.items.map(i=>i.name).join(', ').slice(0,250)||'Serviço de orçamento',category:'',status:'pending',paymentMethod:'',supplier:'',notes:q.notes,clientId:client.id,vehicleId:vehicle.id,employeeId:'',clientNameSnapshot:client.name,vehicleModelSnapshot:vehicle.model,plateSnapshot:vehicle.plate||'',voidedAt:null,voidReason:'',createdAt:ts,updatedAt:ts};data.entries.push(entry);q.convertedServiceId=entry.id;q.updatedAt=ts;if(!persistMutation(before))return;renderAll();notify('Orçamento convertido em serviço.');
  }
  async function setQuoteStatus(id,status) {const q=quoteById(id);if(!q||!['draft','sent','approved','refused'].includes(status))return;if(q.convertedServiceId&&status!=='approved')return notify('Este orçamento já gerou um serviço.');const ok=await confirmAction(`Alterar o status de ${q.number} para “${quoteStatusLabel(status)}”?`,'Atualizar orçamento','Confirmar');if(!ok)return;const before=snapshotData();q.status=status;q.updatedAt=nowISO();if(status==='sent')q.sentAt=nowISO();if(status==='approved')q.approvedAt=nowISO();if(!persistMutation(before))return;renderAll();notify('Status do orçamento atualizado.');}
  async function saveMonthlyGoal() {const value=Number($('#monthlyGoalInput').value);if(!Number.isFinite(value)||value<0)return notify('Informe uma meta válida, igual ou maior que zero.');const before=snapshotData();data.monthlyGoals[currentKey()]=Math.round(value*100);if(!persistMutation(before))return;renderAll();notify('Meta mensal salva.');}
  let cropImage=null,cropScale=1,cropX=0,cropY=0,cropDrag=null;
  let cropTarget='company';
  function drawLogoCrop(){const canvas=$('#logoCropCanvas');if(!canvas||!cropImage)return;const ctx=canvas.getContext('2d'),size=canvas.width;ctx.clearRect(0,0,size,size);ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);const cover=Math.max(size/cropImage.width,size/cropImage.height),scale=cover*cropScale,w=cropImage.width*scale,h=cropImage.height*scale;cropX=Math.max(-(w-size)/2,Math.min((w-size)/2,cropX));cropY=Math.max(-(h-size)/2,Math.min((h-size)/2,cropY));const x=(size-w)/2+cropX,y=(size-h)/2+cropY;ctx.drawImage(cropImage,x,y,w,h);}
  async function saveCompanyLogo(file,target='company'){if(!file)return;cropTarget=target==='owner'?'owner':'company';if(!file.type.startsWith('image/'))return notify('Escolha um arquivo de imagem.');if(file.size>8*1024*1024)return notify('A imagem deve ter até 8 MB.');try{const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});cropImage=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=reject;image.src=url;});cropScale=1;cropX=0;cropY=0;const card=$('#profileModalCard');card.innerHTML=`<button class="modal-close" data-close-profile type="button" aria-label="Fechar">×</button><span class="eyebrow">IDENTIDADE VISUAL</span><h2>${cropTarget==='owner'?'Enquadrar foto do perfil':'Enquadrar logotipo'}</h2><p class="muted">Arraste a imagem para escolher a parte que ficará no quadrado. Ajuste o zoom e centralize como preferir.</p><div class="logo-crop-wrap"><canvas id="logoCropCanvas" width="280" height="280" aria-label="Prévia do recorte quadrado do logotipo"></canvas></div><label>Zoom <input id="logoCropZoom" type="range" min="1" max="3" step="0.01" value="1"></label><div class="crop-actions"><button class="btn secondary" data-close-profile type="button">Cancelar</button><button class="btn primary" id="saveLogoCrop" type="button">Usar este recorte</button></div>`;$('#profileModal').classList.remove('hidden');$('#profileModal').setAttribute('aria-hidden','false');drawLogoCrop();const canvas=$('#logoCropCanvas');canvas.addEventListener('pointerdown',e=>{cropDrag={x:e.clientX,y:e.clientY,ox:cropX,oy:cropY};canvas.setPointerCapture(e.pointerId);});canvas.addEventListener('pointermove',e=>{if(!cropDrag)return;const rect=canvas.getBoundingClientRect(),ratio=canvas.width/rect.width;cropX=cropDrag.ox+(e.clientX-cropDrag.x)*ratio;cropY=cropDrag.oy+(e.clientY-cropDrag.y)*ratio;drawLogoCrop();});canvas.addEventListener('pointerup',()=>cropDrag=null);canvas.addEventListener('pointercancel',()=>cropDrag=null);$('#logoCropZoom').addEventListener('input',e=>{cropScale=Number(e.target.value)||1;drawLogoCrop();});$('#saveLogoCrop').addEventListener('click',()=>{const out=document.createElement('canvas');out.width=out.height=256;out.getContext('2d').drawImage(canvas,0,0,256,256);const before=snapshotData();const imageData=out.toDataURL('image/jpeg',0.86);if(cropTarget==='owner')data.ownerAvatarDataUrl=imageData;else data.company.logoDataUrl=imageData;if(!persistMutation(before,false))return;closeProfile();renderAll();notify(cropTarget==='owner'?'Foto do perfil salva e exibida no menu.':'Logotipo recortado e salvo.');cropImage=null;});}catch(e){console.error(e);notify('Não foi possível abrir ou recortar o logotipo.');}}

  function handleDelegatedClick(event) {
    const t=event.target.closest('button'); if(!t) return;
    if(t.dataset.view) { go(t.dataset.view); return; }
    if(t.dataset.editPackage) { openPackageForm(t.dataset.editPackage); return; }
    if(t.dataset.packageActive) { const item=packageById(t.dataset.packageActive); if(item){const before=snapshotData();item.active=t.dataset.active==='true';item.deletedAt=item.active?null:nowISO();item.updatedAt=nowISO();if(!persistMutation(before))return;renderAll();notify(item.active?'Pacote reativado.':'Pacote inativado.');} return; }
    if(t.dataset.editQuote) { openQuoteForm(t.dataset.editQuote); return; }
    if(t.dataset.quotePrint) { printQuote(t.dataset.quotePrint); return; }
    if(t.dataset.quoteWhatsapp) { shareQuotePdf(t.dataset.quoteWhatsapp); return; }
    if(t.dataset.quoteStatus) { setQuoteStatus(t.dataset.quoteStatus,t.dataset.status); return; }
    if(t.dataset.quoteConvert) { convertQuote(t.dataset.quoteConvert); return; }
    if(t.dataset.retentionWhatsapp) { const c=clientById(t.dataset.retentionWhatsapp); if(c)prepareWhatsApp(c.phone,`Olá, ${c.name}! Tudo bem? Aqui é da ${data.company.name}. Estamos entrando em contato para saber se podemos ajudar com os cuidados do seu veículo. Se desejar, podemos conversar sobre um novo atendimento. ${data.company.phone?`Contato: ${data.company.phone}`:''}`); return; }

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

  // V4 event wiring
  $('#newQuoteBtn').addEventListener('click',()=>openQuoteForm());
  $('#newPackageBtn').addEventListener('click',()=>openPackageForm());
  $('#quoteSearch').addEventListener('input',renderQuotes); $('#quoteStatusFilter').addEventListener('change',renderQuotes);
  $('#retentionDays').addEventListener('change',renderRetention); $('#retentionSearch').addEventListener('input',renderRetention);
  $('#saveMonthlyGoal').addEventListener('click',saveMonthlyGoal);
  $('#companyLogo').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)saveCompanyLogo(file,'company');e.target.value='';});
  $('#ownerPhoto').addEventListener('change',e=>{const file=e.target.files?.[0];if(file)saveCompanyLogo(file,'owner');e.target.value='';});
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
  $('#clearData').addEventListener('click',async()=>{const ok=await confirmAction('Isso apagará todos os dados desta empresa neste navegador: clientes, veículos, funcionários, lançamentos, catálogo, orçamentos, metas e configurações. A conta de login continuará existindo. Faça um backup antes de continuar.','Apagar dados','Apagar tudo');if(!ok)return;const before=snapshotData();data=emptyData(accounts[currentEmail]);if(!persistMutation(before))return;renderAll();notify('Dados da empresa apagados.');});
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
