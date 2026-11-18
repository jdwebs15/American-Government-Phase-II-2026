'use strict';

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function repeatsPattern(tail, next) {
  const sequence = [...tail, next];
  return [1, 2, 3, 4].some(period => {
    const size = period === 1 ? 3 : 2 * period;
    const end = sequence.slice(-size);
    return end.length === size && end.slice(period).every((value, i) => value === end[i]);
  }) || (sequence.length >= 4 && [1, 3].some(step =>
    sequence.slice(-4).every((value, i, cycle) => value === (cycle[0] + i * step) % 4)
  ));
}

function balancedPositions(count) {
  const limits = [0, 0, 0, 0].map(() => Math.floor(count / 4));
  shuffle([0, 1, 2, 3]).slice(0, count % 4).forEach(i => limits[i]++);
  function extend(prefix) {
    if (prefix.length === count) return prefix;
    for (const position of shuffle([0, 1, 2, 3])) {
      if (!limits[position] || repeatsPattern(prefix.slice(-7), position)) continue;
      limits[position]--;
      const result = extend([...prefix, position]);
      if (result) return result;
      limits[position]++;
    }
    return null;
  }
  return extend([]);
}

function makeRun(questions, previous = []) {
  let ordered;
  do {
    ordered = shuffle(questions);
  } while (questions.length > 1 && ordered.every((q, i) => q.id === previous[i]?.id));
  const prior = new Map(previous.map(item => [item.id, item.choices.map(c => c.text)]));
  return balancedPositions(questions.length).map((position, i) => {
    const q = ordered[i];
    let choices;
    do {
      choices = shuffle(q.choices.filter((_, index) => index !== q.answer))
        .map(text => ({text, correct: false}));
      choices.splice(position, 0, {text: q.choices[q.answer], correct: true});
    } while (choices.every((choice, index) => choice.text === prior.get(q.id)?.[index]));
    return {id: q.id, choices};
  });
}

if (typeof module !== 'undefined') module.exports = {makeRun, repeatsPattern};

