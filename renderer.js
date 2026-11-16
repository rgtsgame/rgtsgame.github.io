import * as THREE from 'three';

let scene, camera, renderer, clock;
let gunModel;
let debugHitboxesGroup = null;
let loadedMeshes = [];

const bulletHoleTexture = new THREE.TextureLoader().load('bullet_hole.png');
const bulletHoles = [];
const MAX_BULLET_HOLES = 50;

const PLAYER_HEIGHT = 1.7;

// ============================================================
// REMOTE PLAYERS
// ============================================================
const remotePlayers = new Map();   // id -> { mesh, nameTag, targetPos, targetYaw, alive }

// ============================================================
// TEXTURES
// ============================================================
function createGrassTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#4c7a34';
    ctx.fillRect(0, 0, 64, 64);

    for (let i = 0; i < 400; i++) {
        const x = Math.random() * 64;
        const y = Math.random() * 64;
        ctx.fillStyle = Math.random() > 0.5 ? '#5d9441' : '#3b6327';
        ctx.fillRect(x, y, 1.5, 1.5);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(100, 100);
    texture.magFilter = THREE.NearestFilter;

    return texture;
}

function makeNameTagSprite(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(name).substring(0, 16), 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
    sprite.scale.set(2, 0.5, 1);
    sprite.position.set(0, 2.2, 0);
    return sprite;
}

// ============================================================
// INIT
// ============================================================
export function initRenderer(canvas) {
    scene = new THREE.Scene();
    const skyColor = 0x87CEEB;
    scene.background = new THREE.Color(skyColor);
    scene.fog = new THREE.Fog(skyColor, 30, 120);

    camera = new THREE.PerspectiveCamera(90, innerWidth / innerHeight, 0.1, 1000);
    scene.add(camera);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    clock = new THREE.Clock();

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.8);
    scene.add(hemiLight);

    const sun = new THREE.DirectionalLight(0xffffff, 2.0);
    sun.position.set(30, 50, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 150;
    sun.shadow.camera.left = -60;
    sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60;
    sun.shadow.camera.bottom = -60;
    scene.add(sun);

    // Tracer group — add to scene so remote tracers render
    scene.add(tracerGroup);

    createGun();

    addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });
}

