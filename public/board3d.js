// board3d.js - a small, dependency-light 3D chess board built on three.js.
// It knows nothing about chess rules or the server - it just renders a
// position (a map of square -> {type, color}) and reports which square
// was tapped. app.js drives it and keeps chess.js as the source of truth.

(function () {
  const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

  const PIECE_COLORS = {
    w: { body: 0xf3ead6, trim: 0xd4af37, emissive: 0x1c1608 },
    b: { body: 0x241a10, trim: 0xd4af37, emissive: 0x000000 }
  };

  function squareToXZ(square) {
    const file = FILES.indexOf(square[0]);
    const rank = parseInt(square[1], 10) - 1;
    return { x: file - 3.5, z: 3.5 - rank };
  }

  function addContactShadow(group) {
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.4, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.28, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.001;
    group.add(shadow);
  }

  function buildPieceMesh(type, color) {
    const c = PIECE_COLORS[color];
    const mat = new THREE.MeshStandardMaterial({
      color: c.body, metalness: 0.32, roughness: 0.4,
      emissive: c.emissive, emissiveIntensity: 0.15
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: c.trim, metalness: 0.7, roughness: 0.22 });
    const group = new THREE.Group();

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.15, 32), mat);
    base.position.y = 0.075;
    const collarRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 10, 32), trimMat);
    collarRing.rotation.x = Math.PI / 2;
    collarRing.position.y = 0.15;
    group.add(base, collarRing);
    addContactShadow(group);

    if (type === 'p') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.21, 0.3, 24), mat);
      stem.position.y = 0.3;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 24, 20), mat);
      head.position.y = 0.6;
      group.add(stem, head);
    } else if (type === 'r') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.29, 0.5, 24), mat);
      body.position.y = 0.4;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 24), mat);
      top.position.y = 0.7;
      const battlements = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const cren = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.09, 0.11), trimMat);
        const ang = (Math.PI / 2) * i + Math.PI / 4;
        cren.position.set(Math.cos(ang) * 0.24, 0.79, Math.sin(ang) * 0.24);
        battlements.add(cren);
      }
      group.add(body, top, battlements);
    } else if (type === 'n') {
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.38, 24), mat);
      neck.position.y = 0.33;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.34, 0.46), mat);
      head.position.set(0, 0.62, 0.06);
      head.rotation.x = -0.4;
      const snout = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.16, 0.22), mat);
      snout.position.set(0, 0.5, 0.32);
      snout.rotation.x = -0.4;
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.17, 10), mat);
      ear.position.set(0.06, 0.83, -0.06);
      ear.rotation.x = -0.4;
      const ear2 = ear.clone();
      ear2.position.x = -0.06;
      group.add(neck, head, snout, ear, ear2);
    } else if (type === 'b') {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 28), mat);
      body.position.y = 0.43;
      const notch = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 8, 24), trimMat);
      notch.rotation.x = Math.PI / 2;
      notch.position.y = 0.62;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.085, 16, 14), trimMat);
      tip.position.y = 0.76;
      group.add(body, notch, tip);
    } else if (type === 'q') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.27, 0.56, 28), mat);
      body.position.y = 0.44;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 10, 28), trimMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.72;
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 18), mat);
      crown.position.y = 0.86;
      const spikeGeo = new THREE.ConeGeometry(0.045, 0.16, 10);
      for (let i = 0; i < 5; i++) {
        const spike = new THREE.Mesh(spikeGeo, trimMat);
        const ang = (Math.PI * 2 * i) / 5;
        spike.position.set(Math.cos(ang) * 0.14, 0.98, Math.sin(ang) * 0.14);
        group.add(spike);
      }
      group.add(body, collar, crown);
    } else if (type === 'k') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.29, 0.6, 28), mat);
      body.position.y = 0.45;
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.03, 10, 28), trimMat);
      collar.rotation.x = Math.PI / 2;
      collar.position.y = 0.76;
      const crownTop = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 18), mat);
      crownTop.position.y = 0.9;
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06), trimMat);
      crossV.position.y = 1.15;
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), trimMat);
      crossH.position.y = 1.1;
      group.add(body, collar, crownTop, crossV, crossH);
    }

    group.traverse((o) => { if (o.isMesh && o.geometry.type !== 'CircleGeometry') { o.castShadow = true; o.receiveShadow = true; } });
    return group;
  }

  function Board3D(container, opts) {
    opts = opts || {};
    this.container = container;
    this.orientation = opts.orientation || 'white';
    this.onSquareClick = opts.onSquareClick || function () {};
    this.pieceMeshes = {};
    this.highlightMeshes = [];
    this._raycaster = new THREE.Raycaster();
    this._pointerDown = null;
    this._destroyed = false;

    this._initScene();
    this._buildBoard();
    this._bindEvents();
    this._animate = this._animate.bind(this);
    this._rafId = requestAnimationFrame(this._animate);
  }

  Board3D.prototype._initScene = function () {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    this._setCameraForOrientation();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xfff2d9, 0.62));
    const key = new THREE.DirectionalLight(0xfff2d9, 1.1);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -5.5; key.shadow.camera.right = 5.5;
    key.shadow.camera.top = 5.5; key.shadow.camera.bottom = -5.5;
    key.shadow.bias = -0.0015;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe9c4, 0.35);
    fill.position.set(-5, 4, -3);
    this.scene.add(fill);
    const rim = new THREE.PointLight(0xd4af37, 0.4, 20);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    // The board stays put - a fixed, considered angle reads as a real
    // chess set rather than a toy you have to fight to look at. Only
    // gentle zoom is allowed; no free rotation, so nothing ever feels
    // like it's drifting or spinning under the player's thumb.
    if (THREE.OrbitControls) {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enablePan = false;
      this.controls.enableRotate = false;
      this.controls.enableZoom = true;
      this.controls.minDistance = 7.5;
      this.controls.maxDistance = 10.5;
      this.controls.target.set(0, 0, 0);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.12;
      this.controls.zoomSpeed = 0.6;
      this.controls.update();
    }
  };

  Board3D.prototype._setCameraForOrientation = function () {
    const flip = this.orientation === 'black' ? -1 : 1;
    this.camera.position.set(0, 5.6, 7.9 * flip);
    this.camera.lookAt(0, 0, 0);
  };

  Board3D.prototype._buildBoard = function () {
    const lightMat = new THREE.MeshStandardMaterial({ color: 0xeaddc7, roughness: 0.7 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x4a3728, roughness: 0.7 });
    const squareGeo = new THREE.BoxGeometry(1, 0.12, 1);

    this.squareMeshes = {};
    for (let f = 0; f < 8; f++) {
      for (let r = 0; r < 8; r++) {
        const square = FILES[f] + (r + 1);
        const isLight = (f + r) % 2 === 1;
        const mesh = new THREE.Mesh(squareGeo, (isLight ? lightMat : darkMat).clone());
        mesh.position.set(f - 3.5, -0.06, 3.5 - r);
        mesh.receiveShadow = true;
        mesh.userData.square = square;
        this.scene.add(mesh);
        this.squareMeshes[square] = mesh;
      }
    }

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(9, 0.3, 9),
      new THREE.MeshStandardMaterial({ color: 0x1a130c, metalness: 0.2, roughness: 0.85 })
    );
    plinth.position.y = -0.3;
    plinth.receiveShadow = true;
    this.scene.add(plinth);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(9.15, 0.06, 9.15),
      new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.3 })
    );
    trim.position.y = -0.14;
    this.scene.add(trim);
  };

  // piecesMap: { e4: { type: 'p', color: 'w' }, ... }
  Board3D.prototype.setPosition = function (piecesMap) {
    Object.keys(this.pieceMeshes).forEach((sq) => this.scene.remove(this.pieceMeshes[sq]));
    this.pieceMeshes = {};
    Object.keys(piecesMap).forEach((sq) => {
      const p = piecesMap[sq];
      if (!p) return;
      const mesh = buildPieceMesh(p.type, p.color);
      const pos = squareToXZ(sq);
      mesh.position.set(pos.x, 0, pos.z);
      mesh.userData.square = sq;
      this.scene.add(mesh);
      this.pieceMeshes[sq] = mesh;
    });
  };

  Board3D.prototype.setOrientation = function (orientation) {
    this.orientation = orientation;
    this._setCameraForOrientation();
    if (this.controls) this.controls.update();
  };

  Board3D.prototype.clearHighlights = function () {
    Object.keys(this.squareMeshes).forEach((sq) => {
      const m = this.squareMeshes[sq];
      m.material.emissiveIntensity = 0;
    });
    this.highlightMeshes.forEach((h) => this.scene.remove(h));
    this.highlightMeshes = [];
  };

  Board3D.prototype.highlightSelected = function (square) {
    const m = this.squareMeshes[square];
    if (!m) return;
    m.material.emissive = new THREE.Color(0xd4af37);
    m.material.emissiveIntensity = 0.55;
  };

  Board3D.prototype.showLegalMoves = function (squares) {
    squares.forEach((sq) => {
      const pos = squareToXZ(sq);
      const dot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.04, 20),
        new THREE.MeshStandardMaterial({
          color: 0xd4af37, emissive: 0xd4af37, emissiveIntensity: 0.4,
          transparent: true, opacity: 0.85
        })
      );
      dot.position.set(pos.x, 0.06, pos.z);
      this.scene.add(dot);
      this.highlightMeshes.push(dot);
    });
  };

  Board3D.prototype.highlightCheck = function (square) {
    Object.keys(this.squareMeshes).forEach((sq) => {
      const m = this.squareMeshes[sq];
      if (m.material.emissive && m.material.emissive.getHex() === 0xdc2626) m.material.emissiveIntensity = 0;
    });
    if (!square) return;
    const m = this.squareMeshes[square];
    if (!m) return;
    m.material.emissive = new THREE.Color(0xdc2626);
    m.material.emissiveIntensity = 0.6;
  };

  Board3D.prototype._bindEvents = function () {
    const dom = this.renderer.domElement;
    this._onDown = (e) => { this._pointerDown = this._getPoint(e); };
    this._onUp = (e) => {
      if (!this._pointerDown) return;
      const p = this._getPoint(e);
      const dist = Math.hypot(p.x - this._pointerDown.x, p.y - this._pointerDown.y);
      this._pointerDown = null;
      if (dist > 8) return; // a camera drag, not a tap on a square
      this._handleTap(p);
    };
    dom.addEventListener('pointerdown', this._onDown);
    dom.addEventListener('pointerup', this._onUp);
  };

  Board3D.prototype._getPoint = function (e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, rect };
  };

  Board3D.prototype._handleTap = function (p) {
    const rect = p.rect;
    const ndc = new THREE.Vector2((p.x / rect.width) * 2 - 1, -(p.y / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.scene.children, true);
    if (!hits.length) return;
    let obj = hits[0].object;
    while (obj && !obj.userData.square && obj.parent) obj = obj.parent;
    if (obj && obj.userData.square) this.onSquareClick(obj.userData.square);
  };

  Board3D.prototype.resize = function () {
    if (this._destroyed) return;
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  Board3D.prototype._animate = function () {
    if (this._destroyed) return;
    this._rafId = requestAnimationFrame(this._animate);
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  Board3D.prototype.destroy = function () {
    this._destroyed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    const dom = this.renderer && this.renderer.domElement;
    if (dom) {
      dom.removeEventListener('pointerdown', this._onDown);
      dom.removeEventListener('pointerup', this._onUp);
    }
    if (this.renderer) this.renderer.dispose();
    if (this.container) this.container.innerHTML = '';
  };

  window.Board3D = Board3D;
})();
