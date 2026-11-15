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
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
    const barrelMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.8, roughness: 0.2 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.6), bodyMat);
    gunModel.add(body);

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.5), barrelMat);
    barrel.position.set(0, 0.05, -0.4);
    gunModel.add(barrel);

    gunModel.position.set(0.25, -0.2, -0.5);
    gunModel.rotation.y = -0.05;
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

export function updateViewModel(time, isMoving) {
    if (!gunModel) return;
    if (isMoving) {
        gunModel.position.x = 0.25 + Math.sin(time * 10) * 0.01;
        gunModel.position.y = -0.2 + Math.cos(time * 20) * 0.01;
    } else {
        gunModel.position.x += (0.25 - gunModel.position.x) * 0.1;
        gunModel.position.y += (-0.2 - gunModel.position.y) * 0.1;
    }
}

// ============================================================
// TRACERS
// ============================================================
let tracerGroup = new THREE.Group();
let muzzleFlash = null;
const activeTracers = [];   // { mesh, geo, mat, expireAt }

export function spawnBulletTracer(startPos, endPos, hitNormal, isHit, hitPoint) {
    const distance = startPos.distanceTo(endPos);
    if (distance < 0.01) return;   // degenerate

    const geometry = new THREE.CylinderGeometry(0.015, 0.015, distance, 4);
    geometry.translate(0, distance / 2, 0);

    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });

    // Muzzle flash — only for the local player's own gun
    if (!muzzleFlash) {
        muzzleFlash = new THREE.PointLight(0xffaa00, 5, 5);
        muzzleFlash.position.set(0.25, -0.2, -0.8);
        getCamera().add(muzzleFlash);
    }
    muzzleFlash.visible = true;

    if (isHit && hitPoint && hitNormal) {
        spawnBulletHole(hitPoint, hitNormal);
    }

    setTimeout(() => {
        if (muzzleFlash) muzzleFlash.visible = false;
    }, 50);
}

// Remote tracer — no muzzle flash, no bullet hole on our side
export function spawnRemoteTracer(ox, oy, oz, dx, dy, dz) {
    const start = new THREE.Vector3(ox, oy, oz);
    const dir = new THREE.Vector3(dx, dy, dz);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    const end = start.clone().add(dir.multiplyScalar(100));

    spawnBulletTracer(start, end, null, false, null);
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

// Call each frame to clean up expired tracers
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

// ============================================================
// ACCESSORS + RENDER
// ============================================================
export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getClock() { return clock; }

export function render() {
    cleanupTracers();
    renderer.render(scene, camera);
}