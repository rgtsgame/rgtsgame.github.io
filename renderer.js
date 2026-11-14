import * as THREE from 'three';

let scene, camera, renderer, clock;
let gunModel;
let debugHitboxesGroup = null;
let loadedMeshes = [];

const bulletHoleTexture = new THREE.TextureLoader().load('bullet_hole.png');
const bulletHoles = [];
const MAX_BULLET_HOLES = 50;

// Generates a small grass texture using HTML Canvas
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

export const npcMeshes = [];

export function spawnNPCMesh(id, position) {
    // Create a simple blocky character
    const group = new THREE.Group();
    group.position.set(position[0], position[1], position[2]);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff2222 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffccaa });

    // Torso
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), bodyMat);
    body.position.y = 1.0;
    body.castShadow = true;
    group.add(body);

    // Head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), headMat);
    head.position.y = 1.8;
    head.castShadow = true;
    group.add(head);

    // Arms
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
        npc.userData.bodyMesh.material.color.setHex(0xffffff); // Flash white
        setTimeout(() => {
            if (!npc.userData.isDead) npc.userData.bodyMesh.material.color.setHex(0xff2222);
        }, 100);
    }
}

export async function loadMap(url) {
    const res = await fetch(url);
    const data = await res.json();

    // Clear previous meshes if loading a new map
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

        // Apply full 3D rotation (X, Y, Z)
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

// Add these variables at the top of renderer.js
let tracerGroup = new THREE.Group();
let muzzleFlash = null;
let tracerTimeout = null;

export function spawnBulletTracer(startPos, endPos, hitNormal, isHit, hitPoint) {
    // 1. Create a thin cylinder for the laser beam (easier to see than a Line)
    const distance = startPos.distanceTo(endPos);
    const geometry = new THREE.CylinderGeometry(0.015, 0.015, distance, 4);
    // Rotate the cylinder so it points from start to end
    geometry.translate(0, distance / 2, 0);

    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });
    const beam = new THREE.Mesh(geometry, material);

    beam.position.copy(startPos);
    beam.lookAt(endPos);
    tracerGroup.add(beam);

    // 2. Muzzle Flash
    if (!muzzleFlash) {
        muzzleFlash = new THREE.PointLight(0xffaa00, 5, 5);
        muzzleFlash.position.set(0.25, -0.2, -0.8);
        getCamera().add(muzzleFlash);
    }
    muzzleFlash.visible = true;

    // 3. Spawn Bullet Hole if we hit something
    if (isHit && hitPoint && hitNormal) {
        spawnBulletHole(hitPoint, hitNormal);
    }

    // 4. Cleanup the laser beam after 50ms
    clearTimeout(tracerTimeout);
    tracerTimeout = setTimeout(() => {
        tracerGroup.remove(beam);
        geometry.dispose();
        material.dispose();
        if (muzzleFlash) muzzleFlash.visible = false;
    }, 50);
}

function spawnBulletHole(position, normal) {
    const mat = new THREE.MeshBasicMaterial({
        map: bulletHoleTexture,
        transparent: true,
        depthWrite: false, // Prevents z-fighting
        polygonOffset: true, // Pushes the decal slightly forward
        polygonOffsetFactor: -1
    });

    const geo = new THREE.PlaneGeometry(0.4, 0.4);
    const hole = new THREE.Mesh(geo, mat);

    // Position slightly off the wall to prevent flickering
    hole.position.copy(position).add(normal.clone().multiplyScalar(0.01));

    // Align the hole to face the normal of the wall
    hole.lookAt(position.clone().add(normal));

    scene.add(hole);
    bulletHoles.push(hole);

    // Remove oldest bullet hole if we hit the limit
    if (bulletHoles.length > MAX_BULLET_HOLES) {
        const oldHole = bulletHoles.shift();
        scene.remove(oldHole);
        oldHole.geometry.dispose();
        oldHole.material.dispose();
    }
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getClock() { return clock; }

export function render() {
    renderer.render(scene, camera);
}