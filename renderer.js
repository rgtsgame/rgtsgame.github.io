import * as THREE from 'three';

let scene, camera, renderer, clock;
let gunModel;
let debugHitboxesGroup = null;
let loadedMeshes = [];

const bulletHoleTexture = new THREE.TextureLoader().load('bullet_hole.png');
const bulletHoles = [];
const MAX_BULLET_HOLES = 50;

const PLAYER_HEIGHT = 1.7;

export let gunModels = {};
export let setViewWeapon = () => { };

const remotePlayers = new Map();

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
    ctx.fillRect(0, 10, 300, 40);
    ctx.font = 'bold 32px Arial';
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

    scene.add(tracerGroup);

    const result = createGun();
    gunModels = result.gunModels;
    setViewWeapon = result.setViewWeapon;

    addEventListener('resize', () => {
        camera.aspect = innerWidth / innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(innerWidth, innerHeight);
    });
}

function createGun() {
    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x2b2d31, metalness: 0.95, roughness: 0.35
    });
    const steelMat = new THREE.MeshStandardMaterial({
        color: 0x8a8f96, metalness: 1.0, roughness: 0.25
    });
    const darkPolyMat = new THREE.MeshStandardMaterial({
        color: 0x1e1f22, metalness: 0.15, roughness: 0.75
    });
    const woodMat = new THREE.MeshStandardMaterial({
        color: 0x6b3f1d, metalness: 0.0, roughness: 0.85
    });
    const gripMat = new THREE.MeshStandardMaterial({
        color: 0x141414, metalness: 0.1, roughness: 0.95
    });
    const bladeMat = new THREE.MeshStandardMaterial({
        color: 0xd8dde2, metalness: 1.0, roughness: 0.12
    });

    function rbox(w, h, d, r = 0.005, seg = 2) {
        if (typeof RoundedBoxGeometry !== 'undefined') {
            return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2));
        }
        return new THREE.BoxGeometry(w, h, d);
    }

    function cylZ(rTop, rBottom, len, seg = 16) {
        const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg);
        g.rotateX(Math.PI / 2);
        return g;
    }

    function mesh(geo, mat, x = 0, y = 0, z = 0) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        return m;
    }

    function curvedMag(segCount, length, w, d, curve, mat) {
        const group = new THREE.Group();
        const segLen = length / segCount;
        let z = 0, y = 0, angle = 0;
        for (let i = 0; i < segCount; i++) {
            const seg = mesh(rbox(w, segLen + 0.001, d, 0.004, 2), mat);
            seg.position.set(0, y, z);
            seg.rotation.x = angle;
            group.add(seg);
            angle += curve;
            y -= Math.cos(angle) * segLen;
            z += Math.sin(angle) * segLen * 0.5;
        }
        return group;
    }

    function picatinnyRail(length, width = 0.022, toothH = 0.004, mat = metalMat) {
        const g = new THREE.Group();
        const base = mesh(rbox(width, toothH, length, 0.002, 1), mat);
        g.add(base);
        const count = Math.floor(length / 0.012);
        for (let i = 0; i < count; i++) {
            const t = mesh(rbox(width * 0.9, toothH * 0.6, 0.007, 0.001, 1), mat);
            t.position.set(0, toothH * 0.8, -length / 2 + 0.006 + i * 0.012);
            g.add(t);
        }
        return g;
    }

    const models = {};

    const ak47 = new THREE.Group();

    const akBody = mesh(rbox(0.075, 0.085, 0.42, 0.008, 3), metalMat, 0, 0, 0.05);
    ak47.add(akBody);

    const akDustCover = mesh(rbox(0.070, 0.03, 0.34, 0.012, 3), metalMat, 0, 0.055, 0.05);
    ak47.add(akDustCover);

    const akEjectPort = mesh(new THREE.BoxGeometry(0.002, 0.025, 0.07), darkPolyMat, 0.038, 0.025, -0.02);
    ak47.add(akEjectPort);

    const akChargeHandle = mesh(rbox(0.012, 0.014, 0.045, 0.003, 2), metalMat, 0.042, 0.03, 0.02);
    ak47.add(akChargeHandle);

    const akSelector = mesh(rbox(0.006, 0.018, 0.06, 0.002, 2), metalMat, 0.040, -0.005, 0.08);
    akSelector.rotation.x = -0.15;
    ak47.add(akSelector);

    const rivetGeo = new THREE.SphereGeometry(0.004, 8, 6);
    [[0.038, 0.01, 0.16], [0.038, -0.01, 0.16],
    [0.038, 0.01, -0.02], [-0.038, 0.01, -0.02],
    [-0.038, 0.01, 0.16]].forEach(([x, y, z]) => {
        ak47.add(mesh(rivetGeo, metalMat, x, y, z));
    });

    ak47.add(mesh(cylZ(0.016, 0.016, 0.32, 16), metalMat, 0, 0.018, -0.30));
    ak47.add(mesh(cylZ(0.026, 0.026, 0.04, 16), metalMat, 0, 0.018, -0.16));
    ak47.add(mesh(cylZ(0.024, 0.024, 0.05, 16), metalMat, 0, 0.018, -0.47));
    ak47.add(mesh(cylZ(0.028, 0.028, 0.02, 16), metalMat, 0, 0.018, -0.50));

    ak47.add(mesh(cylZ(0.022, 0.022, 0.035, 12), metalMat, 0, 0.058, -0.28));
    ak47.add(mesh(cylZ(0.012, 0.012, 0.26, 10), metalMat, 0, 0.058, -0.16));
    ak47.add(mesh(cylZ(0.017, 0.017, 0.015, 12), metalMat, 0, 0.058, -0.03));

    const akHandguard = mesh(rbox(0.065, 0.058, 0.22, 0.012, 3), woodMat, 0, -0.005, -0.28);
    ak47.add(akHandguard);
    const akUpperGuard = mesh(rbox(0.058, 0.032, 0.18, 0.010, 3), woodMat, 0, 0.055, -0.27);
    ak47.add(akUpperGuard);

    ak47.add(mesh(cylZ(0.032, 0.032, 0.012, 12), metalMat, 0, 0.025, -0.17));

    const akMag = curvedMag(6, 0.20, 0.055, 0.085, 0.18, darkPolyMat);
    akMag.position.set(0, -0.08, -0.02);
    ak47.add(akMag);
    ak47.add(mesh(rbox(0.02, 0.02, 0.012, 0.002, 1), metalMat, 0, -0.09, 0.03));

    const akGrip = mesh(rbox(0.045, 0.13, 0.06, 0.008, 3), gripMat, 0, -0.115, 0.16);
    akGrip.rotation.x = 0.22;
    ak47.add(akGrip);
    for (let i = 0; i < 5; i++) {
        const ridge = mesh(rbox(0.046, 0.005, 0.062, 0.002, 1), gripMat, 0, -0.155 + i * 0.014, 0.16);
        ridge.rotation.x = 0.22;
        ak47.add(ridge);
    }

    const akTriggerGuard = mesh(
        new THREE.TorusGeometry(0.028, 0.004, 8, 16, Math.PI), metalMat, 0, -0.065, 0.075);
    akTriggerGuard.rotation.x = Math.PI / 2;
    akTriggerGuard.rotation.z = Math.PI;
    ak47.add(akTriggerGuard);
    const akTrigger = mesh(rbox(0.008, 0.026, 0.008, 0.002, 1), metalMat, 0, -0.062, 0.075);
    akTrigger.rotation.x = -0.15;
    ak47.add(akTrigger);

    ak47.add(mesh(rbox(0.045, 0.018, 0.03, 0.002, 2), metalMat, 0, 0.075, 0.02));
    ak47.add(mesh(rbox(0.006, 0.012, 0.008, 0.001, 1), metalMat, -0.011, 0.086, 0.02));
    ak47.add(mesh(rbox(0.006, 0.012, 0.008, 0.001, 1), metalMat, 0.011, 0.086, 0.02));
    ak47.add(mesh(rbox(0.03, 0.045, 0.02, 0.003, 2), metalMat, 0, 0.048, -0.44));
    ak47.add(mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.025, 6), metalMat, 0, 0.075, -0.44));
    ak47.add(mesh(rbox(0.006, 0.03, 0.006, 0.001, 1), metalMat, -0.013, 0.065, -0.44));
    ak47.add(mesh(rbox(0.006, 0.03, 0.006, 0.001, 1), metalMat, 0.013, 0.065, -0.44));

    const akStock = mesh(rbox(0.052, 0.075, 0.26, 0.010, 3), woodMat, 0, -0.012, 0.39);
    ak47.add(mesh(rbox(0.056, 0.085, 0.012, 0.004, 2), metalMat, 0, -0.014, 0.52));
    const slingLoop = mesh(new THREE.TorusGeometry(0.012, 0.0025, 6, 12), metalMat, -0.028, -0.05, 0.46);
    slingLoop.rotation.y = Math.PI / 2;
    ak47.add(slingLoop);

    ak47.position.set(0.22, -0.19, -0.42);
    ak47.rotation.y = 0.04;
    models.ak47 = ak47;

    const pistol = new THREE.Group();

    const pistolSlide = mesh(rbox(0.048, 0.045, 0.26, 0.006, 3), metalMat, 0, 0.02, -0.03);
    pistol.add(pistolSlide);

    const pistolSlideFrontBevel = mesh(rbox(0.044, 0.012, 0.03, 0.004, 2), metalMat, 0, 0.04, -0.14);
    pistolSlideFrontBevel.rotation.x = 0.4;
    pistol.add(pistolSlideFrontBevel);

    const rail = picatinnyRail(0.07);
    rail.position.set(0, -0.005, -0.10);
    pistol.add(rail);

    for (let i = 0; i < 5; i++) {
        const serr = mesh(rbox(0.05, 0.028, 0.005, 0.001, 1), metalMat, 0, 0.02, 0.045 + i * 0.010);
        pistol.add(serr);
    }

    pistol.add(mesh(new THREE.BoxGeometry(0.002, 0.022, 0.055), darkPolyMat, 0.024, 0.028, -0.05));

    pistol.add(mesh(cylZ(0.012, 0.012, 0.03, 12), steelMat, 0, 0.02, -0.17));
    pistol.add(mesh(new THREE.TorusGeometry(0.011, 0.002, 6, 16), steelMat, 0, 0.02, -0.185));

    const pistolFrame = mesh(rbox(0.044, 0.04, 0.20, 0.006, 2), darkPolyMat, 0, -0.018, 0.00);
    pistol.add(pistolFrame);

    pistol.add(mesh(rbox(0.046, 0.006, 0.16, 0.002, 1), metalMat, 0, 0.005, 0.00));

    pistol.add(mesh(rbox(0.036, 0.012, 0.06, 0.002, 1), darkPolyMat, 0, -0.036, -0.08));

    const pistolGrip = mesh(rbox(0.042, 0.13, 0.055, 0.010, 3), gripMat, 0, -0.09, 0.075);
    pistolGrip.rotation.x = 0.28;
    pistol.add(pistolGrip);

    for (let i = 0; i < 6; i++) {
        const ridge = mesh(rbox(0.043, 0.004, 0.058, 0.001, 1), gripMat, 0, -0.14 + i * 0.014, 0.075);
        ridge.rotation.x = 0.28;
        pistol.add(ridge);
    }

    pistol.add(mesh(rbox(0.044, 0.012, 0.06, 0.003, 2), darkPolyMat, 0, -0.155, 0.10));
    pistol.add(mesh(rbox(0.044, 0.11, 0.006, 0.002, 1), darkPolyMat, 0, -0.085, 0.115));

    const pistolGuard = mesh(new THREE.TorusGeometry(0.026, 0.004, 8, 16, Math.PI), darkPolyMat, 0, -0.04, 0.015);
    pistolGuard.rotation.x = Math.PI / 2;
    pistolGuard.rotation.z = Math.PI;
    pistol.add(pistolGuard);

    const pistolTrigger = mesh(rbox(0.007, 0.024, 0.008, 0.002, 1), metalMat, 0, -0.038, 0.015);
    pistolTrigger.rotation.x = -0.12;
    pistol.add(pistolTrigger);

    pistol.add(mesh(rbox(0.003, 0.015, 0.004, 0.001, 1), darkPolyMat, 0, -0.037, 0.018));

    pistol.add(mesh(rbox(0.006, 0.012, 0.008, 0.001, 1), metalMat, 0, 0.048, -0.155));
    pistol.add(mesh(rbox(0.032, 0.008, 0.008, 0.001, 1), metalMat, 0, 0.048, 0.075));
    pistol.add(mesh(rbox(0.008, 0.012, 0.008, 0.001, 1), metalMat, -0.011, 0.052, 0.075));
    pistol.add(mesh(rbox(0.008, 0.012, 0.008, 0.001, 1), metalMat, 0.011, 0.052, 0.075));

    pistol.add(mesh(rbox(0.006, 0.008, 0.04, 0.002, 1), metalMat, 0.024, -0.005, 0.02));
    pistol.add(mesh(rbox(0.008, 0.010, 0.008, 0.002, 1), darkPolyMat, 0.024, -0.035, 0.05));
    const takedown = mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 12), metalMat, 0.024, 0.005, 0.06);
    takedown.rotation.z = Math.PI / 2;
    pistol.add(takedown);

    pistol.position.set(0.22, -0.20, -0.40);
    pistol.rotation.y = 0.03;
    models.pistol = pistol;

    const knife = new THREE.Group();

    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-0.014, 0);
    bladeShape.lineTo(0.014, 0);
    bladeShape.lineTo(0.014, 0.20);
    bladeShape.lineTo(0.010, 0.235);
    bladeShape.lineTo(-0.010, 0.245);
    bladeShape.lineTo(-0.014, 0.20);
    bladeShape.lineTo(-0.014, 0.02);
    bladeShape.closePath();

    const bladeExtrude = new THREE.ExtrudeGeometry(bladeShape, {
        depth: 0.012,
        bevelEnabled: true,
        bevelThickness: 0.0012,
        bevelSize: 0.0015,
        bevelSegments: 2,
        steps: 1
    });
    bladeExtrude.center();
    const blade = new THREE.Mesh(bladeExtrude, bladeMat);
    blade.rotation.x = -Math.PI / 2;
    blade.position.set(0, 0, -0.12);
    knife.add(blade);

    const fuller = mesh(rbox(0.002, 0.002, 0.16, 0.0005, 1), metalMat, 0.004, 0.004, -0.12);
    knife.add(fuller);

    const guard = mesh(rbox(0.06, 0.012, 0.018, 0.004, 2), metalMat, 0, 0, 0);
    knife.add(guard);

    const handle = mesh(rbox(0.030, 0.030, 0.13, 0.008, 3), gripMat, 0, 0, 0.085);
    knife.add(handle);

    for (const s of [-1, 1]) {
        const scale = mesh(rbox(0.006, 0.028, 0.11, 0.002, 1), darkPolyMat, s * 0.014, 0, 0.085);
        knife.add(scale);
    }

    for (let i = 0; i < 3; i++) {
        const rivet = mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.034, 10), metalMat, 0, 0, 0.045 + i * 0.04);
        rivet.rotation.z = Math.PI / 2;
        knife.add(rivet);
    }

    const pommel = mesh(cylZ(0.016, 0.016, 0.018, 10), metalMat, 0, 0, 0.16);
    knife.add(pommel);
    const lanyardHole = mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.036, 8), darkPolyMat, 0, 0, 0.16);
    lanyardHole.rotation.z = Math.PI / 2;
    knife.add(lanyardHole);

    const gripRing = mesh(new THREE.TorusGeometry(0.015, 0.0025, 8, 16), metalMat, 0, 0, 0.03);
    gripRing.rotation.y = Math.PI / 2;
    knife.add(gripRing);

    knife.position.set(0.24, -0.20, -0.40);
    knife.rotation.set(0.15, -0.30, 0.10);
    models.knife = knife;

    camera.add(models.ak47);
    camera.add(models.pistol);
    camera.add(models.knife);

    models.ak47.visible = true;
    models.pistol.visible = false;
    models.knife.visible = false;

    function setViewWeapon(key) {
        for (const k in models) models[k].visible = false;
        if (models[key]) models[key].visible = true;
    }

    return { gunModels: models, setViewWeapon };
}

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

    const nameTag = makeNameTagSprite(name);
    group.add(nameTag);

    scene.add(group);

    const healthBar = makeHealthBar();
    healthBar.group.position.set(0, 0, 0);
    scene.add(healthBar.group);

    // ✅ NEW: Clone the actual 3D models
    const weaponGroup = new THREE.Group();

    // Scale down so it's proportional to the blocky body
    weaponGroup.scale.set(2, 2, 2);

    // Move it to the end of the arm and rotate it forward
    weaponGroup.position.set(0, -0.45, -0.1);
    weaponGroup.rotation.x = 0;

    if (gunModels.ak47) {
        const ak = gunModels.ak47.clone();
        ak.position.set(0, 0, 0); // Reset local position
        ak.rotation.set(0, 0, 0); // Reset local rotation
        weaponGroup.add(ak);
    }
    if (gunModels.pistol) {
        const p = gunModels.pistol.clone();
        p.position.set(0, 0, 0);
        p.rotation.set(0, 0, 0);
        weaponGroup.add(p);
    }
    if (gunModels.knife) {
        const k = gunModels.knife.clone();
        k.position.set(0, 0, 0);
        k.rotation.set(0, 0, 0);
        weaponGroup.add(k);
    }

    // By default, show the AK-47, hide the others
    if (weaponGroup.children[0]) weaponGroup.children[0].visible = true;
    if (weaponGroup.children[1]) weaponGroup.children[1].visible = false;
    if (weaponGroup.children[2]) weaponGroup.children[2].visible = false;

    armR.add(weaponGroup);

    // Mark for raycast resolution
    group.userData = { type: 'remotePlayer', id: id, bodyMesh: body };
    body.userData.remoteId = id;

    remotePlayers.set(id, {
        id,
        name,
        mesh: group,
        nameTag,
        healthBar,
        bodyMat,
        weaponGroup, // ✅ Save reference to the group
        targetPos: new THREE.Vector3(0, 0, 0),
        targetYaw: 0,
        targetHealth: 100,
        alive: true,
    });

    return group;
}

