import * as THREE from 'three';
import {
    getCamera, getClock, toggleHitboxes, getLoadedMeshes,
    spawnBulletTracer,
    getRemotePlayerMeshes, findRemoteIdByObject
} from './renderer.js';
import { soundManager, syncManager } from './main.js';

const keys = {};
const direction = new THREE.Vector3();
let yaw = 0, pitch = 0;

let colliders = [];
let collidableMeshes = [];
let spawnPoints = [];
let localPlayer = null;

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 30;
const JUMP_FORCE = 11;
const MOVE_SPEED = 12;
const STEP_HEIGHT = 0.6;

const SLIDE_SPEED = 22;
const SLIDE_DURATION = 0.55;
const SLIDE_COOLDOWN = 1.2;
const SLIDE_HEIGHT = 0.9;
let slideTimer = 0;
let slideCooldownTimer = 0;
let isSliding = false;
const slideDir = new THREE.Vector3();

let lastShootTime = 0;
const WEAPONS = {
    ak47: { name: 'AK-47', damage: 25, fireRate: 150, range: 100, maxAmmo: 30, maxReserve: 90, reloadTime: 1800, isMelee: false },
    pistol: { name: 'Pistol', damage: 34, fireRate: 300, range: 50, maxAmmo: 12, maxReserve: 48, reloadTime: 1200, isMelee: false },
    knife: { name: 'Knife', damage: 100, fireRate: 500, range: 2.5, maxAmmo: Infinity, maxReserve: Infinity, reloadTime: 0, isMelee: true },
};

let currentWeaponKey = 'ak47';
let weaponState = {
    ak47: { ammo: 30, reserve: 90 },
    pistol: { ammo: 12, reserve: 48 },
    knife: { ammo: Infinity, reserve: Infinity },
};

let isReloading = false;
let reloadStartTime = 0;
let reloadDuration = 1800;

let shakeIntensity = 0;
const SHAKE_DECAY = 15;
const SHAKE_STRENGTH = 0.5;

const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
let isMobile = isTouchDevice;

const mobileState = {
    moveX: 0, moveY: 0, jumping: false, shooting: false, sliding: false,
    lookTouchId: null, lastLookX: 0, lastLookY: 0,
    joystickTouchId: null, joystickCenterX: 0, joystickCenterY: 0,
};

let mobileUI = null;

export function initInput(canvas) {
    canvas.addEventListener('click', () => {
        if (localPlayer && localPlayer.alive === false) return;
        if (!isMobile) canvas.requestPointerLock();
    });

    document.addEventListener('mousemove', (e) => {
        if (isMobile) return;
        if (document.pointerLockElement !== canvas) return;
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    });

    addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'KeyH') toggleHitboxes(colliders);
        if (e.code === 'KeyC') tryStartSlide();
        if (e.code === 'KeyR') reload();
        if (e.code === 'Digit1') switchWeapon(1);
        if (e.code === 'Digit2') switchWeapon(2);
        if (e.code === 'Digit3') switchWeapon(3);
    });
    addEventListener('keyup', (e) => keys[e.code] = false);

    addEventListener('mousedown', (e) => {
        if (isMobile) return;
        if (document.pointerLockElement === canvas && e.button === 0) {
            shoot();
        }
    });

    addEventListener('resize', () => updateResponsiveFOV());

    if (isMobile) {
        buildMobileUI(canvas);
    }
}

function updateResponsiveFOV() {
    const camera = getCamera();
    if (!camera) return;
    const aspect = window.innerWidth / window.innerHeight;
    let baseFov = 75;
    if (aspect < 0.8) baseFov = 85;
    else if (aspect < 1.2) baseFov = 80;
    if (isMobile && window.innerHeight < 500) baseFov += 5;
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
}

function buildMobileUI(canvas) {
    if (mobileUI) return;
    // ... (Keep your existing mobile UI build code here) ...
    updateResponsiveFOV();
}

function isTouchOnUI(touch) {
    if (!mobileUI) return false;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return false;
    return el.closest('#mobile-ui') !== null;
}