function createGun() {
    gunModel = new THREE.Group();

    // ---------- 材質 ----------
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a, metalness: 0.9, roughness: 0.35
    });
    const darkPolyMat = new THREE.MeshStandardMaterial({
        color: 0x2b2b2b, metalness: 0.2, roughness: 0.8
    });
    const gripMat = new THREE.MeshStandardMaterial({
        color: 0x141414, metalness: 0.1, roughness: 0.95
    });
    const accentMat = new THREE.MeshStandardMaterial({
        color: 0x3a3a3a, metalness: 0.6, roughness: 0.5
    });

    // ---------- 槍身主體 (receiver) ----------
    const receiver = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.12, 0.42),
        darkPolyMat
    );
    gunModel.add(receiver);

    // 上機匣 (upper receiver，稍窄一點點，做出分層感)
    const upper = new THREE.Mesh(
        new THREE.BoxGeometry(0.085, 0.06, 0.40),
        metalMat
    );
    upper.position.set(0, 0.09, 0);
    gunModel.add(upper);

    // ---------- 槍管 ----------
    const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.42, 12),
        metalMat
    );
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.075, -0.40);
    gunModel.add(barrel);

    // 護木 (handguard，包住槍管前段)
    const handguard = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.075, 0.28),
        darkPolyMat
    );
    handguard.position.set(0, 0.07, -0.34);
    gunModel.add(handguard);

    // 護木上的散熱孔裝飾 (幾條細長凹槽)
    for (let i = 0; i < 4; i++) {
        const slot = new THREE.Mesh(
            new THREE.BoxGeometry(0.078, 0.012, 0.02),
            gripMat
        );
        slot.position.set(0, 0.07, -0.46 + i * 0.05);
        gunModel.add(slot);
    }

    // ---------- 槍口/消音器 ----------
    const muzzle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.028, 0.10, 12),
        metalMat
    );
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.set(0, 0.075, -0.66);
    gunModel.add(muzzle);

    // ---------- 準星 (front sight) ----------
    const frontSightBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.02, 0.05),
        metalMat
    );
    frontSightBase.position.set(0, 0.12, -0.55);
    gunModel.add(frontSightBase);

    const frontSightPost = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.035, 0.008),
        metalMat
    );
    frontSightPost.position.set(0, 0.145, -0.55);
    gunModel.add(frontSightPost);

    // ---------- 彈匣 (magazine，微微前傾) ----------
    const mag = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.22, 0.10),
        gripMat
    );
    mag.position.set(0, -0.16, 0.02);
    mag.rotation.x = -0.12;   // 前傾
    gunModel.add(mag);

    // 彈匣底部加厚
    const magBase = new THREE.Mesh(
        new THREE.BoxGeometry(0.065, 0.02, 0.11),
        metalMat
    );
    magBase.position.set(0, -0.27, 0.03);
    magBase.rotation.x = -0.12;
    gunModel.add(magBase);

    // ---------- 握把 (pistol grip) ----------
    const grip = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.16, 0.07),
        gripMat
    );
    grip.position.set(0, -0.12, 0.19);
    grip.rotation.x = 0.28;   // 後傾
    gunModel.add(grip);

    // ---------- 扳機護弓 ----------
    const triggerGuard = new THREE.Mesh(
        new THREE.TorusGeometry(0.035, 0.008, 6, 12, Math.PI),
        metalMat
    );
    triggerGuard.rotation.z = Math.PI;
    triggerGuard.rotation.y = Math.PI / 2;
    triggerGuard.position.set(0, -0.06, 0.10);
    gunModel.add(triggerGuard);

    // 扳機
    const trigger = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.025, 0.015),
        metalMat
    );
    trigger.position.set(0, -0.05, 0.10);
    trigger.rotation.x = 0.2;
    gunModel.add(trigger);

    // ---------- 槍托 (stock) ----------
    const stock = new THREE.Mesh(
        new THREE.BoxGeometry(0.07, 0.10, 0.22),
        darkPolyMat
    );
    stock.position.set(0, -0.01, 0.34);
    gunModel.add(stock);

    const stockPad = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.12, 0.02),
        gripMat
    );
    stockPad.position.set(0, -0.01, 0.46);
    gunModel.add(stockPad);

    // ---------- 後照準 (rear sight) ----------
    const rearSight = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.025, 0.04),
        metalMat
    );
    rearSight.position.set(0, 0.14, 0.06);
    gunModel.add(rearSight);

    // 後照準上的小缺口 (兩根小柱)
    const rsL = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, 0.015, 0.01),
        metalMat
    );
    rsL.position.set(-0.012, 0.16, 0.06);
    gunModel.add(rsL);
    const rsR = rsL.clone();
    rsR.position.x = 0.012;
    gunModel.add(rsR);

    // ---------- 拉機柄 (charging handle) ----------
    const chargingHandle = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.015, 0.03),
        metalMat
    );
    chargingHandle.position.set(0, 0.11, 0.18);
    gunModel.add(chargingHandle);

    // ---------- 戰術握把 (foregrip，護木下方) ----------
    const foregrip = new THREE.Mesh(
        new THREE.BoxGeometry(0.045, 0.10, 0.05),
        gripMat
    );
    foregrip.position.set(0, -0.02, -0.30);
    gunModel.add(foregrip);

    // ---------- 整體位置與姿態 ----------
    gunModel.position.set(0.25, -0.2, -0.5);
    gunModel.rotation.y = -0.05;
    gunModel.rotation.x = 0.02;

    // 稍微整體縮放，讓比例更順眼
    gunModel.scale.setScalar(0.95);

    camera.add(gunModel);
}
// ============================================================
// NPC MESHES
// ============================================================
export const npcMeshes = [];

export function spawnNPCMesh(id, position) {
    const group = new THREE.Group();
    group.position.set(position[0], position[1], position[2]);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff2222 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.y = 1.8;
    head.castShadow = true;
    group.add(head);

    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), bodyMat);
    armL.position.set(-0.55, 1.0, 0);
    armL.castShadow = true;
    group.add(armL);

    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), bodyMat);
    armR.position.set(0.55, 1.0, 0);
    armR.castShadow = true;
    group.add(armR);

    group.userData = { id: id, type: 'npc', bodyMesh: body, isDead: false };
    scene.add(group);
    npcMeshes.push(group);
    return group;
}

export function removeNPCMesh(id) {
    const index = npcMeshes.findIndex(n => n.userData.id === id);
    if (index !== -1) {
        scene.remove(npcMeshes[index]);
        npcMeshes.splice(index, 1);
    }
}

export function flashNPC(id) {
    const npc = npcMeshes.find(n => n.userData.id === id);
    if (npc && !npc.userData.isDead) {
        npc.userData.bodyMesh.material.color.setHex(0xffffff);
        setTimeout(() => {
            if (!npc.userData.isDead) npc.userData.bodyMesh.material.color.setHex(0xff2222);
        }, 100);
    }
}