export function setRemotePlayerWeapon(id, weaponKey) {
    const rp = remotePlayers.get(id);
    if (!rp || !rp.weaponGroup) return;

    // The weaponGroup children are added in this order: [ak47, pistol, knife]
    // based on how we pushed them in spawnRemotePlayer
    const children = rp.weaponGroup.children;
    if (children.length < 3) return;

    children.forEach(c => c.visible = false);

    if (weaponKey === 'ak47' && children[0]) children[0].visible = true;
    if (weaponKey === 'pistol' && children[1]) children[1].visible = true;
    if (weaponKey === 'knife' && children[2]) children[2].visible = true;
}

function makeHealthBar() {
    const bgGeo = new THREE.PlaneGeometry(1.0, 0.12);
    const bgMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false });
    const bg = new THREE.Mesh(bgGeo, bgMat);

    const fillGeo = new THREE.PlaneGeometry(1.0, 0.10);
    const fillMat = new THREE.MeshBasicMaterial({ color: 0x2ecc71, depthTest: false });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.position.z = 0.001;

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
            fill.position.x = -(1 - pct) * 0.5;
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
    // Subtract PLAYER_HEIGHT so the feet touch the ground, not the camera height
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

export function getRemotePlayerMeshes() {
    const out = [];
    remotePlayers.forEach(rp => {
        if (rp.alive) out.push(rp.mesh);
    });
    return out;
}

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
        debugHitboxesGroup.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
        debugHitboxesGroup = null;
        return;
    }

    debugHitboxesGroup = new THREE.Group();
    const debugMat = new THREE.LineBasicMaterial({ color: 0xff0000 });

    for (const c of colliders) {
        // If it's the ground plane (size 0), draw a flat red square at its Y position
        if (c.isSlope && c.halfSize.x === 0) {
            const planeGeo = new THREE.PlaneGeometry(120, 120); // Just a visual indicator
            const edges = new THREE.EdgesGeometry(planeGeo);
            const line = new THREE.LineSegments(edges, debugMat);
            line.position.copy(c.position);
            line.rotation.copy(c.rotation);
            debugHitboxesGroup.add(line);
            continue;
        }

        // Draw the REAL Oriented Bounding Box (OBB)
        const geo = new THREE.BoxGeometry(
            c.halfSize.x * 2, 
            c.halfSize.y * 2, 
            c.halfSize.z * 2
        );
        const edges = new THREE.EdgesGeometry(geo);
        const line = new THREE.LineSegments(edges, debugMat);

        line.position.copy(c.position);
        line.rotation.copy(c.rotation);

        geo.dispose();
        debugHitboxesGroup.add(line);
    }

    scene.add(debugHitboxesGroup);
}

