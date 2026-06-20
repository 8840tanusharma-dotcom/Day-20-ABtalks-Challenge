'use strict';

(function () {

  const state = {
    stream: null,
    facingMode: 'user',
    capturedDataUrl: null,
    capturedImage: null,
    gridSize: null,
    pieces: [],
    boardSize: 0,
    cellSize: 0,
    timerStart: null,
    timerInterval: null,
    elapsedMs: 0,
    timerRunning: false,
    moves: 0,
    placedCount: 0,
    dragInfo: null,
    resizeRaf: null
  };

  const STORAGE_KEY = 'facePuzzle.bestTimes.v1';

  const $ = (id) => document.getElementById(id);

  const dom = {
    topbarMeta: $('topbarMeta'),
    hudTime: $('hudTime'),
    hudMoves: $('hudMoves'),
    hudPlaced: $('hudPlaced'),

    screenCamera: $('screenCamera'),
    screenReview: $('screenReview'),
    screenPuzzle: $('screenPuzzle'),

    video: $('video'),
    captureCanvas: $('captureCanvas'),
    viewfinder: $('viewfinder'),
    cameraState: $('cameraState'),
    stateLoading: $('stateLoading'),
    stateDenied: $('stateDenied'),
    deniedReason: $('deniedReason'),
    retryCameraBtn: $('retryCameraBtn'),
    fileInput: $('fileInput'),
    captureBtn: $('captureBtn'),
    switchCamBtn: $('switchCamBtn'),
    flash: $('flash'),

    previewCanvas: $('previewCanvas'),
    difficultyList: $('difficultyList'),
    retakeBtn: $('retakeBtn'),
    startPuzzleBtn: $('startPuzzleBtn'),

    puzzleDiffPill: $('puzzleDiffPill'),
    timerDisplay: $('timerDisplay'),
    movesDisplay: $('movesDisplay'),
    placedDisplay: $('placedDisplay'),
    peekBtn: $('peekBtn'),
    shuffleAgainBtn: $('shuffleAgainBtn'),
    board: $('board'),
    ghostImage: $('ghostImage'),

    resultsOverlay: $('resultsOverlay'),
    resultImage: $('resultImage'),
    resultTime: $('resultTime'),
    resultMoves: $('resultMoves'),
    resultDiff: $('resultDiff'),
    leaderboardList: $('leaderboardList'),
    leaderboardDiffLabel: $('leaderboardDiffLabel'),
    newPhotoBtn: $('newPhotoBtn'),
    playAgainBtn: $('playAgainBtn'),

    toast: $('toast')
  };

  let toastTimer = null;
  function showToast(msg, duration = 2600) {
    dom.toast.textContent = msg;
    dom.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { dom.toast.hidden = true; }, duration);
  }

  function setCameraUIState(mode) {
    if (mode === 'loading') {
      dom.cameraState.style.display = 'flex';
      dom.stateLoading.hidden = false;
      dom.stateDenied.hidden = true;
      dom.captureBtn.disabled = true;
    } else if (mode === 'ready') {
      dom.cameraState.style.display = 'none';
      dom.captureBtn.disabled = false;
    } else if (mode === 'denied') {
      dom.cameraState.style.display = 'flex';
      dom.stateLoading.hidden = true;
      dom.stateDenied.hidden = false;
      dom.captureBtn.disabled = true;
    }
  }

  async function startCamera(preferredFacing) {
    setCameraUIState('loading');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      dom.deniedReason.textContent = 'This browser does not support camera access. Try Chrome, Firefox, or Safari, or upload a photo instead.';
      setCameraUIState('denied');
      return;
    }

    stopCamera();

    const constraintsList = [
      { video: { facingMode: { ideal: preferredFacing || 'user' }, width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false },
      { video: { facingMode: preferredFacing || 'user' }, audio: false },
      { video: true, audio: false }
    ];

    let lastError = null;
    for (const constraints of constraintsList) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        state.stream = stream;
        dom.video.srcObject = stream;
        await dom.video.play().catch(() => {});
        setCameraUIState('ready');
        detectMultipleCameras();
        return;
      } catch (err) {
        lastError = err;
      }
    }

    handleCameraError(lastError);
  }

  function handleCameraError(err) {
    let msg = "We couldn't reach your camera. Check your browser's permission settings and try again — or upload a photo instead.";
    if (err) {
      const name = err.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        msg = 'Camera permission was denied. Allow camera access in your browser settings, then try again — or upload a photo instead.';
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        msg = 'No camera was found on this device. You can upload a photo instead.';
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        msg = 'Your camera is already in use by another app. Close it and try again, or upload a photo instead.';
      } else if (name === 'OverconstrainedError') {
        msg = "Your camera doesn't support the requested settings. Try again or upload a photo instead.";
      } else if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        msg = 'Camera access requires a secure connection (HTTPS). Upload a photo instead, or open this page over HTTPS.';
      }
    }
    dom.deniedReason.textContent = msg;
    setCameraUIState('denied');
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach((t) => t.stop());
      state.stream = null;
    }
  }

  async function detectMultipleCameras() {
    try {
      if (!navigator.mediaDevices.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cams = devices.filter((d) => d.kind === 'videoinput');
      dom.switchCamBtn.hidden = cams.length < 2;
    } catch {
      dom.switchCamBtn.hidden = true;
    }
  }

  function flipCamera() {
    state.facingMode = state.facingMode === 'user' ? 'environment' : 'user';
    startCamera(state.facingMode);
  }

  function takePhoto() {
    if (!dom.video.videoWidth) {
      showToast("Camera isn't ready yet — give it a second.");
      return;
    }
    dom.flash.classList.remove('fire');
    void dom.flash.offsetWidth;
    dom.flash.classList.add('fire');

    const vw = dom.video.videoWidth;
    const vh = dom.video.videoHeight;
    const side = Math.min(vw, vh);
    const sx = (vw - side) / 2;
    const sy = (vh - side) / 2;

    const canvas = dom.captureCanvas;
    const outputSize = 800;
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext('2d');

    ctx.save();
    ctx.translate(outputSize, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(dom.video, sx, sy, side, side, 0, 0, outputSize, outputSize);
    ctx.restore();

    finalizeCapture(canvas.toDataURL('image/jpeg', 0.92));
  }

  function handleFileUpload(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please choose an image file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = dom.captureCanvas;
        const outputSize = 800;
        canvas.width = outputSize;
        canvas.height = outputSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, outputSize, outputSize);
        finalizeCapture(canvas.toDataURL('image/jpeg', 0.92));
      };
      img.onerror = () => showToast("Couldn't load that image — try another file.");
      img.src = e.target.result;
    };
    reader.onerror = () => showToast("Couldn't read that file — try another.");
    reader.readAsDataURL(file);
  }

  function finalizeCapture(dataUrl) {
    state.capturedDataUrl = dataUrl;
    const img = new Image();
    img.onload = () => {
      state.capturedImage = img;
      drawPreview();
      goToScreen('review');
    };
    img.src = dataUrl;
  }

  function drawPreview() {
    const canvas = dom.previewCanvas;
    const cssSize = canvas.parentElement.clientWidth - 28;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.max(280, cssSize);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(state.capturedImage, 0, 0, size, size);
  }

  function goToScreen(name) {
    const screens = { camera: dom.screenCamera, review: dom.screenReview, puzzle: dom.screenPuzzle };
    Object.entries(screens).forEach(([key, el]) => {
      el.dataset.active = key === name ? 'true' : 'false';
    });
    dom.topbarMeta.hidden = name !== 'puzzle';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (name === 'camera') {
      if (!state.stream) startCamera(state.facingMode);
    } else {
      stopCamera();
    }
  }

  function setupDifficultyCards() {
    const cards = Array.from(dom.difficultyList.querySelectorAll('.diff-card'));
    cards.forEach((card) => {
      card.addEventListener('click', () => {
        cards.forEach((c) => c.setAttribute('aria-checked', 'false'));
        card.setAttribute('aria-checked', 'true');
        state.gridSize = parseInt(card.dataset.size, 10);
        dom.startPuzzleBtn.disabled = false;
      });
    });
  }

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function generateScramble(n) {
    const total = n * n;
    const positions = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) positions.push({ row: r, col: c });
    }
    let scrambled;
    do {
      scrambled = shuffleArray(positions.slice());
    } while (total > 1 && scrambled.every((p, idx) => p.row === positions[idx].row && p.col === positions[idx].col));
    return scrambled;
  }

  function buildPuzzle(n) {
    state.gridSize = n;
    state.pieces = [];
    state.moves = 0;
    state.placedCount = 0;

    const total = n * n;
    const correctPositions = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) correctPositions.push({ row: r, col: c });
    }
    const scrambledPositions = generateScramble(n);

    for (let i = 0; i < total; i++) {
      state.pieces.push({
        id: i,
        correctRow: correctPositions[i].row,
        correctCol: correctPositions[i].col,
        curRow: scrambledPositions[i].row,
        curCol: scrambledPositions[i].col,
        el: null
      });
    }

    dom.puzzleDiffPill.textContent = `${n} × ${n}`;
    dom.ghostImage.src = state.capturedDataUrl;
    dom.placedDisplay.textContent = `0/${total}`;
    dom.hudPlaced.textContent = `0/${total}`;

    renderBoard();
    resetTimer();
    startTimer();
    updateHud();
  }

  function renderBoard() {
    dom.board.innerHTML = '';
    const n = state.gridSize;
    const boardRect = dom.board.getBoundingClientRect();
    const boardSize = boardRect.width;
    state.boardSize = boardSize;
    state.cellSize = boardSize / n;

    state.pieces.forEach((piece) => {
      const el = document.createElement('div');
      el.className = 'piece';
      el.dataset.id = piece.id;
      el.style.width = state.cellSize + 'px';
      el.style.height = state.cellSize + 'px';
      el.style.backgroundImage = `url(${state.capturedDataUrl})`;
      el.style.backgroundSize = `${boardSize}px ${boardSize}px`;
      el.style.backgroundPosition = `-${piece.correctCol * state.cellSize}px -${piece.correctRow * state.cellSize}px`;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `Puzzle piece ${piece.id + 1}`);
      positionPieceEl(el, piece.curRow, piece.curCol, false);
      attachPieceInteraction(el, piece);
      piece.el = el;
      updatePieceCorrectness(piece, false);
      dom.board.appendChild(el);
    });
  }

  function positionPieceEl(el, row, col, animate) {
    el.style.transition = animate ? '' : 'none';
    el.style.left = (col * state.cellSize) + 'px';
    el.style.top = (row * state.cellSize) + 'px';
    if (!animate) {
      void el.offsetWidth;
      el.style.transition = '';
    }
  }

  function updatePieceCorrectness(piece, animate) {
    const isCorrect = piece.curRow === piece.correctRow && piece.curCol === piece.correctCol;
    const wasCorrect = piece.el.classList.contains('correct');
    if (isCorrect) {
      piece.el.classList.add('correct');
      if (!wasCorrect && animate) {
        piece.el.classList.remove('just-placed');
        void piece.el.offsetWidth;
        piece.el.classList.add('just-placed');
      }
    } else {
      piece.el.classList.remove('correct');
    }
    return isCorrect;
  }

  function recalcPlacedCount() {
    let count = 0;
    state.pieces.forEach((p) => {
      if (p.curRow === p.correctRow && p.curCol === p.correctCol) count++;
    });
    state.placedCount = count;
    updateHud();
    return count;
  }

  function updateHud() {
    const total = state.pieces.length;
    dom.movesDisplay.textContent = state.moves;
    dom.hudMoves.textContent = state.moves;
    dom.placedDisplay.textContent = `${state.placedCount}/${total}`;
    dom.hudPlaced.textContent = `${state.placedCount}/${total}`;
  }

  function attachPieceInteraction(el, piece) {
    el.addEventListener('pointerdown', (e) => onPointerDown(e, piece));
    el.addEventListener('keydown', (e) => onPieceKeydown(e, piece));
  }

  function onPointerDown(e, piece) {
    if (state.dragInfo) return;
    e.preventDefault();

    const el = piece.el;
    const boardRect = dom.board.getBoundingClientRect();

    try { el.setPointerCapture(e.pointerId); } catch {}

    state.dragInfo = {
      pointerId: e.pointerId,
      piece,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: piece.curCol * state.cellSize,
      originTop: piece.curRow * state.cellSize,
      boardRect
    };

    el.classList.add('dragging');
    el.style.zIndex = 50;
    dom.ghostImage.classList.add('show');

    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
  }

  function onPointerMove(e) {
    const info = state.dragInfo;
    if (!info || e.pointerId !== info.pointerId) return;
    e.preventDefault();

    const dx = e.clientX - info.startX;
    const dy = e.clientY - info.startY;
    let newLeft = info.originLeft + dx;
    let newTop = info.originTop + dy;

    const max = state.boardSize - state.cellSize;
    newLeft = Math.max(-state.cellSize * 0.3, Math.min(max + state.cellSize * 0.3, newLeft));
    newTop = Math.max(-state.cellSize * 0.3, Math.min(max + state.cellSize * 0.3, newTop));

    info.piece.el.style.transition = 'none';
    info.piece.el.style.left = newLeft + 'px';
    info.piece.el.style.top = newTop + 'px';
  }

  function onPointerUp(e) {
    const info = state.dragInfo;
    if (!info || e.pointerId !== info.pointerId) return;

    const el = info.piece.el;
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    try { el.releasePointerCapture(e.pointerId); } catch {}

    el.classList.remove('dragging');
    el.style.zIndex = '';
    dom.ghostImage.classList.remove('show');

    // Final drop position is always derived fresh from this event's own
    // coordinates (not a cached value from the last pointermove), since
    // pointerup can fire without an immediately preceding move at the
    // same location.
    const dx = e.clientX - info.startX;
    const dy = e.clientY - info.startY;
    let lastLeft = info.originLeft + dx;
    let lastTop = info.originTop + dy;
    const max = state.boardSize - state.cellSize;
    lastLeft = Math.max(-state.cellSize * 0.3, Math.min(max + state.cellSize * 0.3, lastLeft));
    lastTop = Math.max(-state.cellSize * 0.3, Math.min(max + state.cellSize * 0.3, lastTop));

    // Bucket the piece's center into a cell using floor, not round: a piece
    // at rest has its center sitting at an exact "k*cellSize + cellSize/2"
    // offset, which divided by cellSize yields an exact .5 ratio. Math.round
    // always breaks .5 ties upward, so an untouched piece could silently
    // round into the next cell. Math.floor avoids that tie entirely.
    let targetCol = Math.floor((lastLeft + state.cellSize / 2) / state.cellSize);
    let targetRow = Math.floor((lastTop + state.cellSize / 2) / state.cellSize);
    targetCol = Math.max(0, Math.min(state.gridSize - 1, targetCol));
    targetRow = Math.max(0, Math.min(state.gridSize - 1, targetRow));

    state.dragInfo = null;

    movePieceToCell(info.piece, targetRow, targetCol);
  }

  function movePieceToCell(piece, targetRow, targetCol) {
    if (targetRow === piece.curRow && targetCol === piece.curCol) {
      positionPieceEl(piece.el, piece.curRow, piece.curCol, true);
      return;
    }

    const occupant = state.pieces.find((p) => p !== piece && p.curRow === targetRow && p.curCol === targetCol);

    if (occupant) {
      const tmpRow = piece.curRow;
      const tmpCol = piece.curCol;
      piece.curRow = targetRow;
      piece.curCol = targetCol;
      occupant.curRow = tmpRow;
      occupant.curCol = tmpCol;

      positionPieceEl(piece.el, piece.curRow, piece.curCol, true);
      positionPieceEl(occupant.el, occupant.curRow, occupant.curCol, true);

      occupant.el.classList.add('swap-flash');
      piece.el.classList.add('swap-flash');
      setTimeout(() => {
        occupant.el.classList.remove('swap-flash');
        piece.el.classList.remove('swap-flash');
      }, 320);

      updatePieceCorrectness(piece, true);
      updatePieceCorrectness(occupant, true);
    } else {
      positionPieceEl(piece.el, piece.curRow, piece.curCol, true);
      return;
    }

    state.moves++;
    recalcPlacedCount();
    checkWin();
  }

  let keyboardSelected = null;
  function onPieceKeydown(e, piece) {
    const moveKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (keyboardSelected === piece) {
        piece.el.classList.remove('dragging');
        keyboardSelected = null;
      } else if (keyboardSelected) {
        const other = keyboardSelected;
        other.el.classList.remove('dragging');
        movePieceToCell(other, piece.curRow, piece.curCol);
        keyboardSelected = null;
      } else {
        keyboardSelected = piece;
        piece.el.classList.add('dragging');
      }
    } else if (moveKeys.includes(e.key) && keyboardSelected === piece) {
      e.preventDefault();
      let { curRow, curCol } = piece;
      if (e.key === 'ArrowUp') curRow = Math.max(0, curRow - 1);
      if (e.key === 'ArrowDown') curRow = Math.min(state.gridSize - 1, curRow + 1);
      if (e.key === 'ArrowLeft') curCol = Math.max(0, curCol - 1);
      if (e.key === 'ArrowRight') curCol = Math.min(state.gridSize - 1, curCol + 1);
      piece.el.classList.remove('dragging');
      keyboardSelected = null;
      movePieceToCell(piece, curRow, curCol);
    }
  }

  function resetTimer() {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
    state.timerStart = null;
    state.elapsedMs = 0;
    state.timerRunning = false;
    renderTime(0);
  }

  function startTimer() {
    state.timerStart = performance.now();
    state.timerRunning = true;
    clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const now = performance.now();
      state.elapsedMs = now - state.timerStart;
      renderTime(state.elapsedMs);
    }, 47);
  }

  function stopTimer() {
    if (!state.timerRunning) return;
    state.elapsedMs = performance.now() - state.timerStart;
    state.timerRunning = false;
    clearInterval(state.timerInterval);
    renderTime(state.elapsedMs);
  }

  function formatTime(ms) {
    const totalDeciseconds = Math.floor(ms / 100);
    const minutes = Math.floor(totalDeciseconds / 600);
    const seconds = Math.floor((totalDeciseconds % 600) / 10);
    const tenths = totalDeciseconds % 10;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
  }

  function renderTime(ms) {
    const formatted = formatTime(ms);
    dom.timerDisplay.textContent = formatted;
    dom.hudTime.textContent = formatted;
  }

  function checkWin() {
    const allCorrect = state.pieces.every((p) => p.curRow === p.correctRow && p.curCol === p.correctCol);
    if (allCorrect) {
      stopTimer();
      setTimeout(() => showResults(), 380);
    }
  }

  function loadAllBestTimes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveAllBestTimes(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // localStorage unavailable (private mode / quota) — fail silently, game still works
    }
  }

  function recordResult(gridSize, elapsedMs, moves) {
    const all = loadAllBestTimes();
    const key = `${gridSize}x${gridSize}`;
    const list = Array.isArray(all[key]) ? all[key] : [];

    const entry = {
      ms: Math.round(elapsedMs),
      moves,
      date: new Date().toISOString()
    };
    list.push(entry);
    list.sort((a, b) => a.ms - b.ms);
    const trimmed = list.slice(0, 5);
    all[key] = trimmed;
    saveAllBestTimes(all);

    return { list: trimmed, entry, isNewBest: trimmed[0] === entry, rank: trimmed.indexOf(entry) };
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function renderLeaderboard(gridSize, justAddedEntry) {
    const key = `${gridSize}x${gridSize}`;
    const all = loadAllBestTimes();
    const list = Array.isArray(all[key]) ? all[key] : [];
    dom.leaderboardDiffLabel.textContent = `${gridSize}×${gridSize}`;
    dom.leaderboardList.innerHTML = '';

    if (list.length === 0) {
      const li = document.createElement('li');
      li.className = 'lb-empty';
      li.textContent = 'No times recorded yet for this difficulty.';
      dom.leaderboardList.appendChild(li);
      return;
    }

    list.forEach((entry, idx) => {
      const li = document.createElement('li');
      li.className = 'lb-row';
      if (justAddedEntry && entry.ms === justAddedEntry.ms && entry.date === justAddedEntry.date) {
        li.classList.add('is-new');
      }
      const rank = document.createElement('span');
      rank.className = 'lb-rank';
      rank.textContent = String(idx + 1);

      const time = document.createElement('span');
      time.className = 'lb-time mono';
      time.textContent = formatTime(entry.ms);

      const moves = document.createElement('span');
      moves.className = 'lb-moves';
      moves.textContent = `${entry.moves} moves`;

      const date = document.createElement('span');
      date.className = 'lb-date';
      date.textContent = formatDate(entry.date);

      li.appendChild(rank);
      li.appendChild(time);
      li.appendChild(moves);
      li.appendChild(date);
      dom.leaderboardList.appendChild(li);
    });
  }

  function showResults() {
    const n = state.gridSize;
    const { entry } = recordResult(n, state.elapsedMs, state.moves);

    dom.resultImage.src = state.capturedDataUrl;
    dom.resultTime.textContent = formatTime(state.elapsedMs);
    dom.resultMoves.textContent = String(state.moves);
    dom.resultDiff.textContent = `${n}×${n}`;

    renderLeaderboard(n, entry);

    dom.resultsOverlay.hidden = false;
  }

  function hideResults() {
    dom.resultsOverlay.hidden = true;
  }

  function handleResize() {
    if (state.resizeRaf) cancelAnimationFrame(state.resizeRaf);
    state.resizeRaf = requestAnimationFrame(() => {
      if (dom.screenReview.dataset.active === 'true' && state.capturedImage) {
        drawPreview();
      }
      if (dom.screenPuzzle.dataset.active === 'true' && state.pieces.length) {
        const boardRect = dom.board.getBoundingClientRect();
        state.boardSize = boardRect.width;
        state.cellSize = state.boardSize / state.gridSize;
        state.pieces.forEach((piece) => {
          piece.el.style.width = state.cellSize + 'px';
          piece.el.style.height = state.cellSize + 'px';
          piece.el.style.backgroundSize = `${state.boardSize}px ${state.boardSize}px`;
          piece.el.style.backgroundPosition = `-${piece.correctCol * state.cellSize}px -${piece.correctRow * state.cellSize}px`;
          positionPieceEl(piece.el, piece.curRow, piece.curCol, false);
        });
      }
    });
  }

  function wireEvents() {
    dom.captureBtn.addEventListener('click', takePhoto);
    dom.retryCameraBtn.addEventListener('click', () => startCamera(state.facingMode));
    dom.switchCamBtn.addEventListener('click', flipCamera);
    dom.fileInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleFileUpload(file);
      e.target.value = '';
    });

    setupDifficultyCards();
    dom.retakeBtn.addEventListener('click', () => {
      state.capturedDataUrl = null;
      state.capturedImage = null;
      goToScreen('camera');
    });
    dom.startPuzzleBtn.addEventListener('click', () => {
      if (!state.gridSize) {
        showToast('Pick a difficulty to continue.');
        return;
      }
      goToScreen('puzzle');
      requestAnimationFrame(() => requestAnimationFrame(() => buildPuzzle(state.gridSize)));
    });

    dom.shuffleAgainBtn.addEventListener('click', () => {
      buildPuzzle(state.gridSize);
      showToast('Reshuffled — timer restarted.');
    });

    let peekActive = false;
    function peekOn(e) { e.preventDefault(); peekActive = true; dom.ghostImage.classList.add('show'); }
    function peekOff() { if (!peekActive) return; peekActive = false; dom.ghostImage.classList.remove('show'); }
    dom.peekBtn.addEventListener('mousedown', peekOn);
    dom.peekBtn.addEventListener('touchstart', peekOn, { passive: false });
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach((evt) => {
      dom.peekBtn.addEventListener(evt, peekOff);
    });

    dom.playAgainBtn.addEventListener('click', () => {
      hideResults();
      goToScreen('puzzle');
      requestAnimationFrame(() => buildPuzzle(state.gridSize));
    });
    dom.newPhotoBtn.addEventListener('click', () => {
      hideResults();
      state.capturedDataUrl = null;
      state.capturedImage = null;
      goToScreen('camera');
    });

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    window.addEventListener('beforeunload', stopCamera);
  }

  function init() {
    wireEvents();
    goToScreen('camera');
  }

  document.addEventListener('DOMContentLoaded', init);
})();