if (typeof window !== 'undefined') (() => {
  const config = window.GOV_CONFIG;
  const bank = window.GOV_QUESTIONS;
  const questions = new Map(bank.map(q => [q.id, q]));
  const review = config.mode === 'review';
  const $ = id => document.getElementById(id);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[c]);
  let state, locked = false, advanceTimer, saveTimer, lastTick = Date.now();
  const identity = () => ({
    name: $('studentName').value.trim(), period: $('period').value,
    email: $('email').value.trim().toLowerCase()
  });
  const key = () => config.assignmentKey + '|' + identity().email;
  const valid = () => {
    const student = identity();
    const ok = student.name && student.period && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email);
    if (!ok) $('saveStatus').textContent = 'Enter full name, period, and school email.';
    return ok;
  };
  const fresh = () => ({
    student: identity(), run: [], index: 0, score: 0, totalAttempts: 0, firstScore: 0,
    firstAnswered: 0, runs: 0, history: [], status: 'in_progress', sessions: 0,
    firstStart: new Date().toISOString(), activeSeconds: 0, awaySeconds: 0,
    tabLeaves: 0, copies: 0, pastes: 0, questionSeconds: {}, copyByQuestion: {}, pasteByQuestion: {}
  });
  const local = () => {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(key(), JSON.stringify(state)); } catch {}
  };
  function restore(candidate) {
    if (!candidate || candidate.student?.email !== identity().email ||
        candidate.run?.length !== bank.length || !candidate.run.every(item => questions.has(item.id))) return false;
    state = candidate;
    return true;
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(key())); } catch { return null; }
  }
  function tick() {
    const now = Date.now(), elapsed = (now - lastTick) / 1000;
    lastTick = now;
    if (state?.status !== 'in_progress' || !state.run.length) return;
    state[document.hidden ? 'awaySeconds' : 'activeSeconds'] += elapsed;
    const id = state.run[state.index]?.id;
    if (id && !document.hidden) state.questionSeconds[id] = (state.questionSeconds[id] || 0) + elapsed;
  }
  function payload(resetRequested) {
    const {student, run, score, index, status} = state;
    const answers = Object.fromEntries(run.filter(item => item.last !== undefined).map(item => [item.id, item.last]));
    const mastered = Object.fromEntries(run.filter(item => item.mastered).map(item => [item.id, true]));
    return {
      ...student, student, course: 'Government', assignmentKey: config.assignmentKey,
      assignmentTitle: config.title, action: status === 'completed' ? 'submit' : 'save',
      status: status === 'completed' ? 'submitted' : status, resetRequested, runId: state.runId,
      state, answers, mastered, accepted: mastered, score: review ? score : state.firstScore,
      total: bank.length, totalQuestions: bank.length, answerCount: Object.keys(answers).length,
      percent: Math.round((review ? score : state.firstScore) * 100 / bank.length),
      totalAttempts: state.totalAttempts, firstAttemptScore: review ? score : state.firstScore,
      wrongAttempts: state.totalAttempts - state.history.reduce((sum, row) => sum + row.score, 0)
        - (state.history.at(-1)?.runId === state.runId ? 0 : score),
      mastery: score, startedAt: state.firstStart, completedAt: status === 'completed' ? state.lastEnd : '',
      updatedAt: new Date().toISOString(), runs: state.runs, runHistory: state.history,
      activeSeconds: Math.round(state.activeSeconds), awaySeconds: Math.round(state.awaySeconds),
      tabLeaves: state.tabLeaves, copies: state.copies, pastes: state.pastes,
      telemetry: {activeSeconds: state.activeSeconds, awaySeconds: state.awaySeconds,
        tabLeaves: state.tabLeaves, copies: state.copies, pastes: state.pastes,
        sessionCount: state.sessions, questionTimes: state.questionSeconds,
        copyByQuestion: state.copyByQuestion, pasteByQuestion: state.pasteByQuestion}
    };
  }
  let pendingSave = Promise.resolve();
  function send(manual = false, reset = false) {
    if (!state?.run.length) return;
    clearTimeout(saveTimer);
    tick();
    local();
    const body = JSON.stringify(payload(reset));
    pendingSave = pendingSave.then(async () => {
      try {
        await fetch(window.GOV_ENDPOINT, {method:'POST', mode:'no-cors',
          headers:{'Content-Type':'text/plain;charset=utf-8'}, body, signal: AbortSignal.timeout(10000)});
        if (manual) setStatus('Saved on this device. Copy sent to your teacher.');
      } catch {
        if (manual) setStatus('Saved on this device. Teacher save could not be confirmed.');
      }
    });
  }
  function setStatus(message) {
    $('saveStatus').textContent = message;
    $('submitStatus').textContent = message;
    $('workStatus').textContent = message;
  }
  function scheduleSave() {
    local();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => send(), 700);
  }
  function startRun(previous = state.run) {
    clearTimeout(advanceTimer);
    locked = false;
    state.run = makeRun(bank, previous);
    state.index = state.score = state.firstScore = state.firstAnswered = 0;
    state.runs++;
    state.runId = crypto.randomUUID?.() || Date.now() + '-' + Math.random();
    state.status = 'in_progress';
    lastTick = Date.now();
    scheduleSave();
    render();
  }
  function open() {
    $('studentPanel').classList.add('hidden');
    state.sessions++;
    lastTick = Date.now();
    if (!state.run.length) startRun(); else render();
  }
  function begin() {
    if (!valid()) return;
    state = fresh();
    restore(readLocal());
    open();
  }
  function load() {
    if (!valid()) return;
    const student = identity();
    const callback = 'govLoad_' + Date.now();
    const script = document.createElement('script');
    const finish = result => {
      clearTimeout(timeout);
      delete window[callback];
      script.remove();
      $('startBtn').disabled = $('loadBtn').disabled = false;
      if (identity().email !== student.email) return;
      state = fresh();
      const localState = readLocal();
      const remote = result?.payload?.state;
      const preferLocal = Date.parse(localState?.savedAt) > Date.parse(remote?.savedAt);
      if (restore(preferLocal ? localState : remote) || restore(localState)) open();
      else setStatus(result ? 'No previous work was found. Select Start to begin.' : 'Could not load a teacher draft.');
    };
    window[callback] = finish;
    script.onerror = () => finish(null);
    const timeout = setTimeout(() => finish(null), 10000);
    const query = new URLSearchParams({action:'load', course:'Government', assignmentKey:config.assignmentKey,
      email:student.email, callback, _:Date.now()});
    script.src = window.GOV_ENDPOINT + '?' + query;
    $('startBtn').disabled = $('loadBtn').disabled = true;
    setStatus('Loading previous work…');
    document.body.append(script);
  }
  function restart(confirmFirst) {
    if (confirmFirst && !confirm('Start over with a fresh question and answer order?')) return;
    const previous = state.run;
    if (!review) {
      state = fresh();
      state.sessions = 1;
    }
    startRun(previous);
    send(false, !review);
  }
  const sliderLabels = {
    taxes:['Federal taxes','Lower','Raise'], spending:['Federal spending','Decrease','Increase'],
    discount:['Discount rate','Lower','Raise'], securities:['Open-market operations','Sell','Buy'],
    reserves:['Reserve requirements (textbook model)','Lower','Raise']
  };
  function sliders(q, item) {
    if (!q.sliders?.length) return '';
    return '<fieldset class="source-box"><legend>Set policy tools</legend>' + q.sliders.map(([tool], i) => {
      const [label, down, up] = sliderLabels[tool];
      const value = item.tools?.[i] || 0;
      return `<label>${label} <input type="range" min="-1" max="1" step="1" value="${value}" data-tool="${i}" aria-label="${label}"><span>${[down,'Unchanged',up][value+1]}</span></label>`;
    }).join('') + '</fieldset>';
  }
  const source = q => q.source
    ? `<div class="source-box"><a href="${escape(q.source)}" target="_blank" rel="noopener noreferrer">Open source ↗</a><p><strong>Where to look</strong> ${escape(q.where)}</p></div>`
    : '';
  function render() {
    $('workspace').classList.toggle('hidden', state.status === 'completed');
    $('completion').classList.toggle('hidden', state.status !== 'completed');
    if (state.status === 'completed') {
      const redo = bank.length === 40 && state.totalAttempts > 50;
      $('completionHeading').textContent = redo ? 'Assignment complete · redo required' : 'Completion ticket earned';
      $('ticketLabel').textContent = redo ? 'REDO REQUIRED' : 'COMPLETION TICKET';
      $('studentTicket').innerHTML = `<strong class="ticket-name">${escape(state.student.name)}</strong><br><strong class="ticket-name">${state.totalAttempts} TOTAL ATTEMPTS</strong><br>Period ${escape(state.student.period)} · ${escape(config.title)}`;
      $('completionSummary').textContent = review ? `Perfect run 30/30 · ${state.runs} total runs` :
        `Mastery ${state.score}/${bank.length} · First-attempt score ${state.firstScore}/${bank.length}`;
      return;
    }
    $('progressStat').textContent = `${Math.min(state.index + 1, bank.length)} / ${bank.length}`;
    $('accuracyStat').textContent = review ? `Run ${state.runs}` : `${state.firstScore} / ${state.firstAnswered}`;
    $('progressFill').style.width = (state.index * 100 / bank.length) + '%';
    const card = $('questionCard');
    if (state.status === 'retry_required') {
      card.innerHTML = `<h2>Run ${state.runs} complete</h2><p>Score ${state.score}/30. A perfect run earns the completion ticket.</p><button id="retry">Retake all 30 questions</button>`;
      $('retry').onclick = () => restart(false);
      return;
    }
    const item = state.run[state.index];
    const q = questions.get(item.id);
    card.innerHTML = `<h2>${escape(q.topic || config.cs)}</h2>
      ${q.reading ? `<div class="source-box"><strong>${escape(q.readingTitle || 'Read the passage')}</strong><p>${escape(q.reading)}</p></div>` : ''}
      <p class="prompt">${escape(q.prompt)}</p>${source(q)}${sliders(q,item)}
      <div class="choices">${item.choices.map((c,i) => `<button class="choice" data-choice="${i}" ${item.wrong?.includes(i) ? 'disabled' : ''}><span class="choice-letter">${'ABCD'[i]}.</span><span>${escape(c.text)}</span></button>`).join('')}</div>
      <div id="feedback" class="feedback" role="status"></div>`;
    card.querySelectorAll('[data-tool]').forEach(input => {
      input.oninput = () => {
        const i = Number(input.dataset.tool);
        const value = Number(input.value);
        (item.tools ||= {})[i] = value;
        const [, down, up] = sliderLabels[q.sliders[i][0]];
        input.nextElementSibling.textContent = [down,'Unchanged',up][value+1];
        local();
      };
    });
    card.querySelectorAll('[data-choice]').forEach(button => {
      button.onclick = () => answer(Number(button.dataset.choice), button);
    });
    if (item.wrong?.length) showHint(q);
  }
  function showHint(q) {
    $('feedback').className = 'feedback bad';
    $('feedback').textContent = 'Not yet. ' + q.hint;
  }
  function answer(i, button) {
    if (locked || state.status !== 'in_progress') return;
    tick();
    const item = state.run[state.index];
    const q = questions.get(item.id);
    const matchedTools = !q.sliders?.length || q.sliders.every(([, target], index) => (item.tools?.[index] || 0) === target);
    const correct = matchedTools && item.choices[i].correct;
    state.totalAttempts++;
    item.last = i;
    if (!item.answered) {
      item.answered = true;
      state.firstAnswered++;
      if (correct) state.firstScore++;
    }
    if (!review && !correct) {
      if (matchedTools) {
        (item.wrong ||= []).push(i);
        button.disabled = true;
      }
      showHint(q);
      if (!matchedTools) $('feedback').textContent = 'Not yet. Check the direction of each policy tool, then try again.';
      scheduleSave();
      return;
    }
    if (correct) {
      state.score++;
      item.mastered = true;
    }
    state.index++;
    if (state.index === bank.length) {
      state.lastEnd = new Date().toISOString();
      state.history.push({run:state.runs, runId:state.runId, score:state.score, finished:state.lastEnd});
      state.status = review && state.score !== bank.length ? 'retry_required' : 'completed';
    }
    locked = true;
    document.querySelectorAll('[data-choice]').forEach(choice => choice.disabled = true);
    $('feedback').className = 'feedback good';
    $('feedback').textContent = review ? 'Answer recorded.' : 'Correct. ' + q.explanation;
    scheduleSave();
    advanceTimer = setTimeout(() => {
      locked = false;
      render();
      if (state.status !== 'in_progress') send();
    }, review ? 250 : 650);
  }
  $('pageTitle').textContent = config.title;
  $('eyebrow').textContent = 'BLOCK ' + config.block + ' • ' + config.cs + ' • ' + config.type.toUpperCase();
  $('pageDescription').textContent = config.description;
  $('masteryRule').textContent = bank.length + ' questions per run';
  $('features').textContent = review ? 'Randomized runs · 30/30 completion ticket' : 'Correctable mastery · Hints after misses · Saved progress';
  $('practiceText').textContent = config.cs + ' · ' + config.title.split(' — ')[0];
  $('rulesList').innerHTML = review
    ? '<li>Choose one answer per question.</li><li>Earn 30/30 on any complete run.</li><li>Retakes reshuffle all questions and choices.</li>'
    : '<li>Correct every question to finish.</li><li>Use the hint after a missed answer.</li>' + (bank.length === 40 ? '<li>51 or more attempts require a redo.</li>' : '');
  $('accuracyStat').nextElementSibling.textContent = review ? 'Current run' : 'First-attempt score';
  $('startBtn').onclick = begin;
  $('loadBtn').onclick = load;
  $('saveBtn').hidden = true;
  $('saveWork').onclick = () => send(true);
  $('submitBtn').onclick = () => send(true);
  $('resetBtn').onclick = () => restart(true);
  $('restartBtn').onclick = () => restart(true);
  document.addEventListener('visibilitychange', () => {
    if (state && document.hidden && state.status === 'in_progress') state.tabLeaves++;
    tick();
    if (state) local();
  });
  for (const event of ['copy','paste']) document.addEventListener(event, () => {
    if (!state || state.status !== 'in_progress') return;
    const id = state.run[state.index]?.id;
    if (!id) return;
    const byQuestion = state[event + 'ByQuestion'];
    byQuestion[id] = (byQuestion[id] || 0) + 1;
    state[event === 'copy' ? 'copies' : 'pastes']++;
    local();
  });
  window.addEventListener('pagehide', () => { if (state) { tick(); local(); } });
  setInterval(() => {
    if (!state) return;
    tick();
    $('runtimeStat').textContent = Math.floor(state.activeSeconds / 60) + ':' + String(Math.floor(state.activeSeconds % 60)).padStart(2,'0');
  }, 1000);
})();