let reloadState = {
    active: false,
    progress: 0,
};

export function setReloadState(active, progress = 0) {
    reloadState.active = active;
    reloadState.progress = progress;
}

export function updateViewModel(time, isMoving) {
    if (!gunModel) return;

    let targetX = 0.25;
    let targetY = -0.2;
    let targetZ = -0.5;
    let targetRotX = 0;
    let targetRotY = -0.05;
    let targetRotZ = 0;

    if (isMoving) {
        targetX += Math.sin(time * 10) * 0.01;
        targetY += Math.cos(time * 20) * 0.01;
    }

    if (reloadState.active) {
        const t = reloadState.progress;

        let dip = 0;
        let tilt = 0;
        let shake = 0;

        if (t < 0.3) {
            const p = t / 0.3;
            dip = easeOutCubic(p) * 0.4;
            tilt = easeOutCubic(p) * 0.9;
        } else if (t < 0.7) {
            dip = 0.4;
            tilt = 0.9;
            const shakePhase = (t - 0.3) / 0.4;
            shake = Math.sin(shakePhase * Math.PI * 6) * 0.04;
        } else {
            const p = (t - 0.7) / 0.3;
            dip = (1 - easeInCubic(p)) * 0.4;
            tilt = (1 - easeInCubic(p)) * 0.9;
        }

        targetY -= dip;
        targetRotZ = tilt;
        targetX += shake;
    }

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
const activeTracers = [];

export function spawnBulletTracer(startPos, endPos, hitNormal, isHit, hitPoint, isLocalShot = true) {
    const distance = startPos.distanceTo(endPos);
    if (distance < 0.01) return;

    const geometry = new THREE.CylinderGeometry(0.015, 0.015, distance, 4);
    geometry.translate(0, distance / 2, 0);
    const material = new THREE.MeshBasicMaterial({ color: 0xffff00 });

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