function updateJoystick(clientX, clientY, knob, radius) {
    let dx = clientX - mobileState.joystickCenterX;
    let dy = clientY - mobileState.joystickCenterY;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
    }
    mobileState.moveX = dx / radius;
    mobileState.moveY = dy / radius;
    knob.style.left = `calc(50% + ${dx}px)`;
    knob.style.top = `calc(50% + ${dy}px)`;
}

function tryStartSlide() {
    if (!localPlayer || !localPlayer.alive) return;
    if (slideCooldownTimer > 0) return;
    if (isSliding) return;

    isSliding = true;
    slideTimer = SLIDE_DURATION;
    slideCooldownTimer = SLIDE_COOLDOWN;

    const dir = getMoveInputDirection();
    if (dir.lengthSq() > 0.0001) slideDir.copy(dir).normalize();
    else slideDir.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
}

function getMoveInputDirection() {
    const out = new THREE.Vector3(0, 0, 0);
    let ix = 0, iz = 0;

    if (isMobile) {
        ix = mobileState.moveX;
        iz = mobileState.moveY;
        if (Math.hypot(ix, iz) < 0.15) return out;
    } else {
        if (keys['KeyW']) iz -= 1;
        if (keys['KeyS']) iz += 1;
        if (keys['KeyA']) ix -= 1;
        if (keys['KeyD']) ix += 1;
        if (ix === 0 && iz === 0) return out;
    }

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    out.x = forward.x * -iz + right.x * ix;
    out.z = forward.z * -iz + right.z * ix;
    return out;
}

function reload() {
    if (!localPlayer || !localPlayer.alive) return;
    if (isReloading) return;

    const weapon = WEAPONS[currentWeaponKey];
    const state = weaponState[currentWeaponKey];

    if (weapon.isMelee) return;
    if (state.ammo >= weapon.maxAmmo) return;
    if (state.reserve <= 0) return;

    isReloading = true;
    reloadStartTime = performance.now();
    reloadDuration = weapon.reloadTime;

    soundManager.play('reload_start', 0.7, 1.0);
    import('./main.js').then(m => m.hud?.showReloading?.());
}

function shoot() {
    if (!localPlayer || !localPlayer.alive) return;
    if (isReloading) return;

    const weapon = WEAPONS[currentWeaponKey];
    const state = weaponState[currentWeaponKey];

    if (!weapon.isMelee && state.ammo <= 0) {
        reload();
        return;
    }

    const now = performance.now();
    if (now - lastShootTime < weapon.fireRate) return;
    lastShootTime = now;
    shakeIntensity = 0.5;

    if (!weapon.isMelee) {
        state.ammo--;
        import('./main.js').then(m => {
            m.hud?.setAmmo(state.ammo, weapon.maxAmmo, state.reserve);
            if (state.ammo === 0) m.hud?.showAmmoWarning?.();
        });
    }

    const randomPitch = 0.95 + Math.random() * 0.1;
    soundManager.play('shoot', weapon.isMelee ? 0.5 : 0.8, randomPitch);

    const camera = getCamera();
    const shootRaycaster = new THREE.Raycaster();
    shootRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    shootRaycaster.far = weapon.range;

    const hitsMap = shootRaycaster.intersectObjects(collidableMeshes, false);
    const hitsRemote = shootRaycaster.intersectObjects(getRemotePlayerMeshes(), true);

    const wallDist = hitsMap.length ? hitsMap[0].distance : Infinity;
    const remDist = hitsRemote.length ? hitsRemote[0].distance : Infinity;

    const dir = camera.getWorldDirection(new THREE.Vector3());
    const gunOffset = new THREE.Vector3(0.2, -0.2, -0.5).applyMatrix4(camera.matrixWorld);

    if (!weapon.isMelee) {
        syncManager?.sendShoot(gunOffset, dir);
    }

    if (remDist < wallDist) {
        const remoteId = findRemoteIdByObject(hitsRemote[0].object);
        if (remoteId) {
            syncManager?.sendHit(remoteId, weapon.damage, hitsRemote[0].point);
            import('./main.js').then(m => m.hud?.showHitmarker());
            spawnBulletTracer(gunOffset, hitsRemote[0].point, null, true, null);
            return;
        }
    }

    let hitPoint, hitNormal = null, isHit = false;
    if (hitsMap.length > 0) {
        hitPoint = hitsMap[0].point;
        hitNormal = hitsMap[0].face.normal.clone().transformDirection(hitsMap[0].object.matrixWorld);
        isHit = true;
    } else {
        hitPoint = shootRaycaster.ray.at(weapon.range, new THREE.Vector3());
    }

    if (!weapon.isMelee) {
        spawnBulletTracer(gunOffset, hitPoint, hitNormal, isHit, hitPoint);
    }
}

