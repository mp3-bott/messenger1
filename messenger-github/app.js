(() => {
  const C = window.MESSENGER_CONFIG || {};
  const configured = C.supabaseUrl && C.supabaseKey && !C.supabaseUrl.includes('YOUR_') && !C.supabaseKey.includes('YOUR_');
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  let sb = null, user = null, profile = null, currentChat = null, currentPartner = null, realtime = null, isOwner = false, mediaRecorder = null, voiceChunks = [], voiceStartedAt = 0, voiceStream = null;
  const themes = [
    ['midnight','Midnight','◐'],['amoled','AMOLED','●'],['aurora','Aurora','✦'],['ocean','Ocean','◈'],['sunset','Sunset','◒'],['light','Light','○']
  ];

  const toast = (msg, bad=false) => { const el=$('#toast'); el.textContent=msg; el.className='toast show'+(bad?' bad':''); setTimeout(()=>el.className='toast',2600); };
  const esc = s => String(s??'').replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const initials = s => (s||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  const fmt = d => { const x=new Date(d); return x.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}); };
  const avatar = (p, cls='avatar') => `<div class="${cls}">${esc(initials(p?.display_name || p?.username))}</div>`;

  function applyTheme(name){ document.body.dataset.theme=name; localStorage.setItem('line-theme',name); $$('.theme-option').forEach(x=>x.classList.toggle('active',x.dataset.theme===name)); }
  function renderThemes(){ $('#themeGrid').innerHTML=themes.map(([id,n,ico])=>`<button class="theme-option ${localStorage.getItem('line-theme')===id?'active':''}" data-theme="${id}"><span>${ico}</span><b>${n}</b></button>`).join(''); $$('.theme-option').forEach(b=>b.onclick=()=>applyTheme(b.dataset.theme)); }

  async function init(){
    applyTheme(localStorage.getItem('line-theme') || 'midnight'); renderThemes();
    $$('.tab').forEach(t=>t.onclick=()=>setAuthMode(t.dataset.auth));
    $('#authForm').onsubmit=authSubmit; $('#logoutBtn').onclick=logout;
    $('#settingsBtn').onclick=()=>$('#settingsPanel').classList.remove('hidden'); $('#voiceBtn').onclick=toggleVoiceRecording; $('#closeSettings').onclick=()=>$('#settingsPanel').classList.add('hidden'); $('#adminBtn').onclick=openAdmin; $('#closeAdmin').onclick=()=>$('#adminPanel').classList.add('hidden'); $('#adminUserSearch').oninput=debounce(loadAdminUsers,250);
    $('#saveProfileBtn').onclick=saveProfile; $('#searchInput').oninput=debounce(searchUsers,250);
    $('#messageForm').onsubmit=sendMessage; $('#backBtn').onclick=()=>$('#chatView').classList.add('hidden');
    $('#emojiBtn').onclick=()=>$('#messageInput').value += ' 🙂';
    document.addEventListener('keydown',e=>{if(e.key==='/' && document.activeElement.tagName!=='INPUT'){e.preventDefault();$('#searchInput').focus()}});
    if(!configured){ $('#configHint').classList.remove('hidden'); return; }
    sb = window.supabase.createClient(C.supabaseUrl,C.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
    const {data:{session}}=await sb.auth.getSession(); if(session) await enter(session.user); sb.auth.onAuthStateChange(async(_e,s)=>{if(s?.user) await enter(s.user); else showAuth();});
  }
  function setAuthMode(mode){ $$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.auth===mode)); $('#usernameWrap').classList.toggle('hidden',mode!=='signup'); $('#authSubmit').textContent=mode==='signup'?'Создать аккаунт':'Войти'; $('#authForm').dataset.mode=mode; }
  async function authSubmit(e){e.preventDefault(); if(!configured)return toast('Сначала настрой config.js',true); const mode=$('#authForm').dataset.mode||'login'; const email=$('#email').value.trim(), password=$('#password').value; $('#authSubmit').disabled=true;
    try{
      if(mode==='signup'){
        const username=$('#username').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,''); if(username.length<3) throw Error('Username: минимум 3 символа.');
        const {data,error}=await sb.auth.signUp({email,password,options:{data:{username}}}); if(error)throw error; if(!data.session) toast('Проверь почту для подтверждения аккаунта.'); else toast('Аккаунт создан.');
      } else { const {data,error}=await sb.auth.signInWithPassword({email,password}); if(error)throw error; await enter(data.user); }
    }catch(err){toast(err.message||'Ошибка',true)}finally{$('#authSubmit').disabled=false}
  }
  async function enter(u){ user=u; const {data,error}=await sb.from('profiles').select('*').eq('id',u.id).single(); if(error){console.error(error); toast('Не удалось загрузить профиль',true);return;} profile=data; const ownerRes=await sb.from('app_owner').select('owner_user_id').eq('singleton',true).maybeSingle(); isOwner=ownerRes.data?.owner_user_id===user.id; showApp(); await loadChats(); subscribe(); fillSettings(); if(isOwner) $('#adminBtn').classList.remove('hidden'); else $('#adminBtn').classList.add('hidden'); }
  function showApp(){ $('#authView').classList.add('hidden'); $('#appView').classList.remove('hidden'); $('#meCard').innerHTML=avatar(profile)+`<div><b>${esc(profile.display_name||profile.username)}</b><small>@${esc(profile.username)}</small></div><span class="online-dot"></span>`; }
  function showAuth(){ user=profile=null; isOwner=false; currentChat=null; $('#adminBtn').classList.add('hidden'); $('#adminPanel').classList.add('hidden'); $('#appView').classList.add('hidden'); $('#authView').classList.remove('hidden'); }
  async function logout(){if(realtime)await sb.removeChannel(realtime); await sb.auth.signOut();}

  async function loadChats(){
    const {data,error}=await sb.from('conversations').select('id,user_a,user_b').or(`user_a.eq.${user.id},user_b.eq.${user.id}`); if(error){toast(error.message,true);return;}
    const ids=(data||[]).map(c=>c.user_a===user.id?c.user_b:c.user_a); if(!ids.length){$('#chatList').innerHTML='<div class="no-chats">Пока нет диалогов.<br>Найди пользователя выше.</div>';return;}
    const {data:people}=await sb.from('profiles').select('*').in('id',ids); const map=new Map((people||[]).map(p=>[p.id,p]));
    $('#chatList').innerHTML=(data||[]).map(c=>{const pid=c.user_a===user.id?c.user_b:c.user_a,p=map.get(pid)||{};return `<button class="chat-item" data-id="${c.id}" data-partner="${pid}">${avatar(p)}<span class="chat-item-main"><b>${esc(p.display_name||p.username||'Пользователь')}</b><small>@${esc(p.username||'')}</small></span><span class="chat-time"></span></button>`}).join('');
    $$('.chat-item').forEach(b=>b.onclick=()=>openChat(b.dataset.id,b.dataset.partner));
  }
  async function searchUsers(){ const q=$('#searchInput').value.trim().toLowerCase(); if(!q){await loadChats();return;} const {data,error}=await sb.from('profiles').select('*').neq('id',user.id).or(`username.ilike.%${q}%,display_name.ilike.%${q}%`).limit(20); if(error)return; $('#chatList').innerHTML=(data||[]).map(p=>`<button class="chat-item search-result" data-id="new" data-partner="${p.id}">${avatar(p)}<span class="chat-item-main"><b>${esc(p.display_name||p.username)}</b><small>@${esc(p.username)}</small></span><span>›</span></button>`).join('') || '<div class="no-chats">Ничего не найдено.</div>'; $$('.search-result').forEach(b=>b.onclick=()=>openChat('new',b.dataset.partner)); }
  async function openChat(chatId,partnerId){ const {data:p,error}=await sb.from('profiles').select('*').eq('id',partnerId).single(); if(error)return toast(error.message,true); currentPartner=p;
    if(chatId==='new'){ const a=[user.id,partnerId].sort(); const {data:c,error:e}=await sb.from('conversations').upsert({user_a:a[0],user_b:a[1]},{onConflict:'user_a,user_b'}).select().single(); if(e)return toast(e.message,true); currentChat=c; } else {const {data:c,error:e}=await sb.from('conversations').select('*').eq('id',chatId).single(); if(e)return toast(e.message,true);currentChat=c;}
    $('#emptyState').classList.add('hidden'); $('#chatView').classList.remove('hidden'); $('#chatUserAvatar').textContent=initials(p.display_name||p.username); $('#chatUserName').textContent=p.display_name||p.username; $('#chatUserStatus').textContent='в сети'; await loadMessages(); await loadChats(); }
  async function loadMessages(){ const {data,error}=await sb.from('messages').select('*').eq('conversation_id',currentChat.id).order('created_at',{ascending:true}).limit(500); if(error)return toast(error.message,true); $('#messages').innerHTML=(data||[]).map(renderMessage).join(''); scrollBottom(); }
  function renderMessage(m){ const mine=m.sender_id===user.id; if(m.message_type==='voice' && m.media_url){ return `<div class="msg-row ${mine?'mine':''}"><div class="bubble voice-bubble"><audio controls preload="metadata" src="${esc(m.media_url)}"></audio><small>${fmt(m.created_at)}</small></div></div>`; } return `<div class="msg-row ${mine?'mine':''}"><div class="bubble"><div>${esc(m.content||'').replace(/\n/g,'<br>')}</div><small>${fmt(m.created_at)}</small></div></div>`; }
  async function sendMessage(e){e.preventDefault(); const content=$('#messageInput').value.trim(); if(!content||!currentChat)return; $('#messageInput').value=''; const {error}=await sb.from('messages').insert({conversation_id:currentChat.id,sender_id:user.id,content,message_type:'text'}); if(error){toast(error.message,true);$('#messageInput').value=content;} }
  async function toggleVoiceRecording(){
    if(mediaRecorder){ mediaRecorder.stop(); return; }
    if(!currentChat) return toast('Сначала открой чат',true);
    if(!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Браузер не поддерживает запись голосовых',true);
    try{
      voiceStream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mime=['audio/webm;codecs=opus','audio/webm','audio/mp4'].find(x=>MediaRecorder.isTypeSupported(x)) || '';
      mediaRecorder=new MediaRecorder(voiceStream,mime?{mimeType:mime}:undefined);
      voiceChunks=[]; voiceStartedAt=Date.now();
      mediaRecorder.ondataavailable=e=>{if(e.data.size)voiceChunks.push(e.data)};
      mediaRecorder.onstop=async()=>{
        const duration=Math.max(1,Math.round((Date.now()-voiceStartedAt)/1000));
        const type=mediaRecorder.mimeType||'audio/webm';
        const ext=type.includes('mp4')?'m4a':'webm';
        const blob=new Blob(voiceChunks,{type});
        mediaRecorder=null; voiceStream?.getTracks().forEach(t=>t.stop()); voiceStream=null;
        $('#voiceBtn').textContent='🎙'; $('#voiceBtn').classList.remove('recording');
        if(blob.size>10*1024*1024) return toast('Голосовое слишком большое',true);
        try{
          const path=`${user.id}/${currentChat.id}/${Date.now()}.${ext}`;
          const up=await sb.storage.from('voice-messages').upload(path,blob,{contentType:type,upsert:false});
          if(up.error)throw up.error;
          const pub=sb.storage.from('voice-messages').getPublicUrl(path);
          const {error}=await sb.from('messages').insert({conversation_id:currentChat.id,sender_id:user.id,content:'Голосовое сообщение',message_type:'voice',media_url:pub.data.publicUrl,duration});
          if(error)throw error;
          toast('Голосовое отправлено');
        }catch(e){toast(e.message||'Не удалось отправить голосовое',true)}
      };
      mediaRecorder.start(); $('#voiceBtn').textContent='⏹'; $('#voiceBtn').classList.add('recording'); toast('Запись идёт… нажми ещё раз, чтобы отправить');
    }catch(e){toast('Нет доступа к микрофону',true)}
  }
  function subscribe(){ if(realtime)sb.removeChannel(realtime); realtime=sb.channel('line-messages').on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},payload=>{if(currentChat&&payload.new.conversation_id===currentChat.id){$('#messages').insertAdjacentHTML('beforeend',renderMessage(payload.new));scrollBottom();} loadChats();}).subscribe(); }
  function scrollBottom(){const x=$('#messages');requestAnimationFrame(()=>x.scrollTop=x.scrollHeight)}
  function fillSettings(){ $('#displayNameInput').value=profile.display_name||''; $('#profileUsernameInput').value=profile.username||''; $('#accountEmail').textContent=user.email||''; }
  async function saveProfile(){const display_name=$('#displayNameInput').value.trim()||profile.username; const username=$('#profileUsernameInput').value.trim().toLowerCase().replace(/[^a-z0-9_]/g,''); if(username.length<3)return toast('Username слишком короткий',true); const {data,error}=await sb.from('profiles').update({display_name,username}).eq('id',user.id).select().single(); if(error)return toast(error.message,true);profile=data;showApp();fillSettings();toast('Профиль сохранён');}

  async function openAdmin(){
    if(!isOwner)return toast('Доступ запрещён',true);
    $('#adminPanel').classList.remove('hidden');
    await loadAdminUsers();
  }
  async function loadAdminUsers(){
    if(!isOwner)return;
    const q=$('#adminUserSearch').value.trim().toLowerCase();
    let query=sb.from('profiles').select('*').order('created_at',{ascending:false}).limit(100);
    if(q) query=query.or(`username.ilike.%${q}%,display_name.ilike.%${q}%`);
    const {data,error}=await query;
    if(error)return toast(error.message,true);
    const ownerId=(await sb.from('app_owner').select('owner_user_id').eq('singleton',true).single()).data?.owner_user_id;
    $('#adminStats').innerHTML=`<div class="admin-stat"><b>${data?.length||0}</b><span>Пользователей</span></div><div class="admin-stat"><b>${(data||[]).filter(x=>!x.is_banned).length}</b><span>Активных</span></div><div class="admin-stat"><b>${(data||[]).filter(x=>x.is_banned).length}</b><span>Заблокировано</span></div>`;
    $('#adminUsers').innerHTML=(data||[]).map(p=>{
      const owner=p.id===ownerId;
      return `<div class="admin-user ${p.is_banned?'banned':''}">${avatar(p)}<div class="admin-user-main"><b>${esc(p.display_name||p.username)} ${owner?'♛':''}</b><small>@${esc(p.username)} ${p.is_banned?'· ЗАБЛОКИРОВАН':''}</small></div><div class="admin-actions">${owner?'<span class="muted">Владелец</span>':`<button data-ban="${p.id}">${p.is_banned?'Разбанить':'Бан'}</button><button class="danger" data-del="${p.id}">Удалить</button>`}</div></div>`;
    }).join('')||'<div class="no-chats">Пользователей нет.</div>';
    $$('[data-ban]').forEach(b=>b.onclick=()=>adminBan(b.dataset.ban));
    $$('[data-del]').forEach(b=>b.onclick=()=>adminDeleteUser(b.dataset.del));
  }
  async function adminRpc(action,args){ const {data,error}=await sb.rpc(action,args); if(error)throw error; return data; }
  async function adminBan(id){ try{ const {error}=await sb.rpc('admin_set_banned',{target:id,value:!((await sb.from('profiles').select('is_banned').eq('id',id).single()).data?.is_banned)}); if(error)throw error; toast('Статус пользователя изменён'); await loadAdminUsers(); }catch(e){toast(e.message,true)} }
  async function adminDeleteUser(id){ if(!confirm('Удалить аккаунт? Это действие необратимо.'))return; try{ const {data,error}=await sb.functions.invoke('admin-action',{body:{action:'delete_user',user_id:id}}); if(error)throw error; if(data?.error)throw Error(data.error); toast('Аккаунт удалён'); await loadAdminUsers(); }catch(e){toast('Не удалось удалить аккаунт. Проверь Edge Function admin-action.',true)} }

  function debounce(fn,ms){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}}
  init();
})();
