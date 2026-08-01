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

  function buildPieceMesh(type, color) {
    const c = PIECE_COLORS[color];
    const mat = new THREE.MeshStandardMaterial({
      color: c.body, metalness: 0.35, roughness: 0.45,
      emissive: c.emissive, emissiveIntensity: 0.15
    });
    const trimMat = new THREE.MeshStandardMaterial({ color: c.trim, metalness: 0.65, roughness: 0.28 });
    const group = new THREE.Group();

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 24), mat);
    base.position.y = 0.07;
    group.add(base);

    if (type === 'p') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.28, 16), mat);
      stem.position.y = 0.28;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), mat);
      head.position.y = 0.56;
      group.add(stem, head);
    } else if (type === 'r') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.5, 16), mat);
      body.position.y = 0.39;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.1, 8), trimMat);
      top.position.y = 0.69;
      group.add(body, top);
    } else if (type === 'n') {
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.4, 16), mat);
      neck.position.y = 0.34;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.32, 0.42), mat);
      head.position.set(0, 0.6, 0.08);
      head.rotation.x = -0.35;
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), mat);
      ear.position.set(0, 0.78, -0.02);
      ear.rotation.x = -0.35;
      group.add(neck, head, ear);
    } else if (type === 'b') {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 20), mat);
      body.position.y = 0.415;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), trimMat);
      tip.position.y = 0.75;
      group.add(body, tip);
    } else if (type === 'q') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.58, 20), mat);
      body.position.y = 0.43;
      const crown = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), mat);
      crown.position.y = 0.77;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 10), trimMat);
      spike.position.y = 0.96;
      group.add(body, crown, spike);
    } else if (type === 'k') {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 0.62, 20), mat);
      body.position.y = 0.45;
      const collar = new THREE.Mesh(new THREE.SphereGeometry(0.19, 16, 16), mat);
      collar.position.y = 0.78;
      const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.06), trimMat);
      crossV.position.y = 1.0;
      const crossH = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), trimMat);
      crossH.position.y = 0.95;
      group.add(body, collar, crossV, crossH);
    }

    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
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

    this.scene.add(new THREE.AmbientLight(0xfff2d9, 0.55));
    const key = new THREE.DirectionalLight(0xfff2d9, 1.05);
    key.position.set(4, 8, 5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6; key.shadow.camera.right = 6;
    key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    this.scene.add(key);
    const rim = new THREE.PointLight(0xd4af37, 0.5, 20);
    rim.position.set(-4, 3, -4);
    this.scene.add(rim);

    if (THREE.OrbitControls) {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enablePan = false;
      this.controls.minDistance = 5;
      this.controls.maxDistance = 11;
      this.controls.minPolarAngle = Math.PI / 6;
      this.controls.maxPolarAngle = Math.PI / 2.15;
      this.controls.target.set(0, 0, 0);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.rotateSpeed = 0.5;
      this.controls.update();
    }
  };

  Board3D.prototype._setCameraForOrientation = function () {
    const flip = this.orientation === 'black' ? -1 : 1;
    this.camera.position.set(0, 7.2, 6.3 * flip);
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