function switchWeapon(slot) {
    if (!localPlayer || !localPlayer.alive) return;
    if (isReloading) return;

    const keys = ['ak47', 'pistol', 'knife'];
    const newKey = keys[slot - 1];
    if (!newKey || newKey === currentWeaponKey) return;

    currentWeaponKey = newKey;
    const weapon = WEAPONS[currentWeaponKey];
    const state = weaponState[currentWeaponKey];

    syncManager?.send([17, newKey]);

    import('./main.js').then(m => {
        m.hud?.setAmmo(state.ammo, weapon.maxAmmo, state.reserve);
        m.hud?.setWeaponName?.(weapon.name);
        m.hud?.highlightSlot?.(slot);
    });

    import('./renderer.js').then(m => m.setViewWeapon?.(newKey));
    soundManager.play('switch', 0.4, 1.0);
}

function buildOBB(mesh) {
    const m = mesh.userData.originalData;
    const isPlane = m.type === 'plane';

    let sx = 1, sy = 1, sz = 1;
    if (Array.isArray(m.size)) {
        sx = isPlane ? m.size[0] : m.size[0];
        sy = isPlane ? 0.1 : m.size[1];
        sz = isPlane ? m.size[1] : m.size[2];
    }

    if (isPlane) {
        return { isSlope: true, mesh }; // Ignore horizontal collisions for planes
    }

    const isSlope = Math.abs(mesh.rotation.x) > 0.01 || Math.abs(mesh.rotation.z) > 0.01;

    return {
        isSlope: isSlope,
        mesh: mesh, // ✅ ADD THIS LINE so Raycast can use it!
        position: new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
        halfSize: new THREE.Vector3(sx / 2, sy / 2, sz / 2),
        rotation: mesh.rotation.clone()
    };
}

export function initGame(mapData) {
    const meshes = getLoadedMeshes();
    collidableMeshes = meshes.filter(mesh => mesh.userData.collidable);
    colliders = collidableMeshes.map(mesh => buildOBB(mesh));
    spawnPoints = mapData.spawnPoints || [];

    const sp = spawnPoints[0];
    let spawnPos = new THREE.Vector3(0, 1.7, 0);
    if (sp && sp.position) {
        if (Array.isArray(sp.position)) spawnPos.set(sp.position[0], sp.position[1], sp.position[2]);
        else spawnPos.set(sp.position.x, sp.position.y, sp.position.z);
    }

    localPlayer = {
        position: spawnPos,
        velocityY: 0,
        onGround: false,
        alive: true,
    };

    weaponState = {
        ak47: { ammo: WEAPONS.ak47.maxAmmo, reserve: WEAPONS.ak47.maxReserve },
        pistol: { ammo: WEAPONS.pistol.maxAmmo, reserve: WEAPONS.pistol.maxReserve },
        knife: { ammo: Infinity, reserve: Infinity },
    };
    currentWeaponKey = 'ak47';

    isSliding = false;
    slideTimer = 0;
    slideCooldownTimer = 0;
    updateResponsiveFOV();
}

