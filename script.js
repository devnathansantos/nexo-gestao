(() => {
  'use strict';
  const KEY='nexo_gestao_v1';
  const SESSION='nexo_session_v1';
  const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const categories=['Produtos','Combustível','Manutenção','Equipamentos','Aluguel','Energia','Água','Internet','Impostos','Outros'];
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const brl=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
  const dateISO=()=>new Date().toISOString().slice(0,10);
  const monthKey=d=>{const x=new Date(d+'T12:00:00');return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}`};
  const uid=()=>crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2);
  const defaultData=()=>({version:1,company:{name:'Central Estética Automotiva',short:'Central Estética'},entries:[],employees:[],createdAt:new Date().toISOString()});
  let data=load();
  let selectedMonth=new Date();
  let currentView='dashboard';

  function load(){try{return JSON.parse(localStorage.getItem(KEY))||defaultData()}catch{return defaultData()}}
  function save(){localStorage.setItem(KEY,JSON.stringify(data))}
  function currentKey(){return `${selectedMonth.getFullYear()}-${String(selectedMonth.getMonth()+1).padStart(2,'0')}`}
  function entriesFor(k=currentKey()){return data.entries.filter(e=>monthKey(e.date)===k)}
  function services(k=currentKey()){return entriesFor(k).filter(e=>e.type==='service')}
  function expenses(k=currentKey()){return entriesFor(k).filter(e=>e.type==='expense')}
  function payroll(k=currentKey()){return entriesFor(k).filter(e=>e.type==='payroll')}
  function total(arr){return arr.reduce((s,e)=>s+Number(e.value||0),0)}
  function esc(v){return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function initials(s){return String(s||'').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'NX'}
  function fmtDate(d){return new Date(d+'T12:00:00').toLocaleDateString('pt-BR')}
  function notify(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2500)}
  function ensureSession(){if(localStorage.getItem(SESSION)==='1'){$('#loginScreen').classList.add('hidden');$('#app').classList.remove('hidden');renderAll()}else{$('#loginScreen').classList.remove('hidden');$('#app').classList.add('hidden')}}

  function renderAll(){
    $('#companyName').value=data.company.name;$('#companyShort').value=data.company.short;
    $('#monthLabel').textContent=`${months[selectedMonth.getMonth()]} ${selectedMonth.getFullYear()}`;
    $('#dashboardGreeting').textContent=`Olá, vamos aos números de ${months[selectedMonth.getMonth()].toLowerCase()}.`;
    renderDashboard();renderServices();renderExpenses();renderEmployees();renderAnalysis();
  }

  function renderDashboard(){
    const ss=services(), es=expenses(), ps=payroll(), rev=total(ss), exp=total(es), pay=total(ps), result=rev-exp-pay;
    $('#metricRevenue').textContent=brl(rev);$('#metricRevenueSub').textContent=`${ss.length} ${ss.length===1?'serviço':'serviços'} registrados`;
    $('#metricExpenses').textContent=brl(exp);$('#metricExpensesSub').textContent=`${es.length} ${es.length===1?'lançamento':'lançamentos'}`;
    $('#metricPayroll').textContent=brl(pay);$('#metricPayrollSub').textContent=`${ps.length} ${ps.length===1?'pagamento':'pagamentos'}`;
    $('#metricResult').textContent=brl(result);$('#metricResult').style.color=result>=0?'#ffffff':'#ffb7bd';
    const last=ss.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5);
    $('#recentServices').innerHTML=last.length?last.map(e=>`<div class="list-row"><div class="row-avatar">${initials(e.client||e.vehicle)}</div><div class="row-main"><b>${esc(e.vehicle||e.client)}</b><small>${esc(e.description)} · ${fmtDate(e.date)}</small></div><div class="row-value">${brl(e.value)}</div></div>`).join(''):`<div class="empty">Nenhum serviço neste mês.</div>`;
    const empTotals={};ps.forEach(p=>empTotals[p.employee]=(empTotals[p.employee]||0)+Number(p.value));const emp=Object.entries(empTotals).sort((a,b)=>b[1]-a[1]).slice(0,4);
    $('#teamSummary').innerHTML=emp.length?emp.map(([name,val])=>`<div class="team-row"><div class="row-avatar">${initials(name)}</div><div class="row-main"><b>${esc(name)}</b><small>Comissões no mês</small></div><div class="row-value">${brl(val)}</div></div>`).join(''):`<div class="empty">Nenhuma comissão registrada.</div>`;
    renderRevenueChart();renderExpenseDonut();
  }
  function renderRevenueChart(){
    const vals=[];const base=new Date(selectedMonth);for(let i=5;i>=0;i--){const d=new Date(base.getFullYear(),base.getMonth()-i,1);const k=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;vals.push({label:months[d.getMonth()].slice(0,3),value:total(services(k))})}const max=Math.max(...vals.map(x=>x.value),1);
    $('#revenueChart').innerHTML=vals.map(x=>`<div class="bar-col"><b>${x.value?brl(x.value).replace('R$ ','R$ ').replace(',00',''):''}</b><div class="bar" style="height:${Math.max(4,x.value/max*145)}px"></div><small>${x.label}</small></div>`).join('');
  }
  function renderExpenseDonut(){
    const es=expenses();const map={};es.forEach(e=>map[e.category]=(map[e.category]||0)+Number(e.value));const rows=Object.entries(map).sort((a,b)=>b[1]-a[1]);const colors=['#1477f8','#47b6ff','#7b61d1','#5cc88c','#f3a84a'];const totalExp=total(es);$('#donutTotal').textContent=brl(totalExp).replace(',00','');
    let acc=0;const stops=rows.length?rows.map(([c,v],i)=>{const p=v/totalExp*100;const s=`${colors[i%colors.length]} ${acc}% ${acc+p}%`;acc+=p;return s}).join(','):'#e8edf2 0 100%';$('.donut').style.background=`conic-gradient(${stops})`;
    $('#donutLegend').innerHTML=rows.length?rows.slice(0,5).map(([c,v],i)=>`<div class="legend-row"><span class="legend-left"><i style="background:${colors[i%colors.length]}"></i>${esc(c)}</span><b>${brl(v)}</b></div>`).join(''):`<span class="muted">Sem despesas no período.</span>`;
  }

  function renderServices(){
    const q=($('#serviceSearch')?.value||'').toLowerCase();const arr=services().filter(e=>`${e.client} ${e.vehicle} ${e.description}`.toLowerCase().includes(q));$('#serviceCount').textContent=`${arr.length} ${arr.length===1?'serviço':'serviços'}`;
    $('#servicesList').innerHTML=`<div class="table-head"><span>Cliente / carro</span><span>Serviço</span><span>Data</span><span>Valor</span><span></span></div>${arr.length?arr.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<div class="table-row"><div><b>${esc(e.vehicle||e.client)}</b><small>${esc(e.client||'')}</small></div><div>${esc(e.description)}</div><div>${fmtDate(e.date)}</div><div><b>${brl(e.value)}</b></div><div class="row-actions"><button class="icon-action" data-edit="${e.id}" title="Editar">✎</button><button class="icon-action danger-action" data-delete="${e.id}" title="Excluir">×</button></div></div>`).join(''):`<div class="empty">Nenhum serviço encontrado.</div>`}`;
  }
  function renderExpenses(){
    const q=($('#expenseSearch')?.value||'').toLowerCase(),cat=$('#expenseCategoryFilter')?.value||'all';let arr=expenses().filter(e=>(cat==='all'||e.category===cat)&&`${e.description} ${e.category}`.toLowerCase().includes(q));
    $('#expenseMiniStats').innerHTML=`<div class="mini-stat"><span>Total do mês</span><b>${brl(total(expenses()))}</b></div><div class="mini-stat"><span>Maior categoria</span><b>${esc(topCategory())}</b></div><div class="mini-stat"><span>Lançamentos</span><b>${expenses().length}</b></div>`;
    $('#expensesList').innerHTML=`<div class="table-head"><span>Descrição</span><span>Categoria</span><span>Data</span><span>Valor</span><span></span></div>${arr.length?arr.slice().sort((a,b)=>b.date.localeCompare(a.date)).map(e=>`<div class="table-row"><div><b>${esc(e.description)}</b><small>${esc(e.notes||'')}</small></div><div>${esc(e.category)}</div><div>${fmtDate(e.date)}</div><div><b>${brl(e.value)}</b></div><div class="row-actions"><button class="icon-action" data-edit="${e.id}">✎</button><button class="icon-action danger-action" data-delete="${e.id}">×</button></div></div>`).join(''):`<div class="empty">Nenhuma despesa encontrada.</div>`}`;
  }
  function topCategory(){const m={};expenses().forEach(e=>m[e.category]=(m[e.category]||0)+Number(e.value));const x=Object.entries(m).sort((a,b)=>b[1]-a[1])[0];return x?x[0]:'—'}
  function renderEmployees(){
    const names=[...new Set([...data.employees,...payroll().map(x=>x.employee)])];
    $('#employeeCards').innerHTML=names.length?names.map(name=>{const val=total(payroll().filter(x=>x.employee===name));return `<article class="employee-card"><div class="emp-top"><div class="emp-avatar">${initials(name)}</div><div><h3>${esc(name)}</h3><small>Comissões em ${months[selectedMonth.getMonth()].toLowerCase()}</small></div></div><strong>${brl(val)}</strong><small>${payroll().filter(x=>x.employee===name).length} pagamento(s)</small></article>`}).join(''):`<article class="employee-card"><div class="emp-top"><div class="emp-avatar">+</div><div><h3>Nenhum funcionário</h3><small>Registre a primeira comissão</small></div></div></article>`;
    const arr=payroll().slice().sort((a,b)=>b.date.localeCompare(a.date));$('#payrollList').innerHTML=`<div class="table-head"><span>Funcionário</span><span>Referência</span><span>Data</span><span>Valor</span><span></span></div>${arr.length?arr.map(e=>`<div class="table-row"><div><b>${esc(e.employee)}</b></div><div>${esc(e.description||'Comissão')}</div><div>${fmtDate(e.date)}</div><div><b>${brl(e.value)}</b></div><div class="row-actions"><button class="icon-action" data-edit="${e.id}">✎</button><button class="icon-action danger-action" data-delete="${e.id}">×</button></div></div>`).join(''):`<div class="empty">Nenhuma comissão registrada neste mês.</div>`}`;
  }
  function renderAnalysis(){
    const y=selectedMonth.getFullYear();let yr=[];for(let m=0;m<12;m++){const k=`${y}-${String(m+1).padStart(2,'0')}`,s=services(k),e=expenses(k),p=payroll(k),r=total(s),x=total(e),q=total(p);yr.push({m,r,x,q,res:r-x-q,s:s.length})}
    const yearRev=total(yr.map(x=>({value:x.r}))),yearExp=total(yr.map(x=>({value:x.x}))),yearPay=total(yr.map(x=>({value:x.q})));$('#analysisCards').innerHTML=`<div class="analysis-card"><span>Faturamento no ano</span><b>${brl(yearRev)}</b></div><div class="analysis-card"><span>Despesas no ano</span><b>${brl(yearExp)}</b></div><div class="analysis-card"><span>Resultado no ano</span><b>${brl(yearRev-yearExp-yearPay)}</b></div>`;
    $('#annualTable').innerHTML=`<table><thead><tr><th>Mês</th><th>Serviços</th><th>Faturamento</th><th>Despesas</th><th>Funcionários</th><th>Resultado</th></tr></thead><tbody>${yr.map(x=>`<tr><td>${months[x.m]}</td><td>${x.s}</td><td>${brl(x.r)}</td><td>${brl(x.x)}</td><td>${brl(x.q)}</td><td class="${x.res>=0?'positive':'negative'}">${brl(x.res)}</td></tr>`).join('')}</tbody></table>`;
  }

  const forms={
    service:{title:'Novo serviço',eyebrow:'NOVA ENTRADA',fields:[['client','Cliente','text','Ex.: João'],['vehicle','Carro / identificação','text','Ex.: Honda Civic'],['description','Serviço realizado','text','Ex.: Polimento + vitrificação'],['date','Data','date',dateISO()],['value','Valor','number','0.00']]},
    expense:{title:'Nova despesa',eyebrow:'NOVA SAÍDA',fields:[['description','Descrição','text','Ex.: Shampoo automotivo'],['category','Categoria','select',categories],['date','Data','date',dateISO()],['value','Valor','number','0.00'],['notes','Observação (opcional)','textarea','']]},
    employee:{title:'Registrar comissão',eyebrow:'EQUIPE',fields:[['employee','Funcionário','text','Nome do funcionário'],['description','Referência','text','Ex.: Comissão da semana'],['date','Data','date',dateISO()],['value','Valor da comissão','number','0.00']]}
  };
  function openEntry(type,edit=null){const f=forms[type];if(!f)return;$('#modalEyebrow').textContent=edit?`EDITAR ${f.eyebrow}`:f.eyebrow;$('#modalTitle').textContent=edit?`Editar ${f.title.replace('Novo ','').replace('Nova ','')}`:f.title;const fields=f.fields;$('#entryForm').innerHTML=fields.map(([key,label,input,ph])=>{const val=edit?(edit[key]??''):(input==='date'?dateISO():'');if(input==='select')return `<label>${label}<select name="${key}" required>${categories.map(c=>`<option ${c===val?'selected':''}>${c}</option>`).join('')}</select></label>`;if(input==='textarea')return `<label class="full-field">${label}<textarea name="${key}" placeholder="${esc(ph)}">${esc(val)}</textarea></label>`;return `<label>${label}<input name="${key}" type="${input}" ${input==='number'?'min="0" step="0.01"':''} value="${esc(val)}" placeholder="${esc(ph)}" required></label>`}).join('')+`<div class="submit-field"><button class="btn primary" type="submit">${edit?'Salvar alterações':'Salvar lançamento'}</button></div>`;$('#entryForm').dataset.type=type;$('#entryForm').dataset.id=edit?.id||'';$('#modal').classList.remove('hidden');$('#modal').setAttribute('aria-hidden','false')}
  function closeEntry(){$('#modal').classList.add('hidden');$('#modal').setAttribute('aria-hidden','true')}
  function saveEntry(ev){ev.preventDefault();const form=ev.currentTarget,type=form.dataset.type,id=form.dataset.id;const fd=new FormData(form);const obj={};fd.forEach((v,k)=>obj[k]=v);obj.id=id||uid();obj.type=type==='service'?'service':type==='expense'?'expense':'payroll';obj.value=Number(obj.value||0);if(!obj.date)obj.date=dateISO();if(type==='employee'&&!obj.employee.trim()){notify('Informe o funcionário.');return}const idx=data.entries.findIndex(e=>e.id===obj.id);if(idx>=0)data.entries[idx]=obj;else data.entries.push(obj);if(type==='employee'&&!data.employees.includes(obj.employee))data.employees.push(obj.employee);save();closeEntry();renderAll();notify(idx>=0?'Lançamento atualizado.':'Lançamento salvo.');}
  function deleteEntry(id){const e=data.entries.find(x=>x.id===id);if(!e)return;if(!confirm('Excluir este lançamento?'))return;data.entries=data.entries.filter(x=>x.id!==id);save();renderAll();notify('Lançamento excluído.')}

  function openMonth(){const y=selectedMonth.getFullYear();$('#monthGrid').innerHTML=months.map((m,i)=>`<button class="${i===selectedMonth.getMonth()?'active':''}" data-month="${i}">${m}</button>`).join('');$('#monthModal').classList.remove('hidden')}
  function changeMonth(delta){selectedMonth=new Date(selectedMonth.getFullYear(),selectedMonth.getMonth()+delta,1);renderAll()}
  function go(view){currentView=view;$$('.view').forEach(v=>v.classList.remove('active-view'));$(`#view-${view}`).classList.add('active-view');$$('.nav-item[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===view));const labels={dashboard:['VISÃO GERAL','Dashboard'],services:['ENTRADAS','Serviços'],expenses:['SAÍDAS','Despesas'],employees:['EQUIPE','Funcionários'],analysis:['VISÃO ANUAL','Análises'],settings:['EMPRESA','Configurações']};$('#pageEyebrow').textContent=labels[view][0];$('#pageTitle').textContent=labels[view][1];window.scrollTo({top:0,behavior:'smooth'});document.body.classList.remove('mobile-menu-open')}

  function seedDemo(){if(data.entries.length&&!confirm('Isso adicionará dados de demonstração aos dados atuais. Continuar?'))return;const y=selectedMonth.getFullYear(),m=String(selectedMonth.getMonth()+1).padStart(2,'0');const d=n=>`${y}-${m}-${String(n).padStart(2,'0')}`;data.employees=[...new Set([...data.employees,'Carlos','Marcos','Lucas'])];data.entries.push(...[
    ['service','João','Honda Civic','Polimento + vitrificação',d(2),850],['service','Ana','Toyota Corolla','Lavagem técnica + proteção',d(4),420],['service','Pedro','BMW 320i','Polimento técnico',d(6),780],['service','Rafael','Jeep Compass','Vitrificação cerâmica',d(8),1200],['service','Marina','T-Cross','Higienização interna',d(10),350],['expense',null,null,'Shampoo automotivo',d(3),180,'Produtos'],['expense',null,null,'Combustível',d(5),260,'Combustível'],['expense',null,null,'Politriz — manutenção',d(7),320,'Manutenção'],['expense',null,null,'Energia elétrica',d(9),410,'Energia'],['payroll',null,null,'Comissão semanal',d(6),280,'','Carlos'],['payroll',null,null,'Comissão semanal',d(13),340,'','Marcos']].map(x=>x[0]==='service'?{id:uid(),type:'service',client:x[1],vehicle:x[2],description:x[3],date:x[4],value:x[5]}:x[0]==='expense'?{id:uid(),type:'expense',description:x[3],date:x[4],value:x[5],category:x[6]}:{id:uid(),type:'payroll',description:x[3],date:x[4],value:x[5],employee:x[7]}));save();renderAll();notify('Dados de demonstração carregados.')}
  function clearData(){if(!confirm('Isso apagará todos os lançamentos deste navegador. Continuar?'))return;data.entries=[];save();renderAll();notify('Lançamentos apagados.')}
  function download(name,content,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  function exportJson(){download('nexo-gestao-backup.json',JSON.stringify(data,null,2),'application/json')}
  function importJson(file){const r=new FileReader();r.onload=()=>{try{const x=JSON.parse(r.result);if(!x||!Array.isArray(x.entries))throw Error();data={...defaultData(),...x};save();renderAll();notify('Backup restaurado.')}catch{notify('Arquivo de backup inválido.')}};r.readAsText(file)}
  function exportCsv(){const rows=[['Tipo','Data','Descrição','Cliente','Carro','Categoria','Funcionário','Valor']];data.entries.filter(e=>e.date.startsWith(String(selectedMonth.getFullYear()))).forEach(e=>rows.push([e.type,e.date,e.description||'',e.client||'',e.vehicle||'',e.category||'',e.employee||'',e.value]));download(`nexo-gestao-${selectedMonth.getFullYear()}.csv`,rows.map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(';')).join('\n'),'text/csv;charset=utf-8')}

  $('#loginForm').addEventListener('submit',e=>{e.preventDefault();localStorage.setItem(SESSION,'1');ensureSession();notify('Bem-vindo ao NEXO Gestão.')});$('#demoLogin').addEventListener('click',()=>{localStorage.setItem(SESSION,'1');ensureSession();if(!data.entries.length)seedDemo()});$('#logoutBtn').addEventListener('click',()=>{localStorage.removeItem(SESSION);ensureSession()});
  $$('[data-view]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));$('#headerAdd').addEventListener('click',()=>openEntry('service'));$('#mobileAdd').addEventListener('click',()=>openEntry('service'));$$('[data-add-type]').forEach(b=>b.addEventListener('click',()=>openEntry(b.dataset.addType)));
  $('#monthPrev').addEventListener('click',()=>changeMonth(-1));$('#monthNext').addEventListener('click',()=>changeMonth(1));$('#monthLabel').addEventListener('click',openMonth);$('#monthModal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop,[data-close-month]'))$('#monthModal').classList.add('hidden');if(e.target.matches('[data-month]')){selectedMonth=new Date(selectedMonth.getFullYear(),Number(e.target.dataset.month),1);$('#monthModal').classList.add('hidden');renderAll()}});
  $('#closeModal').addEventListener('click',closeEntry);$('#modal').addEventListener('click',e=>{if(e.target.matches('.modal-backdrop'))closeEntry()});$('#entryForm').addEventListener('submit',saveEntry);
  $('#serviceSearch').addEventListener('input',renderServices);$('#expenseSearch').addEventListener('input',renderExpenses);$('#expenseCategoryFilter').addEventListener('change',renderExpenses);
  document.addEventListener('click',e=>{const del=e.target.closest('[data-delete]'),edit=e.target.closest('[data-edit]');if(del)deleteEntry(del.dataset.delete);if(edit){const item=data.entries.find(x=>x.id===edit.dataset.edit);if(item)openEntry(item.type==='payroll'?'employee':item.type,item)}});
  $('#saveCompany').addEventListener('click',()=>{data.company.name=$('#companyName').value.trim()||'Minha empresa';data.company.short=$('#companyShort').value.trim()||data.company.name;save();notify('Dados da empresa salvos.')});$('#exportJson').addEventListener('click',exportJson);$('#importJson').addEventListener('change',e=>e.target.files[0]&&importJson(e.target.files[0]));$('#seedDemo').addEventListener('click',seedDemo);$('#clearData').addEventListener('click',clearData);$('#exportCsvBtn').addEventListener('click',exportCsv);$('#mobileMenu').addEventListener('click',()=>document.body.classList.toggle('mobile-menu-open'));
  if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  ensureSession();
})();