// ============================================================
// REMOTE PLAYERS — public API
// ============================================================

export function spawnRemotePlayer(id, name = 'player') {
    if (remotePlayers.has(id)) return;

    const group = new THREE.Group();
    group.position.set(0, 0, 0);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3498db });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.y = 1.8;
    head.castShadow = true;
    group.add(head);

    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), bodyMat);
    armL.position.set(-0.55, 1.0, 0);
    armL.castShadow = true;
    group.add(armL);

    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1, 0.25), bodyMat);
    armR.position.set(0.55, 1.0, 0);
    armR.castShadow = true;
    group.add(armR);

    group.userData = { type: 'remotePlayer', id: id, bodyMesh: body };
    body.userData.remoteId = id;

    const nameTag = makeNameTagSprite(name);
    group.add(nameTag);

    scene.add(group);

    // Health bar lives in scene root — not parented to the rotating group
    const healthBar = makeHealthBar();
    healthBar.group.position.set(0, 0, 0);
    scene.add(healthBar.group);

    remotePlayers.set(id, {
        id, name,
        mesh: group,
        nameTag,
        healthBar,
        bodyMat,
        targetPos: new THREE.Vector3(0, 0, 0),
        targetYaw: 0,
        targetHealth: 100,
        alive: true,
    });

    return group;
}

function makeHealthBar() {
    const bgGeo = new THREE.PlaneGeometry(1.0, 0.12);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false });
    const bg = new THREE.Mesh(bgGeo, bgMat);

    const fillGeo = new THREE.PlaneGeometry(1.0, 0.10);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, depthTest: false });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.z = 0.001;   // avoid z-fighting with bg

    const group = new THREE.Group();
    group.add(bg);
    group.add(fill);

    return {
        group,
        fill,
        bg,
        setHealth(h) {
            const pct = Math.max(0, Math.min(1, h / 100));
            fill.scale.x = pct;
            // Keep the left edge anchored while scaling
            fill.position.x = -(1 - pct) * 0.5;
            // Color: green → yellow → red
            const color = pct > 0.5
                ? new THREE.Color(0xff4444).lerp(new THREE.Color(0x2ecc71), (pct - 0.5) * 2)
                : new THREE.Color(0xff4444).lerp(new THREE.Color(0xffaa00), pct * 2);
            fill.material.color.copy(color);
        },
        dispose() {
            bgGeo.dispose(); bgMat.dispose();
            fillGeo.dispose(); fillMat.dispose();
        },
    };
}

export function removeRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if (!rp) return;

    scene.remove(rp.mesh);
    rp.mesh.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    });

    if (rp.healthBar) {
        scene.remove(rp.healthBar.group);
        rp.healthBar.dispose();
    }

    remotePlayers.delete(id);
}

export function updateRemotePlayers(dt) {
    const lerp = 1 - Math.pow(0.001, dt);
    const cam = camera;

    remotePlayers.forEach(rp => {
        if (!rp.alive) {
            rp.healthBar.group.visible = false;
            return;
        }
        rp.healthBar.group.visible = true;

        rp.mesh.position.lerp(rp.targetPos, lerp);

        let dy = rp.targetYaw - rp.mesh.rotation.y;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        rp.mesh.rotation.y += dy * lerp;

        // Health bar: follow mesh position, float above head, face camera
        rp.healthBar.group.position.set(
            rp.mesh.position.x,
            rp.mesh.position.y + 2.5,
            rp.mesh.position.z
        );
        if (cam) {
            rp.healthBar.group.quaternion.copy(cam.quaternion);
        }
    });
}

export function updateRemotePlayer(id, x, y, z, rx, ry) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    // Server sends eye height; mesh origin is at feet
    rp.targetPos.set(x, y - PLAYER_HEIGHT, z);
    rp.targetYaw = ry;
}

export function hideRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    rp.alive = false;
    rp.mesh.visible = false;
    if (rp.healthBar) rp.healthBar.group.visible = false;
}

export function showRemotePlayer(id, x, y, z) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    rp.alive = true;
    rp.mesh.visible = true;
    rp.mesh.position.set(x, y - PLAYER_HEIGHT, z);
    rp.targetPos.set(x, y - PLAYER_HEIGHT, z);
    rp.targetHealth = 100;
    rp.healthBar?.setHealth(100);
    rp.healthBar.group.visible = true;
}