function getPenetration(x, z, obb, buffer = PLAYER_RADIUS) {
    const dx = x - obb.position.x;
    const dz = z - obb.position.z;
    const cos = Math.cos(-obb.rotation.y);
    const sin = Math.sin(-obb.rotation.y);

    // Transform player position into the box's local space
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    const extentX = obb.halfSize.x + buffer;
    const extentZ = obb.halfSize.z + buffer;

    // Check if the player's circle overlaps the box's rectangle
    if (Math.abs(localX) < extentX && Math.abs(localZ) < extentZ) {
        const overlapX = extentX - Math.abs(localX);
        const overlapZ = extentZ - Math.abs(localZ);

        // Push out along the axis with the smallest overlap
        if (overlapX < overlapZ) {
            const pushDir = Math.sign(localX) || 1;
            // Rotate the push vector back to world space
            return { 
                pushX: Math.cos(obb.rotation.y) * overlapX * pushDir, 
                pushZ: Math.sin(obb.rotation.y) * overlapX * pushDir 
            };
        } else {
            const pushDir = Math.sign(localZ) || 1;
            return { 
                pushX: -Math.sin(obb.rotation.y) * overlapZ * pushDir, 
                pushZ: Math.cos(obb.rotation.y) * overlapZ * pushDir 
            };
        }
    }
    return null;
}

function resolveCollisions(x, y, z, buffer = PLAYER_RADIUS) {
    let finalX = x;
    let finalZ = z;
    let steppedUp = false;

    const checkHeight = y + (PLAYER_HEIGHT / 2);
    const playerCenter = new THREE.Vector3(finalX, checkHeight, finalZ);
    
    // Directions to check for walls
    const directions = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1)
    ];

    const collisionRay = new THREE.Raycaster();
    collisionRay.far = buffer + 0.1; 

    // Loop through all colliders
    for (const c of colliders) {
        if (c.isSlope) continue;

        const feetY = y;
        const headY = y + PLAYER_HEIGHT;
        
        // Vertical check
        if (headY > c.position.y - c.halfSize.y && feetY < c.position.y + c.halfSize.y) {
            
            const topOfBox = c.position.y + c.halfSize.y;
            
            // STEP UP LOGIC
            if (topOfBox <= feetY + STEP_HEIGHT) {
                const distToCenter = Math.hypot(finalX - c.position.x, finalZ - c.position.z);
                if (distToCenter < Math.max(c.halfSize.x, c.halfSize.z) + buffer) {
                    y = topOfBox + 0.01;
                    steppedUp = true;
                    continue;
                }
            }

            // WALL SLIDING LOGIC
            for (const dir of directions) {
                collisionRay.set(playerCenter, dir);
                const intersects = collisionRay.intersectObject(c.mesh, false);
                
                if (intersects.length > 0) {
                    const hit = intersects[0];
                    const pushDist = buffer - hit.distance;
                    
                    if (pushDist > 0) {
                        // Get the exact normal of the wall we hit
                        let normal = hit.face.normal.clone();
                        normal.transformDirection(c.mesh.matrixWorld);
                        
                        // Flatten the normal to ignore Y axis (up/down slopes)
                        normal.y = 0;
                        normal.normalize();

                        // Push the player out using the wall's normal
                        finalX += normal.x * pushDist;
                        finalZ += normal.z * pushDist;

                        // Update center for the next checks
                        playerCenter.x = finalX;
                        playerCenter.z = finalZ;
                    }
                }
            }
        }
    }
    return { x: finalX, z: finalZ, y: y, stepped: steppedUp };
}

function getGroundHeight(x, z, currentY) {
    let highestY = 0;

    for (const c of colliders) {
        if (c.isSlope) continue;
        const topY = c.position.y + c.halfSize.y;

        if (currentY >= topY - 0.5 && topY > highestY) {
            const dx = x - c.position.x;
            const dz = z - c.position.z;
            const cos = Math.cos(-c.rotation.y);
            const sin = Math.sin(-c.rotation.y);
            const localX = dx * cos - dz * sin;
            const localZ = dx * sin + dz * cos;

            if (Math.abs(localX) < c.halfSize.x + PLAYER_RADIUS &&
                Math.abs(localZ) < c.halfSize.z + PLAYER_RADIUS) {
                highestY = topY;
            }
        }
    }

    raycaster.set(new THREE.Vector3(x, currentY, z), downVector);
    raycaster.far = PLAYER_HEIGHT + 1.5;
    const intersects = raycaster.intersectObjects(collidableMeshes, false);

    if (intersects.length > 0) {
        const hit = intersects[0];
        if (hit.point.y > highestY && hit.point.y <= currentY + 0.2) {
            highestY = hit.point.y;
        }
    }
    return highestY;
}

