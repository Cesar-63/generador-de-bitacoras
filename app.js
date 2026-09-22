/* Generador de Bitácoras — app local.
   Todo vive en localStorage: no hay servidor, no hay cuenta, no salen datos. */
(function () {
  'use strict';

  var KEY = 'bitacora.v1';
  var COLS = [
    { id: 'todo', name: 'Por hacer', dot: '' },
    { id: 'doing', name: 'En curso', dot: 'accent' },
    { id: 'review', name: 'En revisión', dot: 'warn' },
    { id: 'done', name: 'Hecho', dot: 'good' }
  ];
  var DAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
  var MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
    'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var REPEATS = [
    { id: 'once', label: 'Una vez' },
    { id: 'daily', label: 'Cada día' },
    { id: 'weekdays', label: 'Días hábiles' },
    { id: 'weekly', label: 'Cada semana' }
  ];
  var PROMPT = 'Con esta bitácora, escribe un resumen ejecutivo de máximo 200 palabras: ' +
    'logros de la semana, tiempo por proyecto, bloqueos y lo que queda pendiente.';

  /* ---------------- utilidades ---------------- */

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function hms(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor((sec % 3600) / 60)) + ':' + pad(sec % 60);
  }

  function hm(sec) {
    sec = Math.max(0, Math.round(sec));
    return pad(Math.floor(sec / 3600)) + ':' + pad(Math.floor((sec % 3600) / 60));
  }

  function plural(n, singular, plural_) {
    return n + ' ' + (n === 1 ? singular : plural_);
  }

  function human(sec) {
    sec = Math.max(0, Math.round(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return (h ? h + 'h ' : '') + m + 'm';
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function endOfDay(d) { var x = startOfDay(d); x.setDate(x.getDate() + 1); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }

  function mondayOf(d) {
    var x = startOfDay(d);
    return addDays(x, -((x.getDay() + 6) % 7));
  }

  function ymd(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  function localIso(d) { return ymd(d) + 'T' + hhmm(d); }

  function isoWeek(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return { year: d.getUTCFullYear(), week: Math.ceil((((d - y0) / 86400000) + 1) / 7) };
  }

  function weekTag(monday) {
    var w = isoWeek(monday);
    return w.year + '-W' + pad(w.week);
  }

  function longDate(d) { return d.getDate() + ' de ' + MONTHS[d.getMonth()]; }

  function rangeLabel(a, b) {
    return (a.getMonth() === b.getMonth() ? a.getDate() : longDate(a)) + ' al ' + longDate(b);
  }

  /* ---------------- almacenamiento ---------------- */

  var S = null;
  var storageOk = true;

  /* Dos modos de guardado:
     - 'local'   : localStorage del navegador (GitHub Pages, artifact, doble clic).
     - 'archivo' : data/bitacora.json servido por tools/serve.py. Ese archivo es la
                   fuente de verdad y cualquiera con acceso a la carpeta lo puede editar. */
  var MODE = 'local';
  var FILE_PATH = 'data/bitacora.json';
  var fileStamp = null;
  var saveTimer = null;
  var saving = false;

  function blank() {
    return {
      version: 1,
      settings: { theme: 'system', accent: 'clay', author: '' },
      ui: { view: 'hoy', weekOffset: 0, tab: 'md', filter: { epic: '', tag: '' },
            includes: { side: true, board: true, reminders: true, prompt: true } },
      epics: [],
      stories: [],
      tasks: [],
      reminders: [],
      moves: [],
      timer: null,
      seeded: false
    };
  }

  function normalize(data) {
    var base = blank();
    if (!data || typeof data !== 'object') return base;
    data.settings = Object.assign(base.settings, data.settings || {});
    data.ui = Object.assign(base.ui, data.ui || {});
    data.ui.includes = Object.assign(base.ui.includes, (data.ui && data.ui.includes) || {});
    data.ui.filter = Object.assign(base.ui.filter, (data.ui && data.ui.filter) || {});
    data.epics = data.epics || [];
    data.stories = data.stories || [];
    data.tasks = data.tasks || [];
    data.reminders = data.reminders || [];
    data.moves = data.moves || [];
    if (typeof data.version !== 'number') data.version = 1;
    return data;
  }

  function loadLocal() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOk = false; }
    if (!raw) return seed(blank());
    try { return normalize(JSON.parse(raw)); } catch (e) { return seed(blank()); }
  }

  function probeFile() {
    return new Promise(function (resolve) {
      if (!window.fetch || location.protocol === 'file:') { resolve(false); return; }
      var settled = false;
      var giveUp = setTimeout(function () {
        if (!settled) { settled = true; resolve(false); }
      }, 2500);
      fetch('api/state', { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('sin servidor local'); return r.json(); })
        .then(function (body) {
          if (settled) return;
          settled = true;
          clearTimeout(giveUp);
          MODE = 'archivo';
          FILE_PATH = body.file || FILE_PATH;
          fileStamp = body.stamp;
          S = normalize(body.data);
          resolve(true);
        })
        .catch(function () {
          if (settled) return;
          settled = true;
          clearTimeout(giveUp);
          resolve(false);
        });
    });
  }

  function save() {
    if (MODE === 'archivo') {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushFile, 200);
      return;
    }
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) {
      if (storageOk) { storageOk = false; toast('No se pudo guardar: el navegador bloquea el almacenamiento.'); }
    }
  }

  function flushFile() {
    saveTimer = null;
    if (saving) { save(); return; }
    saving = true;
    fetch('api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stamp: fileStamp, data: S })
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, status: r.status, body: body }; });
    }).then(function (res) {
      saving = false;
      if (res.ok) { fileStamp = res.body.stamp; return; }
      if (res.status === 409) {
        fileStamp = res.body.stamp;
        S = normalize(res.body.data);
        render();
        toast('El archivo cambió por fuera. Recargué el disco: repite tu último cambio.');
        return;
      }
      toast('El servidor local no pudo escribir el archivo.');
    }).catch(function () {
      saving = false;
      toast('Se cayó el servidor local: tus cambios no se están guardando.');
    });
  }

  function pollFile() {
    if (MODE !== 'archivo' || saveTimer || saving || (dlg && dlg.open)) return;
    fetch('api/state', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (body) {
        if (!body || body.stamp === fileStamp) return;
        fileStamp = body.stamp;
        S = normalize(body.data);
        render();
        toast('Actualizado desde ' + FILE_PATH);
      })
      .catch(function () { });
  }

  function flushOnExit() {
    if (MODE !== 'archivo') { save(); return; }
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      navigator.sendBeacon('api/state',
        new Blob([JSON.stringify({ stamp: fileStamp, data: S })], { type: 'application/json' }));
    } catch (e) { /* al cerrar no queda nada más que intentar */ }
  }

  function seed(s) {
    var now = new Date();
    var yest = addDays(now, -1);
    function sess(day, fromH, fromM, toH, toM) {
      var a = startOfDay(day); a.setHours(fromH, fromM, 0, 0);
      var b = startOfDay(day); b.setHours(toH, toM, 0, 0);
      return { id: uid(), start: a.toISOString(), end: b.toISOString() };
    }
    s.tasks = [
      {
        id: uid(), title: 'Ejemplo: migración de endpoints de facturación', kind: 'main',
        project: 'Atlas', column: 'doing', priority: 'alta', note: 'Falta el endpoint de notas de crédito.',
        subtasks: [
          { id: uid(), title: 'Mapear los endpoints actuales', done: true },
          { id: uid(), title: 'Migrar el cálculo de impuestos', done: true },
          { id: uid(), title: 'Pruebas con datos reales', done: false }
        ],
        sessions: [sess(yest, 9, 10, 11, 25)], createdAt: yest.toISOString(), example: true
      },
      {
        id: uid(), title: 'Ejemplo: revisión de incidencias de producción', kind: 'main',
        project: 'Soporte', column: 'doing', priority: 'normal', note: '',
        subtasks: [{ id: uid(), title: 'Revisar la cola de alertas', done: false }],
        sessions: [sess(yest, 14, 5, 15, 34)], createdAt: yest.toISOString(), example: true
      },
      {
        id: uid(), title: 'Ejemplo: daily con el equipo', kind: 'side',
        project: 'Equipo', column: 'done', priority: 'normal', note: '', done: true,
        subtasks: [], sessions: [sess(yest, 9, 0, 9, 15)], createdAt: yest.toISOString(),
        doneAt: yest.toISOString(), example: true
      }
    ];
    var at = startOfDay(now); at.setHours(17, 30, 0, 0);
    while (at.getTime() <= Date.now() || at.getDay() === 0 || at.getDay() === 6) at = addDays(at, 1);
    s.reminders = [{
      id: uid(), text: 'Ejemplo: cerrar la bitácora del día', at: localIso(at),
      repeat: 'weekdays', taskId: '', startTimer: false, example: true
    }];
    s.seeded = true;
    return s;
  }

  /* ---------------- consultas ---------------- */

  var FAR = 8.64e15;

  function sessionsOf(t) {
    var out = (t.sessions || []).slice();
    if (S.timer && S.timer.taskId === t.id) out.push({ start: S.timer.startedAt, end: null });
    return out;
  }

  function spanSeconds(s, from, to) {
    var a = new Date(s.start).getTime();
    var b = s.end ? new Date(s.end).getTime() : Date.now();
    var lo = Math.max(a, from), hi = Math.min(b, to);
    return hi > lo ? (hi - lo) / 1000 : 0;
  }

  function taskSeconds(t, from, to) {
    from = from == null ? 0 : from;
    to = to == null ? FAR : to;
    return sessionsOf(t).reduce(function (acc, s) { return acc + spanSeconds(s, from, to); }, 0);
  }

  function rangeSeconds(from, to, kind) {
    return S.tasks.reduce(function (acc, t) {
      if (kind && t.kind !== kind) return acc;
      return acc + taskSeconds(t, from, to);
    }, 0);
  }

  function todayRange() {
    var d = new Date();
    return [startOfDay(d).getTime(), endOfDay(d).getTime()];
  }

  function currentMonday() { return addDays(mondayOf(new Date()), S.ui.weekOffset * 7); }

  function taskById(id) {
    for (var i = 0; i < S.tasks.length; i++) if (S.tasks[i].id === id) return S.tasks[i];
    return null;
  }

  function running() { return S.timer ? taskById(S.timer.taskId) : null; }

  function runningSeconds() {
    return S.timer ? (Date.now() - new Date(S.timer.startedAt).getTime()) / 1000 : 0;
  }

  function projects() {
    var seen = {}, out = [];
    S.tasks.forEach(function (t) {
      if (t.project && !seen[t.project]) { seen[t.project] = 1; out.push(t.project); }
    });
    return out.sort();
  }

  /* Épicas, historias y etiquetas.
     Regla: si la tarea tiene historia, la épica sale de ella; `epicId` sólo
     se usa cuando no hay historia. Así nunca quedan las dos en desacuerdo. */

  function epicById(id) {
    for (var i = 0; i < S.epics.length; i++) if (S.epics[i].id === id) return S.epics[i];
    return null;
  }

  function storyById(id) {
    for (var i = 0; i < S.stories.length; i++) if (S.stories[i].id === id) return S.stories[i];
    return null;
  }

  function storiesOf(epicId) {
    return S.stories.filter(function (s) { return s.epicId === epicId; });
  }

  function storyOfTask(t) { return t.storyId ? storyById(t.storyId) : null; }

  function epicOfTask(t) {
    var s = storyOfTask(t);
    if (s) return epicById(s.epicId);
    return t.epicId ? epicById(t.epicId) : null;
  }

  function tasksOfStory(id) {
    return S.tasks.filter(function (t) { return t.storyId === id; });
  }

  function tasksOfEpic(id) {
    return S.tasks.filter(function (t) {
      var e = epicOfTask(t);
      return e && e.id === id;
    });
  }

  function looseTasks(epicId) {
    return S.tasks.filter(function (t) {
      return !t.storyId && t.epicId === epicId;
    });
  }

  function allTags() {
    var seen = {}, out = [];
    S.tasks.forEach(function (t) {
      (t.tags || []).forEach(function (g) {
        if (!seen[g]) { seen[g] = 1; out.push(g); }
      });
    });
    return out.sort();
  }

  function parseTags(texto) {
    var vistos = {};
    return String(texto || '').split(/[,\n]/).map(function (g) {
      return g.trim().replace(/^#/, '').replace(/\s+/g, '-').toLowerCase();
    }).filter(function (g) {
      if (!g || vistos[g]) return false;
      vistos[g] = 1;
      return true;
    });
  }

  function keyFrom(title, taken) {
    var base = String(title || '').toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ0-9 ]/g, '')
      .split(/\s+/).filter(Boolean);
    var clave = (base.length > 1 ? base.map(function (w) { return w.charAt(0); }).join('')
                                 : (base[0] || 'EP')).slice(0, 5);
    if (!clave) clave = 'EP';
    var final = clave, n = 2;
    while (taken.indexOf(final) >= 0) { final = clave + n; n++; }
    return final;
  }

  function nextStoryKey() {
    var max = 0;
    S.stories.forEach(function (s) {
      var m = /^HU-(\d+)$/.exec(s.key || '');
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return 'HU-' + (max + 1);
  }

  function itemProgress(tareas) {
    if (!tareas.length) return null;
    var hechas = tareas.filter(function (t) { return t.column === 'done'; }).length;
    return { done: hechas, total: tareas.length, pct: Math.round(hechas / tareas.length * 100) };
  }

  function passesFilter(t) {
    var f = S.ui.filter || {};
    if (f.epic) {
      var e = epicOfTask(t);
      if (!e || e.id !== f.epic) return false;
    }
    if (f.tag && (t.tags || []).indexOf(f.tag) < 0) return false;
    return true;
  }

  function filterActive() {
    var f = S.ui.filter || {};
    return !!(f.epic || f.tag);
  }

  /* Chips de épica, historia y etiquetas, iguales en todas las vistas. */
  function itemChips(t) {
    var h = '';
    var e = epicOfTask(t);
    var s = storyOfTask(t);
    if (e) h += '<span class="chip epic" title="Épica">' + esc(e.key) + '</span>';
    if (s) h += '<span class="chip story" title="' + esc(s.title) + '">' + esc(s.key) + '</span>';
    (t.tags || []).forEach(function (g) {
      h += '<button type="button" class="chip tag" data-act="filter-tag" data-tag="' + esc(g) +
        '" title="Filtrar por esta etiqueta">#' + esc(g) + '</button>';
    });
    return h;
  }

  function subProgress(t) {
    var subs = t.subtasks || [];
    if (!subs.length) return null;
    var done = subs.filter(function (s) { return s.done; }).length;
    return { done: done, total: subs.length, pct: Math.round(done / subs.length * 100) };
  }

  function activeToday(t) {
    var r = todayRange();
    if (taskSeconds(t, r[0], r[1]) > 0) return true;
    return !t.done && t.column !== 'done';
  }

  /* ---------------- cronómetro ---------------- */

  function startTimer(id) {
    var t = taskById(id);
    if (!t) return;
    if (S.timer && S.timer.taskId === id) return;
    stopTimer(true);
    S.timer = { taskId: id, startedAt: new Date().toISOString() };
    if (t.kind === 'main' && t.column === 'todo') moveTask(t, 'doing', true);
    save();
    render();
  }

  function stopTimer(silent) {
    if (!S.timer) return;
    var t = taskById(S.timer.taskId);
    var startedAt = S.timer.startedAt;
    S.timer = null;
    var kept = false;
    if (t) {
      var secs = (Date.now() - new Date(startedAt).getTime()) / 1000;
      if (secs >= 5) {
        t.sessions = t.sessions || [];
        t.sessions.push({ id: uid(), start: startedAt, end: new Date().toISOString() });
        kept = true;
      }
    }
    if (!silent) {
      save();
      render();
      toast(kept ? 'Sesión guardada' : 'Menos de 5 segundos: no se guardó nada');
    }
  }

  function toggleTimer(id) {
    if (S.timer && S.timer.taskId === id) stopTimer();
    else startTimer(id);
  }

  /* ---------------- tareas ---------------- */

  function addTask(title, kind) {
    title = (title || '').trim();
    if (!title) return null;
    var t = {
      id: uid(), title: title, kind: kind || 'main', project: '',
      column: kind === 'side' ? 'doing' : 'todo', priority: 'normal', note: '',
      tags: [], epicId: null, storyId: null,
      subtasks: [], sessions: [], createdAt: new Date().toISOString(), done: false
    };
    S.tasks.unshift(t);
    save();
    return t;
  }

  function moveTask(t, col, quiet) {
    if (!t || t.column === col) return;
    S.moves.push({ id: uid(), taskId: t.id, title: t.title, from: t.column, to: col, at: new Date().toISOString() });
    t.column = col;
    if (col === 'done') {
      t.done = true;
      t.doneAt = new Date().toISOString();
      if (S.timer && S.timer.taskId === t.id) stopTimer(true);
    } else {
      t.done = false;
      t.doneAt = null;
    }
    if (!quiet) { save(); render(); }
  }

  function toggleDone(t) {
    moveTask(t, t.done || t.column === 'done' ? 'doing' : 'done');
  }

  function deleteTask(id) {
    if (S.timer && S.timer.taskId === id) S.timer = null;
    S.tasks = S.tasks.filter(function (t) { return t.id !== id; });
    save();
    render();
  }

  /* ---------------- recordatorios ---------------- */

  function nextAt(rem) {
    var d = new Date(rem.at.replace(' ', 'T'));
    if (isNaN(d)) return null;
    if (rem.repeat === 'daily') d = addDays(d, 1);
    else if (rem.repeat === 'weekly') d = addDays(d, 7);
    else if (rem.repeat === 'weekdays') {
      do { d = addDays(d, 1); } while (d.getDay() === 0 || d.getDay() === 6);
    } else return null;
    return localIso(d);
  }

  function dueReminders() {
    var now = Date.now();
    return S.reminders.filter(function (r) {
      return !r.done && new Date(r.at.replace(' ', 'T')).getTime() <= now;
    });
  }

  function checkReminders() {
    var due = dueReminders();
    if (!due.length) return;
    due.forEach(function (r) {
      notify('Recordatorio', r.text);
      if (r.startTimer && r.taskId && taskById(r.taskId)) startTimer(r.taskId);
      var next = nextAt(r);
      if (next) { r.at = next; } else { r.done = true; r.firedAt = new Date().toISOString(); }
    });
    save();
    render();
  }

  function notify(title, body) {
    try {
      if (window.Notification && Notification.permission === 'granted') {
        new Notification(title, { body: body });
        return;
      }
    } catch (e) { /* el navegador puede bloquearlo dentro de un iframe */ }
    toast(body);
  }

  function askNotifications() {
    if (!window.Notification) { toast('Este navegador no ofrece notificaciones.'); return; }
    try {
      Notification.requestPermission().then(function (p) {
        toast(p === 'granted' ? 'Listo: te avisaré en el navegador.' : 'Sin permiso: los avisos saldrán dentro de la app.');
        render();
      });
    } catch (e) { toast('No se pudo pedir el permiso aquí.'); }
  }

  /* ---------------- vistas ---------------- */

  var viewEl, bannerEl, toastEl, dlg;

  function render() {
    var view = S.ui.view;
    var html = '';
    if (view === 'kanban') html = viewKanban();
    else if (view === 'backlog') html = viewBacklog();
    else if (view === 'semana') html = viewSemana();
    else if (view === 'recordatorios') html = viewRecordatorios();
    else if (view === 'ajustes') html = viewAjustes();
    else html = viewHoy();
    viewEl.innerHTML = html;
    paintNav();
    paintBanner();
    refreshLive();
    if (view === 'kanban') wireDrag();
  }

  function paintNav() {
    var items = document.querySelectorAll('.nav-item');
    for (var i = 0; i < items.length; i++) {
      var on = items[i].getAttribute('data-view') === S.ui.view;
      if (on) items[i].setAttribute('aria-current', 'page');
      else items[i].removeAttribute('aria-current');
    }
    var sub = document.querySelector('.brand-sub');
    if (sub) sub.textContent = MODE === 'archivo' ? 'Archivo · ' + FILE_PATH : 'Local · sin cuenta';
    var badge = document.getElementById('navBadge');
    var pend = S.reminders.filter(function (r) { return !r.done; }).length;
    badge.hidden = pend === 0;
    badge.textContent = pend;
    var segs = document.querySelectorAll('.seg-btn[data-act="theme"]');
    for (var j = 0; j < segs.length; j++) {
      segs[j].setAttribute('aria-pressed', segs[j].getAttribute('data-theme') === S.settings.theme ? 'true' : 'false');
    }
    var m = currentMonday();
    document.getElementById('sideWeek').textContent =
      'Semana ' + isoWeek(m).week + ' · ' + hm(rangeSeconds(m.getTime(), addDays(m, 7).getTime()));
  }

  function paintBanner() {
    var hasExamples = S.tasks.some(function (t) { return t.example; }) ||
      S.reminders.some(function (r) { return r.example; });
    bannerEl.hidden = !hasExamples;
    if (hasExamples) {
      bannerEl.innerHTML = '<span class="grow">Los datos que ves son de ejemplo, para que la app no arranque vacía.</span>' +
        '<button type="button" class="btn sm" data-act="clear-examples">Borrar los ejemplos</button>';
    }
  }

  function topbar(eyebrow, title, actions) {
    return '<header class="topbar">' +
      '<div class="titles"><span class="eyebrow">' + esc(eyebrow) + '</span><h1>' + esc(title) + '</h1></div>' +
      '<div class="actions">' + (actions || '') + '</div></header>';
  }

  /* ---- Hoy ---- */

  function viewHoy() {
    var now = new Date();
    var r = todayRange();
    var run = running();
    var mains = S.tasks.filter(function (t) { return t.kind === 'main' && activeToday(t); });
    var sides = S.tasks.filter(function (t) { return t.kind === 'side' && activeToday(t); });

    var h = topbar(
      'Semana ' + isoWeek(now).week + ' · ' + DAYS[(now.getDay() + 6) % 7],
      longDate(now),
      '<div class="stat" style="flex:0 0 auto"><span class="hint">Registrado hoy</span>' +
      '<span class="mono xl" data-live="today">00:00:00</span></div>' +
      '<a class="btn primary" href="#/semana"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"></path><path d="M8 11l4 4 4-4"></path><path d="M5 19h14"></path></svg>Exportar para Claude</a>'
    );

    /* tarjeta del cronómetro */
    if (run) {
      var sp = subProgress(run);
      h += '<section class="timer-card">' +
        '<div class="grow" style="display:flex;flex-direction:column;gap:6px">' +
        '<span class="row" style="gap:7px"><span class="dot accent"></span>' +
        '<span class="eyebrow" style="color:var(--accent);font-weight:600">En curso</span></span>' +
        '<span style="font-size:20px;font-weight:600">' + esc(run.title) + '</span>' +
        '<span class="task-meta">' +
        (run.project ? '<span class="chip good">' + esc(run.project) + '</span>' : '') +
        '<span class="chip">' + (run.kind === 'main' ? 'Principal' : 'Secundaria') + '</span>' +
        (sp ? '<span>' + sp.done + ' de ' + sp.total + ' subtareas</span>' : '') +
        '<span>desde ' + hhmm(new Date(S.timer.startedAt)) + '</span></span></div>' +
        '<span class="timer-clock" data-live="clock">00:00:00</span>' +
        '<div class="row">' +
        '<button type="button" class="btn primary" data-act="stop"><svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>Detener y guardar</button>' +
        '</div></section>';
    } else {
      h += '<section class="timer-card">' +
        '<div class="grow" style="display:flex;flex-direction:column;gap:4px">' +
        '<span class="eyebrow">Sin cronómetro</span>' +
        '<span style="font-size:17px;font-weight:600" class="timer-idle">Pulsa ▶ en una tarea para empezar a contar</span></div>' +
        '<span class="timer-clock timer-idle">00:00:00</span></section>';
    }

    h += '<div class="cols"><div class="grow" style="display:flex;flex-direction:column;gap:20px">';

    /* principales */
    h += '<section class="section"><div class="section-head"><h2>Tareas principales</h2>' +
      '<span class="hint">' + mains.length + ' activas · ' + hm(rangeSeconds(r[0], r[1], 'main')) + ' hoy</span></div>';
    if (!mains.length) h += '<p class="empty">Nada por ahora. Añade la primera tarea abajo.</p>';
    mains.forEach(function (t) { h += taskRow(t, r); });
    h += addLine('main', 'Añadir tarea principal');
    h += '</section>';

    /* secundarias */
    h += '<section class="section"><div class="section-head"><h2>Tareas secundarias</h2>' +
      '<span class="hint">Interrupciones y apoyo · ' + hm(rangeSeconds(r[0], r[1], 'side')) + ' hoy</span></div>' +
      '<div class="list">';
    if (!sides.length) h += '<div class="line"><span class="line-title hint">Sin tareas secundarias hoy.</span></div>';
    sides.forEach(function (t) {
      var live = S.timer && S.timer.taskId === t.id;
      h += '<div class="line' + (t.done ? ' done' : '') + '">' +
        '<input type="checkbox" id="chk-' + t.id + '" data-act="toggle-done" data-id="' + t.id + '"' + (t.done ? ' checked' : '') + '>' +
        '<label class="line-title" for="chk-' + t.id + '">' + esc(t.title) + '</label>' +
        (t.project ? '<span class="chip">' + esc(t.project) + '</span>' : '') +
        '<span class="mono hint" data-live="task:' + t.id + '">' + hm(taskSeconds(t, r[0], r[1])) + '</span>' +
        '<button type="button" class="icon-btn' + (live ? ' bordered' : '') + '" data-act="timer" data-id="' + t.id + '" aria-label="' + (live ? 'Detener' : 'Arrancar') + ' el cronómetro">' +
        (live ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"></path></svg>'
              : '<svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"></path></svg>') + '</button>' +
        '<button type="button" class="icon-btn" data-act="edit" data-id="' + t.id + '" aria-label="Abrir la tarea">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"></path></svg></button>' +
        '</div>';
    });
    h += addLine('side', 'Añadir tarea secundaria', true);
    h += '</div></section>';

    h += '</div><div class="col-side">';

    /* recordatorios */
    var pend = S.reminders.filter(function (x) { return !x.done; })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; }).slice(0, 4);
    h += '<section class="card"><div class="row"><h2 class="grow">Recordatorios</h2>' +
      '<a class="btn sm ghost" href="#/recordatorios">Ver todos</a></div>';
    if (!pend.length) h += '<p class="hint">Sin recordatorios pendientes.</p>';
    pend.forEach(function (x) { h += reminderRow(x, true); });
    h += '<button type="button" class="btn dashed" data-act="new-reminder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Nuevo recordatorio</button>' +
      '</section>';

    /* resumen */
    h += '<section class="card"><h2>Resumen del día</h2><div class="stats">' +
      '<div class="stat"><span class="hint">Principales</span><span class="mono xl">' + hm(rangeSeconds(r[0], r[1], 'main')) + '</span></div>' +
      '<div class="stat"><span class="hint">Secundarias</span><span class="mono xl">' + hm(rangeSeconds(r[0], r[1], 'side')) + '</span></div>' +
      '</div><p class="hint">El tiempo sale sólo de las sesiones del cronómetro, nunca se escribe a mano.</p>' +
      '<a class="btn" href="#/kanban">Ir al tablero</a></section>';

    h += '</div></div>';
    return h;
  }

  function taskRow(t, r) {
    var live = S.timer && S.timer.taskId === t.id;
    var sp = subProgress(t);
    var col = COLS.filter(function (c) { return c.id === t.column; })[0] || COLS[0];
    return '<article class="task' + (live ? ' live' : '') + (t.done ? ' done' : '') + '">' +
      '<button type="button" class="play' + (live ? ' on' : '') + '" data-act="timer" data-id="' + t.id + '" aria-label="' + (live ? 'Detener' : 'Arrancar') + ' el cronómetro de ' + esc(t.title) + '">' +
      (live ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"></path></svg>'
            : '<svg class="solid" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z"></path></svg>') +
      '</button>' +
      '<div class="task-main">' +
      '<button type="button" class="task-title" data-act="edit" data-id="' + t.id + '" style="background:none;border:none;padding:0;text-align:left;color:inherit;font:inherit;font-weight:600;cursor:pointer">' + esc(t.title) + '</button>' +
      '<span class="task-meta">' +
      (t.project ? '<span class="chip good">' + esc(t.project) + '</span>' : '') +
      itemChips(t) +
      '<span class="chip">' + esc(col.name) + '</span>' +
      (sp ? '<span>' + sp.done + ' de ' + sp.total + ' subtareas</span>' : '<span>Sin subtareas</span>') +
      (t.priority === 'alta' ? '<span class="chip warn">Prioridad alta</span>' : '') +
      '</span>' +
      (sp ? '<div class="bar"><i style="width:' + sp.pct + '%"></i></div>' : '') +
      '</div>' +
      '<div class="task-time"><span class="mono" style="font-size:16px" data-live="task:' + t.id + '">' +
      hm(taskSeconds(t, r && r[0], r && r[1])) + '</span>' +
      '<span class="hint">' + (live ? 'corriendo' : (r ? 'hoy' : 'total')) + '</span></div>' +
      '</article>';
  }

  function addLine(kind, label, bare) {
    return '<form class="' + (bare ? '' : 'list ') + 'add-line" data-act="add-task" data-kind="' + kind + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="color:var(--muted)"><path d="M12 5v14M5 12h14"></path></svg>' +
      '<label class="sr" for="add-' + kind + '">' + esc(label) + '</label>' +
      '<input id="add-' + kind + '" class="grow" type="text" placeholder="' + esc(label) + ' y pulsar Enter" autocomplete="off">' +
      '</form>';
  }

  function reminderRow(x, compact) {
    var d = new Date(x.at.replace(' ', 'T'));
    var today = ymd(d) === ymd(new Date());
    var when = today ? hhmm(d) : DAYS[(d.getDay() + 6) % 7] + ' ' + hhmm(d);
    var rep = REPEATS.filter(function (o) { return o.id === x.repeat; })[0];
    var task = x.taskId ? taskById(x.taskId) : null;
    return '<div class="row" style="align-items:flex-start;gap:12px">' +
      '<span class="chip' + (today ? ' accent' : '') + ' mono">' + esc(when) + '</span>' +
      '<div class="grow" style="display:flex;flex-direction:column;gap:2px">' +
      '<span style="font-size:14px;font-weight:500">' + esc(x.text) + '</span>' +
      '<span class="hint">' + esc(rep ? rep.label : 'Una vez') +
      (task ? ' · ' + esc(task.title) : '') + (x.startTimer ? ' · arranca el cronómetro' : '') + '</span></div>' +
      (compact ? '' :
        '<button type="button" class="icon-btn" data-act="edit-reminder" data-id="' + x.id + '" aria-label="Editar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16z"></path></svg></button>' +
        '<button type="button" class="icon-btn" data-act="del-reminder" data-id="' + x.id + '" aria-label="Eliminar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"></path></svg></button>') +
      '</div>';
  }

  /* ---- Kanban ---- */

  function viewKanban() {
    var m = currentMonday();
    var h = topbar('Tablero · semana ' + isoWeek(new Date()).week, 'Kanban',
      '<button type="button" class="btn primary" data-act="new-task"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Nueva tarjeta</button>');

    h += filterBar();

    h += '<div class="board">';
    COLS.forEach(function (c) {
      var cards = S.tasks.filter(function (t) { return t.column === c.id && passesFilter(t); });
      h += '<section class="board-col" data-col="' + c.id + '">' +
        '<div class="board-head"><span class="dot ' + c.dot + '"></span><h3>' + c.name + '</h3>' +
        '<span class="mono hint">' + cards.length + '</span></div>';
      cards.forEach(function (t) { h += kcard(t); });
      h += '<button type="button" class="btn dashed sm" data-act="new-task" data-col="' + c.id + '">+ Añadir</button>' +
        '</section>';
    });
    h += '</div>';

    var moved = S.moves.filter(function (mv) {
      return new Date(mv.at).getTime() >= m.getTime() && mv.to === 'done';
    }).length;
    h += '<section class="card"><div class="row wrap">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="color:var(--good)"><path d="M20 6L9 17l-5-5"></path></svg>' +
      '<span class="grow">Todo lo que llega a <strong>Hecho</strong> entra en el resumen de la semana con su tiempo acumulado. ' +
      'Van ' + moved + ' esta semana.</span>' +
      '<a class="btn" href="#/semana">Ver la semana</a></div></section>';
    return h;
  }

  function filterBar() {
    var f = S.ui.filter || {};
    var tags = allTags();
    if (!S.epics.length && !tags.length) return '';
    var h = '<div class="filtro">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="color:var(--muted)"><path d="M4 6h16M7 12h10M10 18h4"></path></svg>';

    if (S.epics.length) {
      h += '<label class="sr" for="f-epic">Filtrar por épica</label>' +
        '<select id="f-epic" data-act="filter-epic" style="width:auto;min-height:38px">' +
        '<option value="">Todas las épicas</option>' +
        S.epics.map(function (e) {
          return '<option value="' + e.id + '"' + (f.epic === e.id ? ' selected' : '') + '>' +
            esc(e.key) + ' · ' + esc(e.title) + '</option>';
        }).join('') + '</select>';
    }

    if (tags.length) {
      h += '<div class="row wrap" style="gap:6px">' + tags.slice(0, 12).map(function (g) {
        return '<button type="button" class="chip tag' + (f.tag === g ? ' on' : '') +
          '" data-act="filter-tag" data-tag="' + esc(g) + '">#' + esc(g) + '</button>';
      }).join('') + '</div>';
    }

    if (filterActive()) {
      h += '<span class="grow"></span><button type="button" class="btn sm ghost" data-act="filter-clear">Quitar filtro</button>';
    }
    return h + '</div>';
  }

  function kcard(t) {
    var live = S.timer && S.timer.taskId === t.id;
    var sp = subProgress(t);
    var idx = COLS.map(function (c) { return c.id; }).indexOf(t.column);
    return '<article class="kcard" draggable="true" data-id="' + t.id + '">' +
      '<div class="row" style="align-items:flex-start">' +
      '<button type="button" class="kcard-title grow" data-act="edit" data-id="' + t.id + '" style="background:none;border:none;padding:0;text-align:left;color:inherit;font:inherit;font-weight:600;cursor:pointer">' + esc(t.title) + '</button>' +
      (t.priority === 'alta' ? '<span class="dot accent" style="margin-top:6px"></span>' : '') +
      '</div>' +
      '<div class="row wrap" style="gap:6px">' +
      (t.project ? '<span class="chip good">' + esc(t.project) + '</span>' : '') +
      itemChips(t) +
      '<span class="chip">' + (t.kind === 'main' ? 'Principal' : 'Secundaria') + '</span>' +
      (sp ? '<span class="chip">' + sp.done + '/' + sp.total + '</span>' : '') +
      '</div>' +
      '<div class="kcard-foot">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="width:14px;height:14px;color:var(--muted)"><circle cx="12" cy="12" r="9"></circle><path d="M12 7v5l3 2"></path></svg>' +
      '<span class="mono hint" data-live="task:' + t.id + '">' + hm(taskSeconds(t)) + '</span>' +
      (live ? '<span class="chip accent">corriendo</span>' : '') +
      '<span class="grow"></span>' +
      '<button type="button" class="icon-btn" data-act="col-prev" data-id="' + t.id + '" aria-label="Mover a la columna anterior"' + (idx <= 0 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H6"></path><path d="M11 6l-6 6 6 6"></path></svg></button>' +
      '<button type="button" class="icon-btn" data-act="col-next" data-id="' + t.id + '" aria-label="Mover a la columna siguiente"' + (idx >= 3 ? ' disabled' : '') + '><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"></path><path d="M13 6l6 6-6 6"></path></svg></button>' +
      '</div></article>';
  }

  function wireDrag() {
    var cards = viewEl.querySelectorAll('.kcard');
    for (var i = 0; i < cards.length; i++) {
      cards[i].addEventListener('dragstart', function (e) {
        e.dataTransfer.setData('text/plain', this.getAttribute('data-id'));
        e.dataTransfer.effectAllowed = 'move';
        this.classList.add('dragging');
      });
      cards[i].addEventListener('dragend', function () { this.classList.remove('dragging'); });
    }
    var cols = viewEl.querySelectorAll('.board-col');
    for (var j = 0; j < cols.length; j++) {
      cols[j].addEventListener('dragover', function (e) { e.preventDefault(); this.classList.add('over'); });
      cols[j].addEventListener('dragleave', function () { this.classList.remove('over'); });
      cols[j].addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('over');
        var id = e.dataTransfer.getData('text/plain');
        moveTask(taskById(id), this.getAttribute('data-col'));
      });
    }
  }

  /* ---- Backlog: épicas, historias y lo que cuelga de ellas ---- */

  function viewBacklog() {
    var m = currentMonday();
    var desde = m.getTime(), hasta = addDays(m, 7).getTime();

    var h = topbar('Épicas e historias de usuario', 'Backlog',
      '<button type="button" class="btn primary" data-act="new-epic">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Nueva épica</button>');

    if (!S.epics.length) {
      h += '<p class="empty">Todavía no hay épicas. Crea una y cuelga de ella historias de usuario; ' +
        'las tareas del día se asignan a una historia (o directamente a la épica).</p>';
    }

    S.epics.forEach(function (e) {
      var tareas = tasksOfEpic(e.id);
      var pr = itemProgress(tareas);
      var total = tareas.reduce(function (a, t) { return a + taskSeconds(t); }, 0);
      var semana = tareas.reduce(function (a, t) { return a + taskSeconds(t, desde, hasta); }, 0);

      h += '<section class="card epic-card' + (e.done ? ' cerrada' : '') + '">' +
        '<div class="row wrap">' +
        '<span class="chip epic">' + esc(e.key) + '</span>' +
        '<h2 class="grow" style="font-size:19px">' + esc(e.title) + '</h2>' +
        '<span class="mono hint">' + hm(semana) + ' esta semana · ' + hm(total) + ' en total</span>' +
        '<button type="button" class="icon-btn" data-act="edit-epic" data-id="' + e.id + '" aria-label="Editar la épica">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16z"></path></svg></button>' +
        '</div>' +
        (e.note ? '<p class="hint" style="font-size:13px">' + esc(e.note) + '</p>' : '');

      if (pr) {
        h += '<div class="row" style="gap:10px"><div class="bar grow"><i style="width:' + pr.pct + '%"></i></div>' +
          '<span class="hint">' + pr.done + ' de ' + plural(pr.total, 'tarea cerrada', 'tareas cerradas') + '</span></div>';
      }

      var historias = storiesOf(e.id);
      historias.forEach(function (s) {
        var st = tasksOfStory(s.id);
        var spr = itemProgress(st);
        h += '<div class="story">' +
          '<div class="row wrap">' +
          '<span class="chip story">' + esc(s.key) + '</span>' +
          '<span class="grow" style="font-weight:500">' + esc(s.title) + '</span>' +
          '<span class="mono hint">' + hm(st.reduce(function (a, t) { return a + taskSeconds(t); }, 0)) + '</span>' +
          (spr ? '<span class="hint">' + spr.done + '/' + spr.total + '</span>' : '<span class="hint">sin tareas</span>') +
          '<button type="button" class="icon-btn" data-act="edit-story" data-id="' + s.id + '" aria-label="Editar la historia">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16z"></path></svg></button>' +
          '</div>' +
          st.map(function (t) { return backlogTask(t); }).join('') +
          '</div>';
      });

      var sueltas = looseTasks(e.id);
      if (sueltas.length) {
        h += '<div class="story"><span class="hint">Sin historia</span>' +
          sueltas.map(function (t) { return backlogTask(t); }).join('') + '</div>';
      }

      h += '<div class="row wrap" style="gap:8px">' +
        '<button type="button" class="btn sm dashed" data-act="new-story" data-id="' + e.id + '">+ Historia de usuario</button>' +
        (historias.length || sueltas.length ? '' : '<span class="hint">Nada asignado todavía.</span>') +
        '</div></section>';
    });

    var huerfanas = S.tasks.filter(function (t) { return !epicOfTask(t) && t.column !== 'done'; });
    if (huerfanas.length) {
      h += '<section class="card"><div class="row"><h2 class="grow" style="font-size:19px">Sin épica</h2>' +
        '<span class="hint">' + plural(huerfanas.length, 'tarea abierta', 'tareas abiertas') + '</span></div>' +
        huerfanas.map(function (t) { return backlogTask(t); }).join('') + '</section>';
    }
    return h;
  }

  function backlogTask(t) {
    var col = COLS.filter(function (c) { return c.id === t.column; })[0] || COLS[0];
    return '<div class="line" style="padding:4px 0">' +
      '<span class="dot ' + (t.column === 'done' ? 'good' : (t.column === 'todo' ? '' : 'accent')) + '"></span>' +
      '<button type="button" class="line-title" data-act="edit" data-id="' + t.id + '" ' +
      'style="background:none;border:none;padding:0;text-align:left;color:inherit;font:inherit;cursor:pointer">' +
      esc(t.title) + '</button>' +
      '<span class="chip">' + esc(col.name) + '</span>' +
      '<span class="mono hint">' + hm(taskSeconds(t)) + '</span>' +
      '</div>';
  }

  /* ---- Semana ---- */

  function weekData(monday) {
    var days = [];
    for (var i = 0; i < 7; i++) {
      var d = addDays(monday, i);
      var from = startOfDay(d).getTime(), to = endOfDay(d).getTime();
      var dm = rangeSeconds(from, to, 'main'), ds = rangeSeconds(from, to, 'side');
      if (dm + ds < 60) { dm = 0; ds = 0; }
      days.push({ date: d, main: dm, side: ds });
    }
    var main = days.reduce(function (a, d) { return a + d.main; }, 0);
    var side = days.reduce(function (a, d) { return a + d.side; }, 0);
    var logged = days.filter(function (d) { return d.main + d.side > 0; }).length;
    return { days: days, main: main, side: side, total: main + side, logged: logged };
  }

  function viewSemana() {
    var m = currentMonday();
    var w = weekData(m);
    var from = m.getTime(), to = addDays(m, 7).getTime();
    var wk = isoWeek(m);
    var last = addDays(m, 6);

    var h = topbar('Semana ' + wk.week + ' · ' + rangeLabel(m, last), 'Resumen de la semana',
      '<div class="seg" role="group" aria-label="Cambiar de semana">' +
      '<button type="button" class="seg-btn" data-act="week" data-delta="-1" aria-label="Semana anterior">‹</button>' +
      '<button type="button" class="seg-btn" data-act="week" data-delta="0">Esta semana</button>' +
      '<button type="button" class="seg-btn" data-act="week" data-delta="1" aria-label="Semana siguiente">›</button>' +
      '</div>' +
      '<button type="button" class="btn" data-act="copy"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>Copiar</button>' +
      '<button type="button" class="btn primary" data-act="download"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11"></path><path d="M8 11l4 4 4-4"></path><path d="M5 19h14"></path></svg>Descargar ' + fileName(m) + '</button>');

    h += '<div class="cols"><div class="grow" style="display:flex;flex-direction:column;gap:20px">';

    /* barras */
    var max = Math.max(3600, w.days.reduce(function (a, d) { return Math.max(a, d.main + d.side); }, 0));
    h += '<section class="card"><div class="row wrap"><div class="grow"><h2>Tiempo por día</h2>' +
      '<span class="hint">' + w.logged + ' de 7 días con registro</span></div>' +
      '<span class="row" style="gap:6px"><span class="dot accent"></span><span class="hint">Principales</span></span>' +
      '<span class="row" style="gap:6px"><span class="dot good"></span><span class="hint">Secundarias</span></span></div>';
    h += '<div class="days">';
    w.days.forEach(function (d) {
      var total = d.main + d.side;
      if (!total) { h += '<div class="day"><span class="mono hint">—</span><div class="day-empty"></div></div>'; return; }
      var hMain = Math.round(d.main / max * 150);
      var hSide = Math.round(d.side / max * 150);
      h += '<div class="day"><span class="mono" style="font-size:13px">' + hm(total) + '</span><div class="day-stack">' +
        (hSide ? '<i class="side" style="height:' + Math.max(4, hSide) + 'px"></i>' : '') +
        (hMain ? '<i class="main" style="height:' + Math.max(4, hMain) + 'px"></i>' : '') +
        '</div></div>';
    });
    h += '</div><div class="day-labels">';
    w.days.forEach(function (d, i) {
      var off = d.main + d.side === 0;
      h += '<span class="' + (off ? 'off' : '') + '">' + DAYS[i] + ' ' + d.date.getDate() + '</span>';
    });
    h += '</div>';

    var closed = S.moves.filter(function (mv) {
      var t = new Date(mv.at).getTime();
      return mv.to === 'done' && t >= from && t < to;
    }).length;
    h += '<div class="stats">' +
      '<div class="stat"><span class="hint">Total</span><span class="mono xl">' + hm(w.total) + '</span></div>' +
      '<div class="stat"><span class="hint">Principales</span><span class="mono xl">' + hm(w.main) + '</span></div>' +
      '<div class="stat"><span class="hint">Secundarias</span><span class="mono xl">' + hm(w.side) + '</span></div>' +
      '<div class="stat"><span class="hint">Cerradas</span><span class="mono xl">' + closed + '</span></div>' +
      '</div></section>';

    /* qué incluye */
    var inc = S.ui.includes;
    h += '<section class="card"><h2>Qué se lleva el export</h2><div class="list">' +
      incLine('side', 'Tareas secundarias e interrupciones', 'recomendado', inc.side) +
      incLine('board', 'Movimientos del tablero', 'contexto', inc.board) +
      incLine('reminders', 'Recordatorios de la semana', 'opcional', inc.reminders) +
      incLine('prompt', 'Instrucción final para Claude', 'recomendado', inc.prompt) +
      '</div><p class="hint">Las tareas principales, con sus sesiones y subtareas, van siempre.</p></section>';

    h += '</div><div class="col-side">';

    /* panel de export */
    var text = S.ui.tab === 'json' ? buildJson(m) : buildMarkdown(m);
    h += '<section class="export"><div class="export-head">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" style="color:var(--accent)"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path></svg>' +
      '<span class="grow" style="font-weight:600">Archivo para Claude</span>' +
      '<div class="seg" role="group" aria-label="Formato">' +
      '<button type="button" class="seg-btn" data-act="tab" data-tab="md" aria-pressed="' + (S.ui.tab !== 'json') + '">Markdown</button>' +
      '<button type="button" class="seg-btn" data-act="tab" data-tab="json" aria-pressed="' + (S.ui.tab === 'json') + '">JSON</button>' +
      '</div></div>' +
      '<div class="export-body"><pre id="exportText">' + esc(text) + '</pre></div>' +
      '<div class="export-foot"><span class="eyebrow" style="color:#A9A497">Cómo usarlo</span>' +
      '<p>Descarga el archivo o copia el texto, pégalo en una conversación con Claude y pide el resumen. ' +
      'La instrucción ya va al final del archivo.</p></div></section>';

    h += '</div></div>';
    return h;
  }

  function incLine(id, label, hint, on) {
    return '<label class="line clickable"><input type="checkbox" data-act="include" data-id="' + id + '"' + (on ? ' checked' : '') + '>' +
      '<span class="line-title" style="font-weight:500">' + esc(label) + '</span><span class="hint">' + esc(hint) + '</span></label>';
  }

  /* ---- Recordatorios ---- */

  function viewRecordatorios() {
    var pend = S.reminders.filter(function (r) { return !r.done; })
      .sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    var done = S.reminders.filter(function (r) { return r.done; })
      .sort(function (a, b) { return a.at < b.at ? 1 : -1; }).slice(0, 12);

    var perm = 'default';
    try { perm = (window.Notification && Notification.permission) || 'default'; } catch (e) { }

    var h = topbar('Avisos del día y de la semana', 'Recordatorios',
      '<button type="button" class="btn primary" data-act="new-reminder"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"></path></svg>Nuevo recordatorio</button>');

    if (perm !== 'granted') {
      h += '<section class="card"><div class="row wrap"><div class="grow">' +
        '<h3>Avisos del navegador</h3><p class="hint">Sin permiso, los recordatorios aparecen como aviso dentro de la app mientras la tengas abierta.</p></div>' +
        '<button type="button" class="btn" data-act="ask-notif">Permitir avisos</button></div></section>';
    }

    h += '<section class="card"><h2>Pendientes</h2>';
    if (!pend.length) h += '<p class="empty">Nada pendiente.</p>';
    pend.forEach(function (x) { h += reminderRow(x, false); });
    h += '</section>';

    if (done.length) {
      h += '<section class="card"><h2>Ya avisados</h2>';
      done.forEach(function (x) { h += reminderRow(x, false); });
      h += '</section>';
    }
    return h;
  }

  /* ---- Ajustes ---- */

  function viewAjustes() {
    var accents = [['clay', 'Arcilla'], ['teal', 'Verde'], ['indigo', 'Índigo'], ['ink', 'Tinta']];
    var h = topbar('Preferencias y datos', 'Ajustes', '');

    h += '<section class="card"><h2>Apariencia</h2>' +
      '<div class="field"><label>Tema</label><div class="seg" style="max-width:320px">' +
      ['system', 'light', 'dark'].map(function (t) {
        var names = { system: 'Auto', light: 'Claro', dark: 'Oscuro' };
        return '<button type="button" class="seg-btn" data-act="theme" data-theme="' + t + '" aria-pressed="' +
          (S.settings.theme === t) + '">' + names[t] + '</button>';
      }).join('') + '</div></div>' +
      '<div class="field"><label>Color de acento</label><div class="row wrap">' +
      accents.map(function (a) {
        return '<button type="button" class="btn sm" data-act="accent" data-accent="' + a[0] + '"' +
          (S.settings.accent === a[0] ? ' style="border-color:var(--accent);color:var(--accent)"' : '') + '>' + a[1] + '</button>';
      }).join('') + '</div></div></section>';

    h += '<section class="card"><h2>Bitácora</h2>' +
      '<div class="field"><label for="author">Tu nombre (va en el archivo exportado)</label>' +
      '<input id="author" type="text" data-act="author" value="' + esc(S.settings.author) + '" placeholder="Opcional"></div></section>';

    h += '<section class="card"><h2>Tus datos</h2>' +
      (MODE === 'archivo'
        ? '<p class="hint">Esta bitácora vive en <strong>' + esc(FILE_PATH) + '</strong>, dentro de la carpeta del proyecto. ' +
          'Es un archivo de texto: lo puedes editar tú o pedirle a Claude que lo haga, y la app recoge los cambios sola en unos segundos.</p>'
        : '<p class="hint">Todo se guarda en este navegador. Si borras los datos del sitio, se pierde: ' +
          'descarga una copia de vez en cuando.</p>') +
      '<div class="row wrap">' +
      '<button type="button" class="btn" data-act="backup">Descargar copia (.json)</button>' +
      '<button type="button" class="btn" data-act="restore">Restaurar desde archivo</button>' +
      '<button type="button" class="btn danger" data-act="wipe">Borrar todo</button>' +
      '</div>' +
      '<p class="hint">' + S.tasks.length + ' tareas · ' +
      S.tasks.reduce(function (a, t) { return a + (t.sessions || []).length; }, 0) + ' sesiones · ' +
      S.reminders.length + ' recordatorios</p></section>';

    h += '<section class="card"><h2>Resumen automático</h2>' +
      '<p class="hint">Hoy el resumen lo escribe Claude a partir del archivo que exportas: no hace falta ninguna clave. ' +
      'Para que la app lo genere sola haría falta una API key de Anthropic y un backend que la guarde; ' +
      'nunca se pone una clave en el navegador.</p></section>';
    return h;
  }

  /* ---------------- export ---------------- */

  function fileName(m) { return 'bitacora-' + weekTag(m) + (S.ui.tab === 'json' ? '.json' : '.md'); }

  function weekTasks(monday) {
    var from = monday.getTime(), to = addDays(monday, 7).getTime();
    return S.tasks.filter(function (t) {
      if (taskSeconds(t, from, to) > 0) return true;
      var closed = t.doneAt && new Date(t.doneAt).getTime() >= from && new Date(t.doneAt).getTime() < to;
      return !!closed;
    });
  }

  function sessionLines(t, from, to) {
    return sessionsOf(t).filter(function (s) { return spanSeconds(s, from, to) > 0; }).map(function (s) {
      var a = new Date(s.start), b = s.end ? new Date(s.end) : new Date();
      return DAYS[(a.getDay() + 6) % 7] + ' ' + hhmm(a) + '–' + hhmm(b) + ' (' + human(spanSeconds(s, from, to)) + ')';
    });
  }

  function buildMarkdown(monday) {
    var from = monday.getTime(), to = addDays(monday, 7).getTime();
    var w = weekData(monday);
    var inc = S.ui.includes;
    var tasks = weekTasks(monday);
    var mains = tasks.filter(function (t) { return t.kind === 'main'; });
    var sides = tasks.filter(function (t) { return t.kind === 'side'; });
    var last = addDays(monday, 6);
    var L = [];

    L.push('---');
    L.push('tipo: bitacora-semanal');
    L.push('semana: ' + weekTag(monday));
    L.push('rango: ' + ymd(monday) + ' / ' + ymd(last));
    L.push('corte: ' + localIso(new Date()));
    if (S.settings.author) L.push('autor: ' + S.settings.author);
    L.push('total: ' + human(w.total));
    L.push('---');
    L.push('');
    L.push('# Semana ' + isoWeek(monday).week + ' — ' + rangeLabel(monday, last));
    L.push('');
    L.push('## Tiempos');
    L.push('- Principales: ' + human(w.main) + (w.total ? ' (' + Math.round(w.main / w.total * 100) + '%)' : ''));
    L.push('- Secundarias: ' + human(w.side) + (w.total ? ' (' + Math.round(w.side / w.total * 100) + '%)' : ''));
    L.push('- Días con registro: ' + w.logged + ' de 7');
    w.days.forEach(function (d, i) {
      if (d.main + d.side > 0) L.push('- ' + DAYS[i] + ' ' + ymd(d.date) + ': ' + human(d.main + d.side));
    });
    L.push('');

    var porEpica = {};
    tasks.forEach(function (t) {
      var e = epicOfTask(t);
      var clave = e ? e.key : '(sin épica)';
      if (!porEpica[clave]) porEpica[clave] = { titulo: e ? e.title : 'Trabajo sin épica', seg: 0, n: 0 };
      porEpica[clave].seg += taskSeconds(t, from, to);
      porEpica[clave].n += 1;
    });
    var clavesEpica = Object.keys(porEpica).filter(function (k) { return porEpica[k].seg > 0; });
    if (clavesEpica.length) {
      L.push('## Tiempo por épica');
      clavesEpica.sort(function (a, b) { return porEpica[b].seg - porEpica[a].seg; }).forEach(function (k) {
        L.push('- ' + k + ' — ' + porEpica[k].titulo + ': ' + human(porEpica[k].seg) +
          ' (' + porEpica[k].n + (porEpica[k].n === 1 ? ' tarea)' : ' tareas)'));
      });
      L.push('');
    }

    L.push('## Tareas principales');
    if (!mains.length) L.push('_Sin tareas principales registradas._');
    mains.forEach(function (t) {
      var sp = subProgress(t);
      var col = COLS.filter(function (c) { return c.id === t.column; })[0];
      L.push('');
      L.push('### ' + t.title);
      if (t.project) L.push('- proyecto: ' + t.project);
      var ep = epicOfTask(t), hi = storyOfTask(t);
      if (ep) L.push('- épica: ' + ep.key + ' — ' + ep.title);
      if (hi) L.push('- historia: ' + hi.key + ' — ' + hi.title);
      if ((t.tags || []).length) L.push('- etiquetas: ' + t.tags.join(', '));
      L.push('- estado: ' + (col ? col.name : t.column));
      L.push('- tiempo en la semana: ' + human(taskSeconds(t, from, to)));
      L.push('- tiempo acumulado: ' + human(taskSeconds(t)));
      if (sp) {
        L.push('- subtareas: ' + sp.done + ' de ' + sp.total + ' cerradas');
        (t.subtasks || []).forEach(function (s) { L.push('  - [' + (s.done ? 'x' : ' ') + '] ' + s.title); });
      }
      var ses = sessionLines(t, from, to);
      if (ses.length) L.push('- sesiones: ' + ses.join('; '));
      if (t.note) L.push('- nota: ' + t.note.replace(/\s*\n\s*/g, ' / '));
    });
    L.push('');

    if (inc.side) {
      L.push('## Tareas secundarias');
      if (!sides.length) L.push('_Sin tareas secundarias._');
      sides.forEach(function (t) {
        var se = epicOfTask(t);
        L.push('- ' + t.title + ' — ' + human(taskSeconds(t, from, to)) +
          (t.project ? ' (' + t.project + ')' : '') +
          (se ? ' [' + se.key + ']' : '') +
          ((t.tags || []).length ? ' #' + t.tags.join(' #') : '') +
          (t.done ? ' · cerrada' : ''));
      });
      L.push('');
    }

    if (inc.board) {
      var moves = S.moves.filter(function (mv) {
        var x = new Date(mv.at).getTime();
        return x >= from && x < to;
      });
      L.push('## Movimientos del tablero');
      if (!moves.length) L.push('_Sin movimientos._');
      moves.forEach(function (mv) {
        var f = COLS.filter(function (c) { return c.id === mv.from; })[0];
        var t2 = COLS.filter(function (c) { return c.id === mv.to; })[0];
        var d = new Date(mv.at);
        L.push('- ' + mv.title + ': ' + (f ? f.name : mv.from) + ' → ' + (t2 ? t2.name : mv.to) +
          ' (' + DAYS[(d.getDay() + 6) % 7] + ' ' + hhmm(d) + ')');
      });
      L.push('');
    }

    if (inc.reminders) {
      var rems = S.reminders.filter(function (r) {
        var x = new Date((r.firedAt || r.at).replace(' ', 'T')).getTime();
        return x >= from && x < to;
      });
      L.push('## Recordatorios');
      if (!rems.length) L.push('_Sin recordatorios en la semana._');
      rems.forEach(function (r) {
        var d = new Date(r.at.replace(' ', 'T'));
        L.push('- ' + DAYS[(d.getDay() + 6) % 7] + ' ' + hhmm(d) + ' ' + r.text + ' — ' + (r.done ? 'avisado' : 'pendiente'));
      });
      L.push('');
    }

    if (inc.prompt) {
      L.push('## Qué necesito');
      L.push(PROMPT);
      L.push('');
    }
    return L.join('\n');
  }

  function buildJson(monday) {
    var from = monday.getTime(), to = addDays(monday, 7).getTime();
    var w = weekData(monday);
    var inc = S.ui.includes;
    var tasks = weekTasks(monday);
    var out = {
      tipo: 'bitacora-semanal',
      semana: weekTag(monday),
      rango: [ymd(monday), ymd(addDays(monday, 6))],
      corte: localIso(new Date()),
      autor: S.settings.author || undefined,
      totales: {
        minutos: Math.round(w.total / 60),
        principales_min: Math.round(w.main / 60),
        secundarias_min: Math.round(w.side / 60),
        dias_registrados: w.logged
      },
      dias: w.days.map(function (d, i) {
        return { dia: ymd(d.date), nombre: DAYS[i], principales_min: Math.round(d.main / 60), secundarias_min: Math.round(d.side / 60) };
      }),
      epicas: S.epics.map(function (e) {
        var suyas = tasksOfEpic(e.id);
        return {
          clave: e.key,
          titulo: e.title,
          terminada: !!e.done,
          minutos_semana: Math.round(suyas.reduce(function (a, t) { return a + taskSeconds(t, from, to); }, 0) / 60),
          historias: storiesOf(e.id).map(function (s) {
            return { clave: s.key, titulo: s.title, terminada: !!s.done, tareas: tasksOfStory(s.id).length };
          })
        };
      }).filter(function (e) { return e.minutos_semana > 0 || e.historias.length; }),
      principales: tasks.filter(function (t) { return t.kind === 'main'; }).map(function (t) {
        var pe = epicOfTask(t), ph = storyOfTask(t);
        return {
          titulo: t.title,
          proyecto: t.project || null,
          epica: pe ? pe.key : null,
          historia: ph ? ph.key : null,
          etiquetas: t.tags || [],
          estado: t.column,
          minutos_semana: Math.round(taskSeconds(t, from, to) / 60),
          minutos_total: Math.round(taskSeconds(t) / 60),
          subtareas: (t.subtasks || []).map(function (s) { return { titulo: s.title, hecha: !!s.done }; }),
          sesiones: sessionsOf(t).filter(function (s) { return spanSeconds(s, from, to) > 0; }).map(function (s) {
            var a = new Date(s.start), b = s.end ? new Date(s.end) : new Date();
            return { dia: ymd(a), de: hhmm(a), a: hhmm(b), minutos: Math.round(spanSeconds(s, from, to) / 60) };
          }),
          nota: t.note || null
        };
      })
    };
    if (inc.side) {
      out.secundarias = tasks.filter(function (t) { return t.kind === 'side'; }).map(function (t) {
        var xe = epicOfTask(t);
        return {
          titulo: t.title,
          minutos: Math.round(taskSeconds(t, from, to) / 60),
          epica: xe ? xe.key : null,
          etiquetas: t.tags || [],
          cerrada: !!t.done
        };
      });
    }
    if (inc.board) {
      out.tablero = S.moves.filter(function (mv) {
        var x = new Date(mv.at).getTime();
        return x >= from && x < to;
      }).map(function (mv) { return { tarjeta: mv.title, de: mv.from, a: mv.to, cuando: mv.at }; });
    }
    if (inc.reminders) {
      out.recordatorios = S.reminders.filter(function (r) {
        var x = new Date((r.firedAt || r.at).replace(' ', 'T')).getTime();
        return x >= from && x < to;
      }).map(function (r) { return { texto: r.text, cuando: r.at, avisado: !!r.done }; });
    }
    if (inc.prompt) out.instruccion = PROMPT;
    return JSON.stringify(out, null, 2);
  }

  /* ---------------- descargas y portapapeles ---------------- */

  var downloadsP = null;
  function downloads() {
    if (!downloadsP) {
      downloadsP = (window.claude && window.claude.use)
        ? window.claude.use('downloads').catch(function () { return null; })
        : Promise.resolve(null);
    }
    return downloadsP;
  }

  function saveFile(filename, text) {
    downloads().then(function (d) {
      if (d) {
        return d.save({ filename: filename, data: text }).then(function () { toast('Archivo guardado'); });
      }
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      toast('Descargando ' + filename);
    }).catch(function (err) {
      if (err && err.code === 'declined') return;
      toast('No se pudo descargar aquí. Usa Copiar y pega el texto.');
    });
  }

  function copyText(text) {
    var done = function () { toast('Copiado al portapapeles'); };
    var fail = function () { toast('No se pudo copiar: selecciona el texto del panel.'); };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fail);
        return;
      }
    } catch (e) { /* sigue el camino viejo */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      done();
    } catch (e2) { fail(); }
  }

  /* ---------------- diálogos ---------------- */

  function openDialog(title, body, foot) {
    document.getElementById('dlgTitle').textContent = title;
    document.getElementById('dlgBody').innerHTML = body;
    document.getElementById('dlgFoot').innerHTML = foot;
    if (!dlg.open) dlg.showModal();
    var first = dlg.querySelector('input, textarea, select');
    if (first) first.focus();
  }

  function taskDialog(id) {
    var t = taskById(id);
    if (!t) return;
    var elegida = epicOfTask(t);
    var list = projects().map(function (p) { return '<option value="' + esc(p) + '"></option>'; }).join('');
    var subs = (t.subtasks || []).map(function (s) {
      return '<label class="line clickable" style="padding:4px 10px">' +
        '<input type="checkbox" data-act="sub-toggle" data-id="' + t.id + '" data-sub="' + s.id + '"' + (s.done ? ' checked' : '') + '>' +
        '<span class="line-title">' + esc(s.title) + '</span>' +
        '<button type="button" class="icon-btn" data-act="sub-del" data-id="' + t.id + '" data-sub="' + s.id + '" aria-label="Quitar subtarea">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></label>';
    }).join('');

    var ses = (t.sessions || []).slice().reverse().slice(0, 8).map(function (s) {
      var a = new Date(s.start), b = s.end ? new Date(s.end) : new Date();
      return '<div class="line" style="padding:4px 10px"><span class="line-title mono" style="font-size:13px">' +
        ymd(a) + ' · ' + hhmm(a) + '–' + hhmm(b) + '</span>' +
        '<span class="chip mono">' + human(spanSeconds(s, 0, FAR)) + '</span>' +
        '<button type="button" class="icon-btn" data-act="sess-del" data-id="' + t.id + '" data-sess="' + s.id + '" aria-label="Borrar sesión">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"></path></svg></button></div>';
    }).join('');

    var body =
      '<div class="field"><label for="f-title">Título</label>' +
      '<input id="f-title" type="text" data-act="task-field" data-id="' + t.id + '" data-field="title" value="' + esc(t.title) + '"></div>' +
      '<div class="row wrap" style="gap:12px">' +
      '<div class="field grow"><label for="f-project">Proyecto</label>' +
      '<input id="f-project" type="text" list="proj-list" data-act="task-field" data-id="' + t.id + '" data-field="project" value="' + esc(t.project || '') + '" placeholder="Atlas, Soporte…">' +
      '<datalist id="proj-list">' + list + '</datalist></div>' +
      '<div class="field grow"><label for="f-col">Columna</label><select id="f-col" data-act="task-field" data-id="' + t.id + '" data-field="column">' +
      COLS.map(function (c) { return '<option value="' + c.id + '"' + (t.column === c.id ? ' selected' : '') + '>' + c.name + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div class="row wrap" style="gap:12px">' +
      '<div class="field grow"><label for="f-kind">Tipo</label><select id="f-kind" data-act="task-field" data-id="' + t.id + '" data-field="kind">' +
      '<option value="main"' + (t.kind === 'main' ? ' selected' : '') + '>Principal</option>' +
      '<option value="side"' + (t.kind === 'side' ? ' selected' : '') + '>Secundaria</option></select></div>' +
      '<div class="field grow"><label for="f-prio">Prioridad</label><select id="f-prio" data-act="task-field" data-id="' + t.id + '" data-field="priority">' +
      ['baja', 'normal', 'alta'].map(function (p) {
        return '<option value="' + p + '"' + (t.priority === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="row wrap" style="gap:12px">' +
      '<div class="field grow"><label for="f-epic-sel">Épica</label>' +
      '<select id="f-epic-sel" data-act="task-epic" data-id="' + t.id + '">' +
      '<option value="">Sin épica</option>' +
      S.epics.map(function (e) {
        return '<option value="' + e.id + '"' + (elegida && elegida.id === e.id ? ' selected' : '') + '>' +
          esc(e.key) + ' · ' + esc(e.title) + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field grow"><label for="f-story-sel">Historia de usuario</label>' +
      '<select id="f-story-sel" data-act="task-story" data-id="' + t.id + '"' + (elegida ? '' : ' disabled') + '>' +
      '<option value="">' + (elegida ? 'Sin historia' : 'Elige una épica primero') + '</option>' +
      (elegida ? storiesOf(elegida.id).map(function (s) {
        return '<option value="' + s.id + '"' + (t.storyId === s.id ? ' selected' : '') + '>' +
          esc(s.key) + ' · ' + esc(s.title) + '</option>';
      }).join('') : '') + '</select></div></div>' +
      '<div class="field"><label for="f-tags">Etiquetas</label>' +
      '<input id="f-tags" type="text" list="tag-list" data-act="task-tags" data-id="' + t.id + '" value="' +
      esc((t.tags || []).join(', ')) + '" placeholder="bug, deuda-tecnica, cliente-acme">' +
      '<datalist id="tag-list">' + allTags().map(function (g) {
        return '<option value="' + esc(g) + '"></option>';
      }).join('') + '</datalist>' +
      '<span class="hint">Separadas por comas. Se guardan en minúsculas y sin espacios.</span></div>' +
      '<div class="field"><label for="f-note">Nota para el resumen</label>' +
      '<textarea id="f-note" data-act="task-field" data-id="' + t.id + '" data-field="note" placeholder="Bloqueos, decisiones, lo que quedó pendiente…">' + esc(t.note || '') + '</textarea></div>' +
      '<div class="field"><label>Subtareas</label><div class="list">' + subs +
      '<form class="add-line" data-act="add-sub" data-id="' + t.id + '">' +
      '<label class="sr" for="f-sub">Nueva subtarea</label>' +
      '<input id="f-sub" class="grow" type="text" placeholder="Añadir subtarea y pulsar Enter" autocomplete="off"></form>' +
      '</div></div>' +
      '<div class="field"><label>Tiempo · ' + human(taskSeconds(t)) + ' en total</label><div class="list">' +
      (ses || '<div class="line"><span class="line-title hint">Sin sesiones todavía.</span></div>') +
      '<div class="line"><span class="line-title hint">Añadir tiempo olvidado</span>' +
      '<input type="number" id="f-mins" min="1" max="960" step="5" value="30" style="width:90px;min-height:36px" aria-label="Minutos">' +
      '<button type="button" class="btn sm" data-act="add-manual" data-id="' + t.id + '">Sumar</button></div>' +
      '</div></div>';

    var foot = '<button type="button" class="btn danger" data-act="del-task" data-id="' + t.id + '">Eliminar tarea</button>' +
      '<span class="grow"></span>' +
      '<button type="button" class="btn primary" data-act="dlg-close">Listo</button>';

    openDialog('Tarea', body, foot);
  }

  function epicDialog(id) {
    var e = id ? epicById(id) : null;
    var isNew = !e;
    if (isNew) e = { id: uid(), key: '', title: '', note: '', done: false };

    var body =
      '<div class="row wrap" style="gap:12px">' +
      '<div class="field" style="width:120px"><label for="e-key">Clave</label>' +
      '<input id="e-key" type="text" value="' + esc(e.key) + '" placeholder="auto" maxlength="8"></div>' +
      '<div class="field grow"><label for="e-title">Título de la épica</label>' +
      '<input id="e-title" type="text" value="' + esc(e.title) + '" placeholder="Facturación electrónica"></div></div>' +
      '<div class="field"><label for="e-note">Para qué es</label>' +
      '<textarea id="e-note" placeholder="El objetivo, el alcance, lo que queda fuera…">' + esc(e.note || '') + '</textarea></div>' +
      (isNew ? '' : '<label class="line clickable" style="border:1px solid var(--border);border-radius:var(--r-m)">' +
        '<input type="checkbox" id="e-done"' + (e.done ? ' checked' : '') + '>' +
        '<span class="line-title" style="font-weight:500">Épica terminada</span></label>');

    var foot = (isNew ? '' : '<button type="button" class="btn danger" data-act="del-epic" data-id="' + e.id + '">Eliminar</button>') +
      '<span class="grow"></span>' +
      '<button type="button" class="btn" data-act="dlg-close">Cancelar</button>' +
      '<button type="button" class="btn primary" data-act="save-epic" data-id="' + e.id + '" data-new="' + isNew + '">Guardar</button>';

    openDialog(isNew ? 'Nueva épica' : 'Épica', body, foot);
  }

  function saveEpic(id, isNew) {
    var title = document.getElementById('e-title').value.trim();
    if (!title) { toast('Ponle un título a la épica.'); return; }
    var key = document.getElementById('e-key').value.trim().toUpperCase().replace(/\s+/g, '-');
    var doneEl = document.getElementById('e-done');
    var otras = S.epics.filter(function (x) { return x.id !== id; }).map(function (x) { return x.key; });
    if (!key) key = keyFrom(title, otras);
    if (otras.indexOf(key) >= 0) { toast('Ya hay una épica con la clave ' + key + '.'); return; }

    var datos = {
      id: id, key: key, title: title,
      note: document.getElementById('e-note').value,
      done: doneEl ? doneEl.checked : false
    };
    if (isNew) { datos.createdAt = new Date().toISOString(); S.epics.push(datos); }
    else S.epics = S.epics.map(function (x) { return x.id === id ? Object.assign({}, x, datos) : x; });
    save();
    dlg.close();
    render();
    toast('Épica guardada');
  }

  function storyDialog(id, epicId) {
    var s = id ? storyById(id) : null;
    var isNew = !s;
    if (isNew) s = { id: uid(), epicId: epicId, key: nextStoryKey(), title: '', note: '', done: false };

    var body =
      '<div class="row wrap" style="gap:12px">' +
      '<div class="field" style="width:120px"><label for="s-key">Clave</label>' +
      '<input id="s-key" type="text" value="' + esc(s.key) + '" maxlength="12"></div>' +
      '<div class="field grow"><label for="s-epic">Épica</label><select id="s-epic">' +
      S.epics.map(function (e) {
        return '<option value="' + e.id + '"' + (s.epicId === e.id ? ' selected' : '') + '>' +
          esc(e.key) + ' · ' + esc(e.title) + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="field"><label for="s-title">Historia de usuario</label>' +
      '<input id="s-title" type="text" value="' + esc(s.title) + '" placeholder="Como cliente quiero descargar mi factura"></div>' +
      '<div class="field"><label for="s-note">Criterios de aceptación</label>' +
      '<textarea id="s-note" placeholder="Qué tiene que pasar para darla por cerrada">' + esc(s.note || '') + '</textarea></div>' +
      (isNew ? '' : '<label class="line clickable" style="border:1px solid var(--border);border-radius:var(--r-m)">' +
        '<input type="checkbox" id="s-done"' + (s.done ? ' checked' : '') + '>' +
        '<span class="line-title" style="font-weight:500">Historia terminada</span></label>');

    var foot = (isNew ? '' : '<button type="button" class="btn danger" data-act="del-story" data-id="' + s.id + '">Eliminar</button>') +
      '<span class="grow"></span>' +
      '<button type="button" class="btn" data-act="dlg-close">Cancelar</button>' +
      '<button type="button" class="btn primary" data-act="save-story" data-id="' + s.id + '" data-new="' + isNew + '">Guardar</button>';

    openDialog(isNew ? 'Nueva historia' : 'Historia de usuario', body, foot);
  }

  function saveStory(id, isNew) {
    var title = document.getElementById('s-title').value.trim();
    if (!title) { toast('Escribe la historia.'); return; }
    var datos = {
      id: id,
      epicId: document.getElementById('s-epic').value,
      key: document.getElementById('s-key').value.trim().toUpperCase() || nextStoryKey(),
      title: title,
      note: document.getElementById('s-note').value,
      done: (document.getElementById('s-done') || {}).checked || false
    };
    if (isNew) { datos.createdAt = new Date().toISOString(); S.stories.push(datos); }
    else S.stories = S.stories.map(function (x) { return x.id === id ? Object.assign({}, x, datos) : x; });
    save();
    dlg.close();
    render();
    toast('Historia guardada');
  }

  function reminderDialog(id) {
    var r = id ? S.reminders.filter(function (x) { return x.id === id; })[0] : null;
    var isNew = !r;
    if (isNew) {
      var at = new Date();
      at.setMinutes(at.getMinutes() + 30, 0, 0);
      r = { id: uid(), text: '', at: localIso(at), repeat: 'once', taskId: '', startTimer: false };
    }
    var parts = r.at.replace(' ', 'T').split('T');
    var opts = S.tasks.filter(function (t) { return !t.done; }).map(function (t) {
      return '<option value="' + t.id + '"' + (r.taskId === t.id ? ' selected' : '') + '>' + esc(t.title) + '</option>';
    }).join('');

    var body =
      '<div class="field"><label for="r-text">Recordarme</label>' +
      '<input id="r-text" type="text" value="' + esc(r.text) + '" placeholder="Enviar el avance del día"></div>' +
      '<div class="row wrap" style="gap:12px">' +
      '<div class="field grow"><label for="r-date">Día</label><input id="r-date" type="date" value="' + esc(parts[0]) + '"></div>' +
      '<div class="field grow"><label for="r-time">Hora</label><input id="r-time" type="time" value="' + esc(parts[1] || '09:00') + '"></div></div>' +
      '<div class="field"><label for="r-rep">Repetición</label><select id="r-rep">' +
      REPEATS.map(function (o) { return '<option value="' + o.id + '"' + (r.repeat === o.id ? ' selected' : '') + '>' + o.label + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label for="r-task">Vincular a una tarea</label><select id="r-task">' +
      '<option value="">Sin vincular</option>' + opts + '</select></div>' +
      '<label class="line clickable" style="border:1px solid var(--border);border-radius:var(--r-m)">' +
      '<input type="checkbox" id="r-timer"' + (r.startTimer ? ' checked' : '') + '>' +
      '<span class="line-title" style="font-weight:500">Arrancar el cronómetro al avisar</span></label>';

    var foot = (isNew ? '' : '<button type="button" class="btn danger" data-act="del-reminder" data-id="' + r.id + '">Eliminar</button>') +
      '<span class="grow"></span>' +
      '<button type="button" class="btn" data-act="dlg-close">Cancelar</button>' +
      '<button type="button" class="btn primary" data-act="save-reminder" data-id="' + r.id + '" data-new="' + isNew + '">Guardar</button>';

    openDialog(isNew ? 'Nuevo recordatorio' : 'Recordatorio', body, foot);
  }

  function saveReminder(id, isNew) {
    var text = document.getElementById('r-text').value.trim();
    if (!text) { toast('Escribe qué quieres recordar.'); return; }
    var date = document.getElementById('r-date').value;
    var time = document.getElementById('r-time').value || '09:00';
    if (!date) { toast('Falta el día.'); return; }
    var data = {
      id: id,
      text: text,
      at: date + 'T' + time,
      repeat: document.getElementById('r-rep').value,
      taskId: document.getElementById('r-task').value,
      startTimer: document.getElementById('r-timer').checked,
      done: false
    };
    if (isNew) S.reminders.push(data);
    else {
      S.reminders = S.reminders.map(function (r) { return r.id === id ? Object.assign({}, r, data) : r; });
    }
    save();
    dlg.close();
    render();
    toast('Recordatorio guardado');
  }

  /* ---------------- interacción ---------------- */

  function onClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    if (act === 'theme') { setTheme(el.getAttribute('data-theme')); return; }
    if (act === 'accent') { S.settings.accent = el.getAttribute('data-accent'); applyLook(); save(); render(); return; }
    if (act === 'timer') { toggleTimer(id); return; }
    if (act === 'stop') { stopTimer(); return; }
    if (act === 'edit') { taskDialog(id); return; }
    if (act === 'dlg-close') { dlg.close(); render(); return; }
    if (act === 'del-task') { deleteTask(id); dlg.close(); toast('Tarea eliminada'); return; }
    if (act === 'new-task') {
      var t = addTask('Tarea sin título', 'main');
      if (el.getAttribute('data-col')) moveTask(t, el.getAttribute('data-col'), true);
      save(); render(); taskDialog(t.id);
      return;
    }
    if (act === 'col-prev' || act === 'col-next') {
      var task = taskById(id);
      var i = COLS.map(function (c) { return c.id; }).indexOf(task.column);
      moveTask(task, COLS[Math.min(3, Math.max(0, i + (act === 'col-next' ? 1 : -1)))].id);
      return;
    }
    if (act === 'sub-del') {
      var t2 = taskById(id);
      t2.subtasks = t2.subtasks.filter(function (s) { return s.id !== el.getAttribute('data-sub'); });
      save(); taskDialog(id); render();
      return;
    }
    if (act === 'sess-del') {
      var t3 = taskById(id);
      t3.sessions = t3.sessions.filter(function (s) { return s.id !== el.getAttribute('data-sess'); });
      save(); taskDialog(id); render();
      return;
    }
    if (act === 'add-manual') {
      var mins = parseInt(document.getElementById('f-mins').value, 10);
      if (!mins || mins < 1) { toast('Pon los minutos que quieres sumar.'); return; }
      var t4 = taskById(id);
      var end = new Date();
      var start = new Date(end.getTime() - mins * 60000);
      t4.sessions = t4.sessions || [];
      t4.sessions.push({ id: uid(), start: start.toISOString(), end: end.toISOString(), manual: true });
      save(); taskDialog(id); render(); toast('Sumados ' + mins + ' minutos');
      return;
    }
    if (act === 'new-epic') { epicDialog(null); return; }
    if (act === 'edit-epic') { epicDialog(id); return; }
    if (act === 'save-epic') { saveEpic(id, el.getAttribute('data-new') === 'true'); return; }
    if (act === 'del-epic') {
      var hist = storiesOf(id).map(function (s) { return s.id; });
      S.tasks.forEach(function (t) {
        if (t.epicId === id) t.epicId = null;
        if (hist.indexOf(t.storyId) >= 0) { t.storyId = null; t.epicId = null; }
      });
      S.stories = S.stories.filter(function (s) { return s.epicId !== id; });
      S.epics = S.epics.filter(function (e) { return e.id !== id; });
      if (S.ui.filter.epic === id) S.ui.filter.epic = '';
      save(); dlg.close(); render();
      toast('Épica eliminada. Sus tareas siguen ahí, sin asignar.');
      return;
    }
    if (act === 'new-story') { storyDialog(null, id); return; }
    if (act === 'edit-story') { storyDialog(id, null); return; }
    if (act === 'save-story') { saveStory(id, el.getAttribute('data-new') === 'true'); return; }
    if (act === 'del-story') {
      S.tasks.forEach(function (t) { if (t.storyId === id) t.storyId = null; });
      S.stories = S.stories.filter(function (s) { return s.id !== id; });
      save(); dlg.close(); render();
      toast('Historia eliminada. Sus tareas siguen ahí, sin asignar.');
      return;
    }
    if (act === 'filter-tag') {
      var g = el.getAttribute('data-tag');
      S.ui.filter.tag = S.ui.filter.tag === g ? '' : g;
      if (S.ui.view !== 'kanban') location.hash = '#/kanban';
      else { save(); render(); }
      return;
    }
    if (act === 'filter-clear') { S.ui.filter = { epic: '', tag: '' }; save(); render(); return; }
    if (act === 'new-reminder') { reminderDialog(null); return; }
    if (act === 'edit-reminder') { reminderDialog(id); return; }
    if (act === 'save-reminder') { saveReminder(id, el.getAttribute('data-new') === 'true'); return; }
    if (act === 'del-reminder') {
      S.reminders = S.reminders.filter(function (r) { return r.id !== id; });
      save(); if (dlg.open) dlg.close(); render(); toast('Recordatorio eliminado');
      return;
    }
    if (act === 'ask-notif') { askNotifications(); return; }
    if (act === 'week') {
      var delta = parseInt(el.getAttribute('data-delta'), 10);
      S.ui.weekOffset = delta === 0 ? 0 : S.ui.weekOffset + delta;
      save(); render();
      return;
    }
    if (act === 'tab') { S.ui.tab = el.getAttribute('data-tab'); save(); render(); return; }
    if (act === 'copy') {
      var m = currentMonday();
      copyText(S.ui.tab === 'json' ? buildJson(m) : buildMarkdown(m));
      return;
    }
    if (act === 'download') {
      var m2 = currentMonday();
      saveFile(fileName(m2), S.ui.tab === 'json' ? buildJson(m2) : buildMarkdown(m2));
      return;
    }
    if (act === 'clear-examples') {
      S.tasks = S.tasks.filter(function (t) { return !t.example; });
      S.reminders = S.reminders.filter(function (r) { return !r.example; });
      if (S.timer && !taskById(S.timer.taskId)) S.timer = null;
      save(); render(); toast('Ejemplos borrados');
      return;
    }
    if (act === 'backup') {
      saveFile('bitacora-copia-' + ymd(new Date()) + '.json', JSON.stringify(S, null, 2));
      return;
    }
    if (act === 'restore') { restore(); return; }
    if (act === 'wipe') {
      if (window.confirm('Esto borra todas las tareas, sesiones y recordatorios de este navegador. ¿Seguir?')) {
        S = blank();
        save(); applyLook(); render(); toast('Todo borrado');
      }
      return;
    }
  }

  function onChange(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');

    if (act === 'toggle-done') { toggleDone(taskById(id)); return; }
    if (act === 'include') { S.ui.includes[id] = el.checked; save(); render(); return; }
    if (act === 'author') { S.settings.author = el.value; save(); return; }
    if (act === 'sub-toggle') {
      var t = taskById(id), sid = el.getAttribute('data-sub');
      t.subtasks.forEach(function (s) { if (s.id === sid) s.done = el.checked; });
      save(); render();
      return;
    }
    if (act === 'task-epic') {
      var te = taskById(id);
      te.epicId = el.value || null;
      te.storyId = null;
      save(); taskDialog(id); render();
      return;
    }
    if (act === 'task-story') {
      var ts = taskById(id);
      ts.storyId = el.value || null;
      if (ts.storyId) {
        var st = storyById(ts.storyId);
        ts.epicId = st ? st.epicId : ts.epicId;
      }
      save(); render();
      return;
    }
    if (act === 'task-tags') {
      var tt = taskById(id);
      tt.tags = parseTags(el.value);
      save(); render();
      return;
    }
    if (act === 'filter-epic') { S.ui.filter.epic = el.value; save(); render(); return; }
    if (act === 'task-field') {
      var t2 = taskById(id), f = el.getAttribute('data-field');
      if (f === 'column') moveTask(t2, el.value, true);
      else t2[f] = el.value;
      if (f === 'title' && !el.value.trim()) t2.title = 'Tarea sin título';
      save(); render();
      return;
    }
  }

  function onSubmit(e) {
    var form = e.target.closest('[data-act]');
    if (!form) return;
    e.preventDefault();
    var act = form.getAttribute('data-act');
    if (act === 'add-task') {
      var input = form.querySelector('input');
      var t = addTask(input.value, form.getAttribute('data-kind'));
      input.value = '';
      if (t) { render(); var again = document.getElementById(input.id); if (again) again.focus(); }
      return;
    }
    if (act === 'add-sub') {
      var id = form.getAttribute('data-id');
      var inp = form.querySelector('input');
      var title = inp.value.trim();
      if (!title) return;
      var task = taskById(id);
      task.subtasks = task.subtasks || [];
      task.subtasks.push({ id: uid(), title: title, done: false });
      save(); taskDialog(id); render();
      var el = document.getElementById('f-sub');
      if (el) el.focus();
      return;
    }
  }

  function restore() {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'application/json,.json';
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var data = JSON.parse(fr.result);
          if (!data || !data.tasks) throw new Error('formato');
          S = data;
          S.ui = Object.assign(blank().ui, S.ui || {});
          S.settings = Object.assign(blank().settings, S.settings || {});
          save(); applyLook(); render();
          toast('Copia restaurada');
        } catch (err) {
          toast('Ese archivo no es una copia de la bitácora.');
        }
      };
      fr.readAsText(f);
    });
    inp.click();
  }

  /* ---------------- tema, rutas, latido ---------------- */

  function setTheme(t) {
    S.settings.theme = t;
    applyLook();
    save();
    render();
  }

  function applyLook() {
    var root = document.documentElement;
    if (S.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', S.settings.theme);
    if (S.settings.accent && S.settings.accent !== 'clay') root.setAttribute('data-accent', S.settings.accent);
    else root.removeAttribute('data-accent');
  }

  function route() {
    var h = (location.hash || '').replace('#/', '');
    var known = ['hoy', 'kanban', 'backlog', 'semana', 'recordatorios', 'ajustes'];
    S.ui.view = known.indexOf(h) >= 0 ? h : 'hoy';
    save();
    render();
  }

  function refreshLive() {
    var r = todayRange();
    var nodes = document.querySelectorAll('[data-live]');
    for (var i = 0; i < nodes.length; i++) {
      var k = nodes[i].getAttribute('data-live');
      if (k === 'today') nodes[i].textContent = hms(rangeSeconds(r[0], r[1]));
      else if (k === 'clock') nodes[i].textContent = hms(runningSeconds());
      else if (k.indexOf('task:') === 0) {
        var t = taskById(k.slice(5));
        if (!t) continue;
        nodes[i].textContent = S.ui.view === 'kanban' ? hm(taskSeconds(t)) : hm(taskSeconds(t, r[0], r[1]));
      }
    }
  }

  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 3200);
  }

  function init() {
    viewEl = document.getElementById('view');
    bannerEl = document.getElementById('banner');
    toastEl = document.getElementById('toast');
    dlg = document.getElementById('dlg');

    probeFile().then(function (onFile) {
      if (!onFile) S = loadLocal();
      boot();
    });
  }

  function boot() {
    applyLook();

    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    window.addEventListener('hashchange', route);
    dlg.addEventListener('close', function () { render(); });
    window.addEventListener('beforeunload', flushOnExit);

    if (!location.hash) location.hash = '#/hoy';
    route();

    setInterval(refreshLive, 1000);
    setInterval(checkReminders, 20000);
    if (MODE === 'archivo') setInterval(pollFile, 2500);
    checkReminders();
    save();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