// Returns visible remote player meshes for raycasting
export function getRemotePlayerMeshes() {
    const out = [];
    remotePlayers.forEach(rp => {
        if (rp.alive) out.push(rp.mesh);
    });
    return out;
}

// Walk up parent chain from a raycast hit to find the remote player id
export function findRemoteIdByObject(obj) {
    let cur = obj;
    while (cur) {
        if (cur.userData && cur.userData.remoteId) return cur.userData.remoteId;
        if (cur.userData && cur.userData.type === 'remotePlayer') return cur.userData.id;
        cur = cur.parent;
    }
    return null;
}

export function setRemotePlayerHealth(id, health) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    rp.targetHealth = health;
    rp.healthBar?.setHealth(health);
    flashRemotePlayer(id);
}

export function flashRemotePlayer(id) {
    const rp = remotePlayers.get(id);
    if (!rp) return;
    rp.bodyMat.color.setHex(0xffffff);
    clearTimeout(rp._flashTimer);
    rp._flashTimer = setTimeout(() => {
        if (rp.alive) rp.bodyMat.color.setHex(0x3498db);
    }, 100);
}

// ============================================================
// MAP LOADING
// ============================================================
export async function loadMap(url) {
    const res = await fetch(url);
    const data = await res.json();

    loadedMeshes.forEach(m => scene.remove(m));
    loadedMeshes = [];

    for (const m of data.meshes) {
        let geo;
        if (m.type === 'box') {
            geo = new THREE.BoxGeometry(...m.size);
        } else if (m.type === 'plane') {
            geo = new THREE.PlaneGeometry(...m.size);
        }

        let mat;
        if (m.type === 'plane') {
            mat = new THREE.MeshStandardMaterial({ map: createGrassTexture(), roughness: 1.0 });
        } else {
            mat = new THREE.MeshStandardMaterial({ color: m.material.color, roughness: 0.7 });
        }

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(m.position[0], m.position[1], m.position[2]);
        mesh.rotation.set(m.rotation[0] || 0, m.rotation[1] || 0, m.rotation[2] || 0);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.id = m.id;
        mesh.userData.collidable = m.collidable;
        mesh.userData.originalData = m;
        scene.add(mesh);
        loadedMeshes.push(mesh);
    }

    for (const p of data.powerups) {
        const color = p.type === 'health' ? 0xff0000 : 0xffff00;
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 16, 16),
            new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.8 })
        );
        const glow = new THREE.PointLight(color, 1, 3);
        mesh.position.set(p.position[0], p.position[1], p.position[2]);
        mesh.add(glow);
        mesh.castShadow = false;
        mesh.userData.id = p.id;
        mesh.userData.type = p.type;
        scene.add(mesh);
    }

    return data;
}

export function getLoadedMeshes() {
    return loadedMeshes;
}

export function toggleHitboxes(colliders) {
    if (debugHitboxesGroup) {
        scene.remove(debugHitboxesGroup);
        debugHitboxesGroup = null;
        return;
    }

    debugHitboxesGroup = new THREE.Group();
    const debugMat = new THREE.LineBasicMaterial({ color: 0xff0000 });

    for (const c of colliders) {
        const w = c.max.x - c.min.x;
        const h = c.max.y - c.min.y;
        const d = c.max.z - c.min.z;
        const cx = c.min.x + w / 2;
        const cy = c.min.y + h / 2;
        const cz = c.min.z + d / 2;

        const geo = new THREE.BoxGeometry(w, h, d);
        const edges = new THREE.EdgesGeometry(geo);
        const line = new THREE.LineSegments(edges, debugMat);
        line.position.set(cx, cy, cz);
        debugHitboxesGroup.add(line);
    }

    scene.add(debugHitboxesGroup);
}

// ============================================================
// VIEW MODEL (first-person gun animation)
// ============================================================
let reloadState = {
    active: false,
    progress: 0,       // 0 → 1
};

export function setReloadState(active, progress = 0) {
    reloadState.active = active;
    reloadState.progress = progress;
}

