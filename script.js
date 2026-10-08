(() => {
  'use strict';

  const ACCOUNTS_KEY = 'nexo_accounts_v2';
  const SESSION_KEY = 'nexo_session_v2';
  const DATA_PREFIX = 'nexo_data_v2_';
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const categories = ['Produtos','Combustível','Manutenção','Equipamentos','Aluguel','Energia','Água','Internet','Impostos','Outros'];
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const brl = n => new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
  const dateISO = () => { const d = new Date(); const off = d.getTimezoneOffset(); return new Date(d.getTime()-off*60000).toISOString().slice(0,10); };
  const monthKey = d => { const x = new Date(`${d}T12:00:00`); return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`; };
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const esc = v => String(v ?? '').replace(/[&<>'"]/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const initials = s => String(s||'').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase() || 'NX';
  const fmtDate = d => d ? new Date(`${d}T12:00:00`).toLocaleDateString('pt-BR') : '—';
  const normalizeEmail = e => String(e||'').trim().toLowerCase();
  const accountDataKey = email => `${DATA_PREFIX}${btoa(unescape(encodeURIComponent(email))).replace(/=+$/,'')}`;
  const emptyData = (account={}) => ({version:2,company:{name:'Central Estética Automotiva',short:'Central Estética'},entries:[],employees:[],createdAt:new Date().toISOString(),ownerName:account.name||''});
  const notify = msg => { const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(window.__toast); window.__toast=setTimeout(()=>t.classList.remove('show'),2600); };

  let accounts = loadAccounts();
  let currentEmail = localStorage.getItem(SESSION_KEY) || '';
  let data = null;
  let selectedMonth = new Date();
  let currentView = 'dashboard';
  let authMode = 'login';
  let profileEmployeeId = '';

  function loadAccounts(){ try { const a=JSON.parse(localStorage.getItem(ACCOUNTS_KEY)); return a && typeof a==='object' ? a : {}; } catch { return {}; } }
  function saveAccounts(){ localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(accounts)); }
  async function hashPassword(password){ const bytes=new TextEncoder().encode(password); const hash=await crypto.subtle.digest('SHA-256',bytes); return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
  function loadData(email){ try { const x=JSON.parse(localStorage.getItem(accountDataKey(email))); if(!x) return emptyData(accounts[email]); x.company=x.company||{name:'Central Estética Automotiva',short:'Central Estética'}; x.entries=Array.isArray(x.entries)?x.entries:[]; x.employees=Array.isArray(x.employees)?x.employees:[]; return migrateData(x); } catch { return emptyData(accounts[email]); } }
  function migrateData(x){
    // Compatibilidade com a V1: converte nomes antigos de funcionários em cadastros permanentes.
    const employeeMap = new Map(x.employees.map(e => [typeof e === 'string' ? e : e.id, typeof e === 'string' ? {id:uid(),name:e,createdAt:new Date().toISOString()} : e]));
    x.employees=[...employeeMap.values()].map(e=>({id:e.id||uid(),name:String(e.name||'').trim(),createdAt:e.createdAt||new Date().toISOString()})).filter(e=>e.name);
    const byName = new Map(x.employees.map(e=>[e.name.toLowerCase(),e.id]));
    x.entries=x.entries.map(e=>{
      if(e.type==='payroll' && !e.employeeId){
        const name=String(e.employee||'').trim();
        if(name && !byName.has(name.toLowerCase())){const emp={id:uid(),name,createdAt:new Date().toISOString()};x.employees.push(emp);byName.set(name.toLowerCase(),emp.id);}
        return {...e,employeeId:byName.get(name.toLowerCase())||''};
      }
      return e;
    });
    return x;
  }
  function saveData(){ if(currentEmail && data) localStorage.setItem(accountDataKey(currentEmail),JSON.stringify(data)); }
  function currentKey(){ return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth()+1).padStart(2,'0')}`; }
  function entriesFor(k=currentKey()){ return data.entries.filter(e=>monthKey(e.date)===k); }
  const services = k => entriesFor(k).filter(e=>e.type==='service');
  const expenses = k => entriesFor(k).filter(e=>e.type==='expense');
  const payroll = k => entriesFor(k).filter(e=>e.type==='payroll');
  const total = arr => arr.reduce((s,e)=>s+Number(e.value||0),0);

  function setAuthMode(mode){
    authMode=mode;
    const register=mode==='register';
    $('#authEyebrow').textContent=register?'CRIAR CONTA':'ACESSO SEGURO';
    $('#authTitle').textContent=register?'Criar sua conta':'Entrar no NEXO';
    $('#authSubtitle').textContent=register?'Crie uma conta para manter seus dados separados dos demais usuários.':'Acesse sua conta para acompanhar a empresa mês a mês.';
    $('#loginName').hidden=!register; $('#loginName').required=register;
    $('#confirmPasswordLabel').hidden=!register; $('#confirmPassword').required=register;
    $('#authSubmit').innerHTML=register?'Criar conta <span>→</span>':'Entrar <span>→</span>';
    $('#toggleAuth').textContent=register?'Já tenho uma conta':'Criar uma conta';
  }

  async function handleAuth(ev){
    ev.preventDefault();
    const email=normalizeEmail($('#loginEmail').value), password=$('#loginPassword').value;
    if(!email || password.length<6) return notify('Informe um e-mail válido e uma senha de pelo menos 6 caracteres.');
    const hash=await hashPassword(password);
    if(authMode==='register'){
      if(accounts[email]) return notify('Este e-mail já possui uma conta. Entre normalmente.');
      if(password!==$('#confirmPassword').value) return notify('As senhas não conferem.');
      accounts[email]={email,name:$('#loginName').value.trim()||email.split('@')[0],passwordHash:hash,createdAt:new Date().toISOString()};
      saveAccounts();
      const fresh=emptyData(accounts[email]);
      fresh.company.name = 'Central Estética Automotiva'; fresh.company.short='Central Estética';
      localStorage.setItem(accountDataKey(email),JSON.stringify(fresh));
      currentEmail=email; data=fresh; localStorage.setItem(SESSION_KEY,email); ensureSession(); notify('Conta criada com sucesso.');
      $('#loginForm').reset();
    } else {
      if(!accounts[email]) return notify('Conta não encontrada. Crie uma conta primeiro.');
      if(accounts[email].passwordHash!==hash) return notify('E-mail ou senha incorretos.');
      currentEmail=email; data=loadData(email); localStorage.setItem(SESSION_KEY,email); ensureSession(); notify(`Bem-vindo, ${accounts[email].name}.`);
      $('#loginForm').reset();
    }
  }

  function ensureSession(){
    if(localStorage.getItem(SESSION_KEY) && accounts[localStorage.getItem(SESSION_KEY)]){
      currentEmail=localStorage.getItem(SESSION_KEY); data=loadData(currentEmail); $('#loginScreen').classList.add('hidden'); $('#app').classList.remove('hidden'); renderAll();
    } else {
      currentEmail=''; data=null; localStorage.removeItem(SESSION_KEY); $('#loginScreen').classList.remove('hidden'); $('#app').classList.add('hidden');
    }
  }

  function renderAll(){
    $('#companyName').value=data.company.name; $('#companyShort').value=data.company.short;
    $('#sidebarCompany').textContent=data.company.short; $('#companyAvatar').textContent=initials(data.company.short);
    $('#sidebarUser').textContent=accounts[currentEmail]?.name || currentEmail;
    $('#accountSummary').textContent=`Conta: ${currentEmail}`;
    $('#monthLabel').textContent=`${months[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`;
    $('#dashboardGreeting').textContent=`Olá, vamos aos números de ${months[selectedMonth.getMonth()].toLowerCase()}.`;
    renderDashboard(); renderServices(); renderExpenses(); renderEmployees(); renderAnalysis();
  }

  function renderDashboard(){
    const ss=services(), es=expenses(), ps=payroll(), rev=total(ss), exp=total(es), pay=total(ps), result=rev-exp-pay;
    $('#metricRevenue').textContent=brl(rev); $('#metricRevenueSub').textContent=`${ss.length} ${ss.length===1?'serviço':'serviços'} registrados`;
    $('#metricExpenses').textContent=brl(exp); $('#metricExpensesSub').textContent=`${es.length} ${es.length===1?'lançamento':'lançamentos'}`;
    $('#metricPayroll').textContent=brl(pay); $('#metricPayrollSub').textContent=`${ps.length} ${ps.length===1?'pagamento':'pagamentos'}`;
    $('#metricResult').textContent=brl(result); $('#metricResult').style.color=result>=0?'#fff':'#ffb7bd';
    const last=ss.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
    $('#recentServices').innerHTML=last.length?last.map(e=>`<div class="list-row"><div class="row-avatar">${initials(e.client||e.vehicle)}</div><div class="row-main"><b>${esc(e.vehicle)}</b><small>${esc(e.client)} · ${fmtDate(e.date)}</small></div><div class="row-value">${brl(e.value)}</div></div>`).join(''):'<div class="empty">Nenhum serviço neste mês.</div>';
    const empTotals={}; ps.forEach(p=>{const emp=data.employees.find(e=>e.id===p.employeeId); const name=emp?.name||'Funcionário removido'; empTotals[name]=(empTotals[name]||0)+Number(p.value||0);});
    const emp=Object.entries(empTotals).sort((a,b)=>b[1]-a[1]).slice(0,4);
    $('#teamSummary').innerHTML=emp.length?emp.map(([name,val])=>`<div class="team-row"><div class="row-avatar">${initials(name)}</div><div class="row-main"><b>${esc(name)}</b><small>Comissões no mês</small></div><div class="row-value">${brl(val)}</div></div>`).join(''):'<div class="empty">Nenhuma comissão registrada.</div>';
    renderRevenueChart(); renderExpenseDonut();
  }

  function renderRevenueChart(){
    const vals=[]; const base=new Date(selectedMonth);
    for(let i=5;i>=0;i--){ const d=new Date(base.getFullYear(),base.getMonth()-i,1); const k=monthKey(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`); vals.push({label:months[d.getMonth()].slice(0,3),value:total(services(k))}); }
    const max=Math.max(...vals.map(x=>x.value),1);
    $('#revenueChart').innerHTML=vals.map(x=>`<div class="bar-col"><b>${x.value?brl(x.value).replace('R$ ','R$ ').replace(',00',''):''}</b><div class="bar" style="height:${Math.max(4,x.value/max*145)}px"></div><small>${x.label}</small></div>`).join('');
  }

  function renderExpenseDonut(){
    const es=expenses(), map={}; es.forEach(e=>map[e.category]=(map[e.category]||0)+Number(e.value||0));
    const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]), colors=['#1477f8','#47b6ff','#7b61d1','#5cc88c','#f3a84a']; const totalExp=total(es);
    $('#donutTotal').textContent=brl(totalExp).replace(',00',''); let acc=0;
    const stops=rows.length&&totalExp?rows.map(([c,v],i)=>{const p=v/totalExp*100;const s=`${colors[i%colors.length]} ${acc}% ${acc+p}%`;acc+=p;return s}).join(','):'#e8edf2 0 100%';
    $('.donut').style.background=`conic-gradient(${stops})`;
    $('#donutLegend').innerHTML=rows.length?rows.slice(0,5).map(([c,v],i)=>`<div class="legend-row"><span class="legend-left"><i style="background:${colors[i%colors.length]}"></i>${esc(c)}</span><b>${brl(v)}</b></div>`).join(''):'<span class="muted">Sem despesas no período.</span>';
  }

  function renderServices(){
    const q=($('#serviceSearch')?.value||'').toLowerCase(); const arr=services().filter(e=>`${e.client} ${e.vehicle} ${e.description||''}`.toLowerCase().includes(q));
    $('#serviceCount').textContent=`${arr.length} ${arr.length===1?'serviço':'serviços'}`;
    $('#servicesList').innerHTML=`<div class="table-head"><span>Cliente / carro</span><span>Serviço</span><span>Data</span><span>Valor</span><span></span></div>${arr.length?arr.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<div class="table-row"><div><b>${esc(e.client)}</b><small>${esc(e.vehicle)}</small></div><div>${esc(e.description||'—')}</div><div>${fmtDate(e.date)}</div><div><b>${brl(e.value)}</b></div><div class="row-actions"><button class="icon-action" data-edit-entry="${e.id}" title="Editar">✎</button><button class="icon-action danger-action" data-delete-entry="${e.id}" title="Excluir">×</button></div></div>`).join(''):'<div class="empty">Nenhum serviço encontrado.</div>'}`;
  }

  function topCategory(){ const m={}; expenses().forEach(e=>m[e.category]=(m[e.category]||0)+Number(e.value||0)); const x=Object.entries(m).sort((a,b)=>b[1]-a[1])[0]; return x?x[0]:'—'; }
  function renderExpenses(){
    const q=($('#expenseSearch')?.value||'').toLowerCase(), cat=$('#expenseCategoryFilter')?.value||'all';
    const arr=expenses().filter(e=>(cat==='all'||e.category===cat)&&`${e.description} ${e.category} ${e.notes||''}`.toLowerCase().includes(q));
    $('#expenseMiniStats').innerHTML=`<div class="mini-stat"><span>Total do mês</span><b>${brl(total(expenses()))}</b></div><div class="mini-stat"><span>Maior categoria</span><b>${esc(topCategory())}</b></div><div class="mini-stat"><span>Lançamentos</span><b>${expenses().length}</b></div>`;
    $('#expensesList').innerHTML=`<div class="table-head"><span>Descrição</span><span>Categoria</span><span>Data</span><span>Valor</span><span></span></div>${arr.length?arr.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<div class="table-row"><div><b>${esc(e.description)}</b><small>${esc(e.notes||'')}</small></div><div>${esc(e.category)}</div><div>${fmtDate(e.date)}</div><div><b>${brl(e.value)}</b></div><div class="row-actions"><button class="icon-action" data-edit-entry="${e.id}" title="Editar">✎</button><button class="icon-action danger-action" data-delete-entry="${e.id}" title="Excluir">×</button></div></div>`).join(''):'<div class="empty">Nenhuma despesa encontrada.</div>'}`;
  }

  function employeeCommissions(id,k=currentKey()){ return payroll(k).filter(p=>p.employeeId===id); }
  function renderEmployees(){
    $('#employeeCards').innerHTML=data.employees.length?data.employees.map(emp=>{
      const ps=employeeCommissions(emp.id), value=total(ps);
      return `<article class="employee-card"><div class="emp-top"><div class="emp-avatar">${initials(emp.name)}</div><div><h3>${esc(emp.name)}</h3><small>${ps.length} ${ps.length===1?'pagamento':'pagamentos'} em ${months[selectedMonth.getMonth()].toLowerCase()}</small></div></div><strong>${brl(value)}</strong><small>Comissões no mês</small><div class="employee-actions"><button class="btn secondary small-btn" data-open-employee="${emp.id}">Abrir funcionário</button><button class="icon-action" data-edit-employee="${emp.id}" title="Editar funcionário">✎</button></div></article>`;
    }).join(''):'<div class="empty employee-empty">Nenhum funcionário cadastrado. Use “Adicionar funcionário” para criar o primeiro.</div>';
    const arr=payroll().slice().sort((a,b)=>b.date.localeCompare(a.date));
    $('#payrollList').innerHTML=`<div class="table-head"><span>Funcionário</span><span>Motivo</span><span>Data</span><span>Valor</span><span></span></div>${arr.length?arr.map(e=>{const emp=data.employees.find(x=>x.id===e.employeeId);return `<div class="table-row"><div><b>${esc(emp?.name||'Funcionário removido')}</b></div><div>${esc(e.description||'Comissão')}</div><div>${fmtDate(e.date)}</div><div><b>${brl(e.value)}</b></div><div class="row-actions"><button class="icon-action" data-edit-entry="${e.id}" title="Editar">✎</button><button class="icon-action danger-action" data-delete-entry="${e.id}" title="Excluir">×</button></div></div>`}).join(''):'<div class="empty">Nenhuma comissão registrada neste mês.</div>'}`;
  }

  function openEmployeeProfile(id){
    const emp=data.employees.find(e=>e.id===id); if(!emp) return;
    profileEmployeeId=id;
    const all=employeeCommissions(id).slice().sort((a,b)=>b.date.localeCompare(a.date)); const value=total(all);
    $('#employeeModalCard').innerHTML=`<button class="modal-close" data-close-employee>×</button><span class="eyebrow">FUNCIONÁRIO</span><div class="profile-header"><div class="profile-avatar">${initials(emp.name)}</div><div><h2>${esc(emp.name)}</h2><p class="muted">${esc(accounts[currentEmail]?.name||currentEmail)}</p></div></div><div class="profile-stats"><div><span>Comissões no mês</span><b>${brl(value)}</b></div><div><span>Pagamentos no mês</span><b>${all.length}</b></div></div><div class="profile-actions"><button class="btn primary" data-add-commission="${id}">＋ Adicionar comissão</button><button class="btn secondary" data-edit-employee="${id}">Editar funcionário</button><button class="btn danger-btn" data-delete-employee="${id}">Excluir funcionário</button></div><div class="profile-history"><div class="panel-head"><div><h3>Histórico de comissões</h3><p>${months[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}</p></div></div>${all.length?all.map(p=>`<div class="history-row"><div><b>${esc(p.description||'Comissão')}</b><small>${fmtDate(p.date)} · ${brl(p.value)}</small></div><div class="row-actions"><button class="icon-action" data-edit-entry="${p.id}" title="Editar">✎</button><button class="icon-action danger-action" data-delete-entry="${p.id}" title="Excluir">×</button></div></div>`).join(''):'<div class="empty">Nenhuma comissão neste mês.</div>'}</div>`;
    $('#employeeModal').classList.remove('hidden'); $('#employeeModal').setAttribute('aria-hidden','false');
  }
  function closeEmployeeProfile(){ $('#employeeModal').classList.add('hidden'); $('#employeeModal').setAttribute('aria-hidden','true'); profileEmployeeId=''; }

  function renderAnalysis(){
    const y=selectedMonth.getFullYear(); let yearRev=0,yearExp=0,yearPay=0,yearServices=0;
    const rows=months.map((name,m)=>{const d=`${y}-${String(m+1).padStart(2,'0')}-01`,k=monthKey(d);const s=services(k),e=expenses(k),p=payroll(k);const r=total(s),x=total(e),q=total(p);yearRev+=r;yearExp+=x;yearPay+=q;yearServices+=s.length;return {m,r,x,q,res:r-x-q,s:s.length};});
    const result=yearRev-yearExp-yearPay;
    $('#analysisCards').innerHTML=`<div class="analysis-card"><span>Faturamento no ano</span><b>${brl(yearRev)}</b></div><div class="analysis-card"><span>Serviços no ano</span><b>${yearServices}</b></div><div class="analysis-card"><span>Resultado no ano</span><b>${brl(result)}</b></div>`;
    $('#annualTable').innerHTML=`<table><thead><tr><th>Mês</th><th>Serviços</th><th>Faturamento</th><th>Despesas</th><th>Funcionários</th><th>Resultado</th></tr></thead><tbody>${rows.map(x=>`<tr><td>${months[x.m]}</td><td>${x.s}</td><td>${brl(x.r)}</td><td>${brl(x.x)}</td><td>${brl(x.q)}</td><td class="${x.res>=0?'positive':'negative'}">${brl(x.res)}</td></tr>`).join('')}</tbody></table>`;
  }

  const forms={
    service:{title:'Novo serviço',eyebrow:'NOVA ENTRADA',fields:[['client','Cliente','text','Ex.: João',true],['vehicle','Carro','text','Ex.: Honda Civic',true],['value','Valor','number','0.00',true],['date','Data','date',dateISO(),true],['description','Serviço realizado','text','Ex.: Polimento + vitrificação',false]]},
    expense:{title:'Nova despesa',eyebrow:'NOVA SAÍDA',fields:[['description','Descrição','text','Ex.: Shampoo automotivo',true],['value','Valor','number','0.00',true],['date','Data','date',dateISO(),true],['category','Categoria','select',categories,true],['notes','Observação (opcional)','textarea','',false]]},
    employee:{title:'Novo funcionário',eyebrow:'EQUIPE',fields:[['name','Nome do funcionário','text','Ex.: Carlos',true]]},
    commission:{title:'Nova comissão',eyebrow:'COMISSÃO',fields:[['description','Motivo','text','Ex.: Comissão da semana',true],['value','Valor da comissão','number','0.00',true],['date','Dia','date',dateISO(),true]]}
  };

  function openEntry(type,edit=null,extra={}){
    const f=forms[type]; if(!f) return;
    $('#modalEyebrow').textContent=edit?`EDITAR ${f.eyebrow}`:f.eyebrow;
    $('#modalTitle').textContent=edit?`Editar ${type==='commission'?'comissão':type==='employee'?'funcionário':type==='expense'?'despesa':'serviço'}`:f.title;
    $('#entryForm').innerHTML=f.fields.map(([key,label,input,ph,required])=>{
      const val=edit?(edit[key]??''):(input==='date'?dateISO():type==='commission'&&key==='description'?'Comissão':'');
      if(input==='select') return `<label>${label}<select name="${key}" required>${categories.map(c=>`<option value="${esc(c)}" ${c===val?'selected':''}>${esc(c)}</option>`).join('')}</select></label>`;
      if(input==='textarea') return `<label class="full-field">${label}<textarea name="${key}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;
      return `<label>${label}${required?'':' <span class="optional">(opcional)</span>'}<input name="${key}" type="${input}" ${input==='number'?'min="0" step="0.01"':''} value="${esc(val)}" placeholder="${esc(ph)}" ${required?'required':''}></label>`;
    }).join('')+`<div class="submit-field"><button class="btn primary" type="submit">${edit?'Salvar alterações':'Salvar'}</button></div>`;
    $('#entryForm').dataset.type=type; $('#entryForm').dataset.id=edit?.id||''; $('#entryForm').dataset.employeeId=extra.employeeId||edit?.employeeId||'';
    $('#modal').classList.remove('hidden'); $('#modal').setAttribute('aria-hidden','false');
  }

  function closeEntry(){ $('#modal').classList.add('hidden'); $('#modal').setAttribute('aria-hidden','true'); }

  function saveEntry(ev){
    ev.preventDefault(); const form=ev.currentTarget, type=form.dataset.type, id=form.dataset.id; const fd=new FormData(form), obj={}; fd.forEach((v,k)=>obj[k]=String(v));
    obj.id=id||uid(); obj.value=type==='employee'?undefined:Number(obj.value||0); obj.date=obj.date||dateISO();
    if(type==='service' && (!obj.client?.trim()||!obj.vehicle?.trim())) return notify('Cliente e carro são obrigatórios.');
    if(['service','expense','commission'].includes(type) && !(Number(obj.value)>0)) return notify('Informe um valor maior que zero.');
    if(type==='employee' && !obj.name.trim()) return notify('Informe o nome do funcionário.');
    if(type==='commission' && !form.dataset.employeeId) return notify('Funcionário inválido.');

    if(type==='employee'){
      if(id){ const emp=data.employees.find(e=>e.id===id); if(emp){emp.name=obj.name.trim();} }
      else data.employees.push({id:uid(),name:obj.name.trim(),createdAt:new Date().toISOString()});
      saveData(); closeEntry(); renderAll(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); notify(id?'Funcionário atualizado.':'Funcionário criado.'); return;
    }

    obj.type=type==='service'?'service':type==='expense'?'expense':'payroll';
    if(type==='commission') obj.employeeId=form.dataset.employeeId;
    if(type==='expense') obj.category=obj.category||'Outros';
    if(type==='service') { obj.client=obj.client.trim(); obj.vehicle=obj.vehicle.trim(); }
    if(type==='expense') { obj.description=obj.description.trim(); }
    if(type==='commission') { obj.description=obj.description.trim(); }
    const idx=data.entries.findIndex(e=>e.id===obj.id); if(idx>=0) data.entries[idx]=obj; else data.entries.push(obj);
    saveData(); closeEntry(); renderAll(); if(profileEmployeeId && obj.type==='payroll') openEmployeeProfile(profileEmployeeId); notify(idx>=0?'Lançamento atualizado.':'Lançamento salvo.');
  }

  function deleteEntry(id){ const e=data.entries.find(x=>x.id===id); if(!e) return; if(!confirm('Excluir este lançamento?')) return; data.entries=data.entries.filter(x=>x.id!==id); saveData(); renderAll(); if(profileEmployeeId&&e.type==='payroll') openEmployeeProfile(profileEmployeeId); notify('Lançamento excluído.'); }

  function deleteEmployee(id){
    const emp=data.employees.find(e=>e.id===id); if(!emp) return;
    const history=data.entries.filter(e=>e.type==='payroll'&&e.employeeId===id);
    const msg=history.length?`Excluir ${emp.name} e também os ${history.length} registros de comissão desse funcionário?`:`Excluir ${emp.name}?`;
    if(!confirm(msg)) return;
    data.entries=data.entries.filter(e=>!(e.type==='payroll'&&e.employeeId===id)); data.employees=data.employees.filter(e=>e.id!==id); saveData(); closeEmployeeProfile(); renderAll(); notify('Funcionário excluído.');
  }

  function openMonth(){ const y=selectedMonth.getFullYear(); $('#monthGrid').innerHTML=months.map((m,i)=>`<button class="${i===selectedMonth.getMonth()?'active':''}" data-month="${i}">${m}</button>`).join(''); $('#monthModal').classList.remove('hidden'); }
  function changeMonth(delta){ selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+delta,1); renderAll(); if(profileEmployeeId) openEmployeeProfile(profileEmployeeId); }
  function go(view){ currentView=view; $$('.view').forEach(v=>v.classList.remove('active-view')); $(`#view-${view}`).classList.add('active-view'); $$('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); const labels={dashboard:['VISÃO GERAL','Dashboard'],services:['ENTRADAS','Serviços'],expenses:['SAÍDAS','Despesas'],employees:['EQUIPE','Funcionários'],analysis:['VISÃO ANUAL','Análises'],settings:['EMPRESA','Configurações']}; $('#pageEyebrow').textContent=labels[view][0]; $('#pageTitle').textContent=labels[view][1]; window.scrollTo({top:0,behavior:'smooth'}); document.body.classList.remove('mobile-menu-open'); }

  function download(name,content,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type})); a.download=name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
  function exportJson(){ download('nexo-gestao-backup.json',JSON.stringify({version:2,company:data.company,entries:data.entries,employees:data.employees,ownerName:data.ownerName},null,2),'application/json'); }
  function importJson(file){ const r=new FileReader(); r.onload=()=>{try{const x=JSON.parse(r.result);if(!x||!Array.isArray(x.entries)||!Array.isArray(x.employees)) throw Error(); data={...emptyData(accounts[currentEmail]),...x}; data=migrateData(data); saveData(); renderAll(); notify('Backup restaurado.');}catch{notify('Arquivo de backup inválido.')}}; r.readAsText(file); }
  function exportCsv(){ const rows=[['Tipo','Data','Cliente','Carro','Descrição/Motivo','Categoria','Funcionário','Valor']]; data.entries.filter(e=>e.date.startsWith(String(selectedMonth.getFullYear()))).forEach(e=>{const emp=e.type==='payroll'?data.employees.find(x=>x.id===e.employeeId):null;rows.push([e.type,e.date,e.client||'',e.vehicle||'',e.description||'',e.category||'',emp?.name||'',e.value??'']);}); download(`nexo-gestao-${selectedMonth.getFullYear()}.csv`,rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\n'),'text/csv;charset=utf-8'); }

  $('#loginForm').addEventListener('submit',handleAuth);
  $('#toggleAuth').addEventListener('click',()=>{setAuthMode(authMode==='login'?'register':'login'); $('#loginName').value=''; $('#loginEmail').focus();});
  $('#logoutBtn').addEventListener('click',()=>{localStorage.removeItem(SESSION_KEY); closeEntry(); closeEmployeeProfile(); ensureSession(); setAuthMode('login'); notify('Você saiu da conta.');});
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
  $('#headerAdd').addEventListener('click',()=>openEntry('service')); $('#mobileAdd').addEventListener('click',()=>openEntry('service'));
  $$('[data-add-type]').forEach(b=>b.addEventListener('click',()=>openEntry(b.dataset.addType)));
  $('#newEmployeeBtn').addEventListener('click',()=>openEntry('employee'));
  $('#monthPrev').addEventListener('click',()=>changeMonth(-1)); $('#monthNext').addEventListener('click',()=>changeMonth(1)); $('#monthLabel').addEventListener('click',openMonth);
  $('#monthModal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop,[data-close-month]'))$('#monthModal').classList.add('hidden');if(e.target.matches('[data-month]')){selectedMonth=new Date(selectedMonth.getFullYear(),Number(e.target.dataset.month),1);$('#monthModal').classList.add('hidden');renderAll();if(profileEmployeeId)openEmployeeProfile(profileEmployeeId)}});
  $('#closeModal').addEventListener('click',closeEntry); $('#modal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop'))closeEntry()}); $('#entryForm').addEventListener('submit',saveEntry);
  $('#employeeModal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop,[data-close-employee]'))closeEmployeeProfile()});
  $('#serviceSearch').addEventListener('input',renderServices); $('#expenseSearch').addEventListener('input',renderExpenses); $('#expenseCategoryFilter').addEventListener('change',renderExpenses);
  document.addEventListener('click',e=>{
    const editEntry=e.target.closest('[data-edit-entry]'), delEntry=e.target.closest('[data-delete-entry]'), openEmp=e.target.closest('[data-open-employee]'), editEmp=e.target.closest('[data-edit-employee]'), delEmp=e.target.closest('[data-delete-employee]'), addCom=e.target.closest('[data-add-commission]');
    if(delEntry){deleteEntry(delEntry.dataset.deleteEntry);return;}
    if(editEntry){const item=data.entries.find(x=>x.id===editEntry.dataset.editEntry);if(item)openEntry(item.type==='payroll'?'commission':item.type,item);return;}
    if(openEmp){openEmployeeProfile(openEmp.dataset.openEmployee);return;}
    if(editEmp){const emp=data.employees.find(x=>x.id===editEmp.dataset.editEmployee);if(emp)openEntry('employee',emp);return;}
    if(delEmp){deleteEmployee(delEmp.dataset.deleteEmployee);return;}
    if(addCom){openEntry('commission',null,{employeeId:addCom.dataset.addCommission});return;}
  });
  $('#saveCompany').addEventListener('click',()=>{data.company.name=$('#companyName').value.trim()||'Minha empresa';data.company.short=$('#companyShort').value.trim()||data.company.name;saveData();renderAll();notify('Dados da empresa salvos.')});
  $('#exportJson').addEventListener('click',exportJson); $('#importJson').addEventListener('change',e=>e.target.files[0]&&importJson(e.target.files[0])); $('#clearData').addEventListener('click',()=>{if(!confirm('Isso apagará todos os serviços, despesas e comissões desta conta neste navegador. Continuar?'))return;data.entries=[];saveData();renderAll();notify('Dados apagados.');}); $('#exportCsvBtn').addEventListener('click',exportCsv); $('#mobileMenu').addEventListener('click',()=>document.body.classList.toggle('mobile-menu-open'));
  setAuthMode('login');
  ensureSession();
})();