export function updateGame() {
    if (!localPlayer) return;

    if (localPlayer.alive === false) {
        const cam = getCamera();
        cam.position.copy(localPlayer.position);
        return;
    }

    const camera = getCamera();
    const dt = Math.min(getClock().getDelta(), 0.1);

    if (isReloading) {
        const progress = Math.min(1, (performance.now() - reloadStartTime) / reloadDuration);
        import('./renderer.js').then(m => m.setReloadState?.(true, progress));

        if (performance.now() - reloadStartTime >= reloadDuration) {
            const weapon = WEAPONS[currentWeaponKey];
            const state = weaponState[currentWeaponKey];
            const needed = weapon.maxAmmo - state.ammo;
            const taken = Math.min(needed, state.reserve);

            state.ammo += taken;
            state.reserve -= taken;
            isReloading = false;

            import('./renderer.js').then(m => m.setReloadState?.(false, 0));
            import('./main.js').then(m => {
                m.hud?.setAmmo(state.ammo, weapon.maxAmmo, state.reserve);
                m.hud?.hideReloading?.();
            });
        }
    }

    if (slideCooldownTimer > 0) {
        slideCooldownTimer -= dt;
        if (slideCooldownTimer < 0) slideCooldownTimer = 0;
    }

    if (isSliding) {
        slideTimer -= dt;
        if (slideTimer <= 0) {
            isSliding = false;
            slideTimer = 0;
        }
    }

    if (typeof updateSlideButtonState === 'function') updateSlideButtonState();

    direction.set(0, 0, 0);
    let inputX = 0, inputZ = 0;

    if (isMobile) {
        inputX = mobileState.moveX;
        inputZ = mobileState.moveY;
        if (Math.hypot(inputX, inputZ) < 0.15) { inputX = 0; inputZ = 0; }
    } else {
        if (keys['KeyW']) inputZ -= 1;
        if (keys['KeyS']) inputZ += 1;
        if (keys['KeyA']) inputX -= 1;
        if (keys['KeyD']) inputX += 1;
    }

    const inputLen = Math.hypot(inputX, inputZ);
    if (inputLen > 1) { inputX /= inputLen; inputZ /= inputLen; }

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    let moveX, moveZ;
    const speed = isSliding ? SLIDE_SPEED : MOVE_SPEED;

    if (isSliding) {
        moveX = slideDir.x * speed * dt;
        moveZ = slideDir.z * speed * dt;
    } else {
        moveX = (forward.x * -inputZ + right.x * inputX) * speed * dt;
        moveZ = (forward.z * -inputZ + right.z * inputX) * speed * dt;
    }

    let nextX = localPlayer.position.x + moveX;
    let nextZ = localPlayer.position.z + moveZ;
    let feetY = localPlayer.position.y - PLAYER_HEIGHT;

    const resolved = resolveCollisions(nextX, feetY, nextZ);
    nextX = resolved.x;
    nextZ = resolved.z;
    feetY = resolved.y;

    localPlayer.position.x = nextX;
    localPlayer.position.z = nextZ;

    if (resolved.stepped) {
        localPlayer.position.y = feetY + PLAYER_HEIGHT;
        localPlayer.onGround = true;
        localPlayer.velocityY = 0;
    }

    const groundY = getGroundHeight(localPlayer.position.x, localPlayer.position.z, localPlayer.position.y);

    const jumpPressed = isMobile ? mobileState.jumping : keys['Space'];
    if (jumpPressed && localPlayer.onGround && !isSliding) {
        localPlayer.velocityY = JUMP_FORCE;
        localPlayer.onGround = false;
    }

    localPlayer.velocityY -= GRAVITY * dt;
    let nextY = localPlayer.position.y + (localPlayer.velocityY * dt);

    if (localPlayer.velocityY > 0) {
        for (const c of colliders) {
            if (c.isSlope) continue;
            const bottomY = c.position.y - c.halfSize.y;
            if (nextY + 0.1 > bottomY && feetY < bottomY) {
                const dx = localPlayer.position.x - c.position.x;
                const dz = localPlayer.position.z - c.position.z;
                if (Math.abs(dx) < c.halfSize.x && Math.abs(dz) < c.halfSize.z) {
                    nextY = bottomY - 0.1;
                    localPlayer.velocityY = 0;
                }
            }
        }
    }

    if (nextY - PLAYER_HEIGHT <= groundY) {
        nextY = groundY + PLAYER_HEIGHT;
        localPlayer.velocityY = 0;
        localPlayer.onGround = true;
    } else {
        localPlayer.onGround = false;
    }

    localPlayer.position.y = nextY;

    if (shakeIntensity > 0) {
        shakeIntensity -= SHAKE_DECAY * dt;
        if (shakeIntensity < 0) shakeIntensity = 0;
    }

    const shakeX = (Math.random() - 0.5) * SHAKE_STRENGTH * shakeIntensity;
    const shakeY = (Math.random() - 0.5) * SHAKE_STRENGTH * shakeIntensity;
    const shakeZ = (Math.random() - 0.5) * SHAKE_STRENGTH * shakeIntensity;

    const shakePitch = (Math.random() - 0.5) * 0.1 * shakeIntensity;
    const shakeYaw = (Math.random() - 0.5) * 0.1 * shakeIntensity;

    const targetEyeOffset = isSliding ? (SLIDE_HEIGHT - PLAYER_HEIGHT) : 0;
    if (localPlayer._eyeOffset === undefined) localPlayer._eyeOffset = 0;
    localPlayer._eyeOffset += (targetEyeOffset - localPlayer._eyeOffset) * Math.min(1, dt * 18);

    camera.position.copy(localPlayer.position);
    camera.position.x += shakeX;
    camera.position.y += shakeY + localPlayer._eyeOffset;
    camera.position.z += shakeZ;

    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw + shakeYaw;
    camera.rotation.x = pitch + shakePitch;
}