export function updateViewModel(time, isMoving) {
    if (!gunModel) return;

    // Base position — start with the resting pose
    let targetX = 0.25;
    let targetY = -0.2;
    let targetZ = -0.5;
    let targetRotX = 0;
    let targetRotY = -0.05;
    let targetRotZ = 0;

    // Idle / walk sway (existing behavior)
    if (isMoving) {
        targetX += Math.sin(time * 10) * 0.01;
        targetY += Math.cos(time * 20) * 0.01;
    }

    // Reload animation — overrides base pose
    if (reloadState.active) {
        const t = reloadState.progress;   // 0 → 1

        // Phase 1 (0.0–0.3): gun dips down and rotates
        // Phase 2 (0.3–0.7): gun stays low, subtle shake (magazine change)
        // Phase 3 (0.7–1.0): gun swings back up
        let dip = 0;
        let tilt = 0;
        let shake = 0;

        if (t < 0.3) {
            const p = t / 0.3;                        // 0→1
            dip = easeOutCubic(p) * 0.4;
            tilt = easeOutCubic(p) * 0.9;
        } else if (t < 0.7) {
            dip = 0.4;
            tilt = 0.9;
            // Subtle shake during magazine swap
            const shakePhase = (t - 0.3) / 0.4;       // 0→1
            shake = Math.sin(shakePhase * Math.PI * 6) * 0.04;
        } else {
            const p = (t - 0.7) / 0.3;                // 0→1
            dip = (1 - easeInCubic(p)) * 0.4;
            tilt = (1 - easeInCubic(p)) * 0.9;
        }

        targetY -= dip;
        targetRotZ = tilt;
        targetX += shake;
    }

    // Smooth lerp toward target
    const lerp = 0.25;
    gunModel.position.x += (targetX - gunModel.position.x) * lerp;
    gunModel.position.y += (targetY - gunModel.position.y) * lerp;
    gunModel.position.z += (targetZ - gunModel.position.z) * lerp;
    gunModel.rotation.x += (targetRotX - gunModel.rotation.x) * lerp;
    gunModel.rotation.y += (targetRotY - gunModel.rotation.y) * lerp;
    gunModel.rotation.z += (targetRotZ - gunModel.rotation.z) * lerp;
}

function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
    return t * t * t;
}

let tracerGroup = new THREE.Group();
let muzzleFlash = null;
const activeTracers = [];   // { mesh, geo, mat, expireAt }

export function spawnBulletTracer(startPos, endPos, hitNormal, isHit, hitPoint, isLocalShot = true) {
    const distance = startPos.distanceTo(endPos);
    if (distance < 0.01) return;

    const geometry = new THREE.CylinderGeometry(0.015, 0.015, distance, 4);
    geometry.translate(0, distance / 2, 0);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });

    // ✅ Only show muzzle flash for LOCAL shots
    if (isLocalShot) {
        if (!muzzleFlash) {
            muzzleFlash = new THREE.PointLight(0xffaa00, 5, 5);
            muzzleFlash.position.set(0.25, -0.2, -0.8);
            getCamera().add(muzzleFlash);
        }
        muzzleFlash.visible = true;
        setTimeout(() => {
            if (muzzleFlash) muzzleFlash.visible = false;
        }, 50);
    }

    if (isHit && hitPoint && hitNormal) {
        spawnBulletHole(hitPoint, hitNormal);
    }

    activeTracers.push({
        geo: geometry,
        mat: material,
        expireAt: performance.now() + 50,
    });
}

export function spawnRemoteTracer(ox, oy, oz, dx, dy, dz) {
    const start = new THREE.Vector3(ox, oy, oz);
    const dir = new THREE.Vector3(dx, dy, dz);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    const end = start.clone().add(dir.multiplyScalar(100));

    spawnBulletTracer(start, end, null, false, null, false);
}

function spawnBulletHole(position, normal) {
    const mat = new THREE.MeshBasicMaterial({
        map: bulletHoleTexture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1
    });

    const geo = new THREE.PlaneGeometry(0.4, 0.4);
    const hole = new THREE.Mesh(geo, mat);

    hole.position.copy(position).add(normal.clone().multiplyScalar(0.01));
    hole.lookAt(position.clone().add(normal));

    scene.add(hole);
    bulletHoles.push(hole);

    if (bulletHoles.length > MAX_BULLET_HOLES) {
        const oldHole = bulletHoles.shift();
        scene.remove(oldHole);
        oldHole.geometry.dispose();
        oldHole.material.dispose();
    }
}

function cleanupTracers() {
    const now = performance.now();
    for (let i = activeTracers.length - 1; i >= 0; i--) {
        if (now >= activeTracers[i].expireAt) {
            const t = activeTracers[i];
            tracerGroup.remove(t.mesh);
            t.geo.dispose();
            t.mat.dispose();
            activeTracers.splice(i, 1);
        }
    }
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getClock() { return clock; }

export function render() {
    cleanupTracers();
    renderer.render(scene, camera);
}