function updateSlideButtonState() {
    if (!isMobile || !mobileUI) return;
    const btn = document.getElementById('m-btn-slide');
    if (!btn) return;
    if (slideCooldownTimer > 0 || isSliding) btn.classList.add('disabled');
    else btn.classList.remove('disabled');
}

export function getYaw() { return yaw; }
export function getPitch() { return pitch; }
export function getLocalPlayer() { return localPlayer; }

export function onServerJoined(serverId) {
    console.log("[game] server assigned id:", serverId);
}

export function onHitConfirmed(targetId, dmg, isKill) {
}

export function onLocalHealth(newHealth) {
    import('./main.js').then(m => {
        m.hud?.setHealth(newHealth);
        m.hud?.flashDamage();
    });
}

export function onLocalDeath() {
    if (!localPlayer) return;
    localPlayer.alive = false;
    isReloading = false;
    import('./renderer.js').then(m => m.setReloadState?.(false, 0));

    if (document.pointerLockElement) {
        document.exitPointerLock();
    }

    import('./main.js').then(m => {
        m.hud?.showDeathOverlay(5);
        m.hud?.hideReloading?.();
        m.soundManager?.play('death', 0.8, 1.0);
    });
}

export function onLocalRespawn(x, y, z) {
    if (!localPlayer) return;
    localPlayer.position.set(x, y, z);
    localPlayer.velocityY = 0;
    localPlayer.onGround = false;
    localPlayer.alive = true;

    weaponState = {
        ak47: { ammo: WEAPONS.ak47.maxAmmo, reserve: WEAPONS.ak47.maxReserve },
        pistol: { ammo: WEAPONS.pistol.maxAmmo, reserve: WEAPONS.pistol.maxReserve },
        knife: { ammo: Infinity, reserve: Infinity },
    };
    currentWeaponKey = 'ak47';
    isReloading = false;

    import('./renderer.js').then(m => {
        m.setReloadState?.(false, 0);
        m.setViewWeapon?.('ak47');
    });

    const cam = getCamera();
    cam.position.copy(localPlayer.position);

    import('./main.js').then(m => {
        m.hud?.hideDeathOverlay();
        m.hud?.setHealth(100);
        m.hud?.setAmmo(WEAPONS.ak47.maxAmmo, WEAPONS.ak47.maxAmmo, WEAPONS.ak47.maxReserve);
        m.hud?.setWeaponName?.('AK-47');
        m.hud?.highlightSlot?.(1);
        m.hud?.hideReloading?.();
    });
}