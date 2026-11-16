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
let powerups = [];
let localPlayer = null;

// ── 常數 ──────────────────────────────────────────────
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 30;
const JUMP_FORCE = 11;
const MOVE_SPEED = 12;
const STEP_HEIGHT = 0.6;

// 滑行相關
const SLIDE_SPEED = 22;          // 滑行時的速度
const SLIDE_DURATION = 0.55;     // 滑行持續秒數
const SLIDE_COOLDOWN = 1.2;      // 滑行冷卻秒數
const SLIDE_HEIGHT = 0.9;        // 滑行時視角高度
let slideTimer = 0;              // 剩餘滑行時間
let slideCooldownTimer = 0;      // 剩餘冷卻時間
let isSliding = false;
const slideDir = new THREE.Vector3(); // 滑行方向（固定）

let lastShootTime = 0;
const FIRE_RATE = 150;
const GUN_RANGE = 100;

let shakeIntensity = 0;
const SHAKE_DECAY = 15;
const SHAKE_STRENGTH = 0.5;

const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

// ── 裝置偵測 ──────────────────────────────────────────
const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
let isMobile = isTouchDevice;

// ── 手機控制狀態 ──────────────────────────────────────
const mobileState = {
    moveX: 0,          // 搖桿 X (-1~1)
    moveY: 0,          // 搖桿 Y (-1~1)
    jumping: false,
    shooting: false,
    sliding: false,
    lookTouchId: null, // 用於拖曳視角的觸控 ID
    lastLookX: 0,
    lastLookY: 0,
    joystickTouchId: null,
    joystickCenterX: 0,
    joystickCenterY: 0,
};

let mobileUI = null; // 手機 UI 的 DOM 容器

// ── 初始化輸入 ────────────────────────────────────────
export function initInput(canvas) {
    // 桌機：點擊鎖定滑鼠
    canvas.addEventListener('click', () => {
        if (!isMobile) canvas.requestPointerLock();
    });

    // 桌機：滑鼠視角
    document.addEventListener('mousemove', (e) => {
        if (isMobile) return;
        if (document.pointerLockElement !== canvas) return;
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    });

    // 鍵盤
    addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'KeyH') toggleHitboxes(colliders);
        if (e.code === 'KeyC') tryStartSlide();
    });
    addEventListener('keyup', (e) => keys[e.code] = false);

    // 桌機滑鼠射擊
    addEventListener('mousedown', (e) => {
        if (isMobile) return;
        if (document.pointerLockElement === canvas && e.button === 0) {
            shoot();
        }
    });

    // 視窗大小變化 → 更新 FOV
    addEventListener('resize', () => updateResponsiveFOV());

    // 手機 UI
    if (isMobile) {
        buildMobileUI(canvas);
    }
}

// ── 響應式 FOV ────────────────────────────────────────
function updateResponsiveFOV() {
    const camera = getCamera();
    if (!camera) return;
    const aspect = window.innerWidth / window.innerHeight;
    // 寬螢幕（桌機）用較大 FOV；窄螢幕（手機直立）縮小避免變形
    let baseFov = 75;
    if (aspect < 0.8) {
        baseFov = 85; // 直立手機需要更廣視野
    } else if (aspect < 1.2) {
        baseFov = 80;
    }
    // 螢幕較小時略微調整
    if (isMobile && window.innerHeight < 500) {
        baseFov += 5;
    }
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
}

// ── 建立手機 UI ───────────────────────────────────────
function buildMobileUI(canvas) {
    if (mobileUI) return;

    // 注入 CSS
    const style = document.createElement('style');
    style.textContent = `
        #mobile-ui {
            position: fixed; inset: 0; pointer-events: none;
            z-index: 1000; touch-action: none;
            font-family: system-ui, sans-serif;
            user-select: none; -webkit-user-select: none;
        }
        #mobile-ui .m-btn {
            position: absolute; pointer-events: auto;
            display: flex; align-items: center; justify-content: center;
            border-radius: 50%;
            background: rgba(255,255,255,0.12);
            border: 2px solid rgba(255,255,255,0.35);
            color: #fff; font-weight: 700;
            backdrop-filter: blur(4px);
            -webkit-tap-highlight-color: transparent;
            transition: background 0.08s, transform 0.08s;
        }
        #mobile-ui .m-btn.active {
            background: rgba(255,255,255,0.35);
            transform: scale(0.94);
        }
        #mobile-ui .m-btn.disabled {
            opacity: 0.35;
        }
        /* 搖桿底座 */
        #m-joystick-base {
            position: absolute; pointer-events: auto;
            width: 130px; height: 130px; border-radius: 50%;
            background: rgba(255,255,255,0.08);
            border: 2px solid rgba(255,255,255,0.25);
            left: 24px; bottom: 28px;
            touch-action: none;
        }
        #m-joystick-knob {
            position: absolute; width: 60px; height: 60px; border-radius: 50%;
            background: rgba(255,255,255,0.35);
            border: 2px solid rgba(255,255,255,0.6);
            left: 50%; top: 50%; transform: translate(-50%,-50%);
            pointer-events: none;
        }
        /* 射擊按鈕 */
        #m-btn-shoot {
            right: 24px; bottom: 100px;
            width: 84px; height: 84px; font-size: 26px;
        }
        /* 跳躍按鈕 */
        #m-btn-jump {
            right: 120px; bottom: 40px;
            width: 64px; height: 64px; font-size: 20px;
        }
        /* 滑行按鈕 */
        #m-btn-slide {
            right: 32px; bottom: 200px;
            width: 64px; height: 64px; font-size: 20px;
        }
    `;
    document.head.appendChild(style);

    // 建立 DOM
    mobileUI = document.createElement('div');
    mobileUI.id = 'mobile-ui';

    // 搖桿
    const joyBase = document.createElement('div');
    joyBase.id = 'm-joystick-base';
    const joyKnob = document.createElement('div');
    joyKnob.id = 'm-joystick-knob';
    joyBase.appendChild(joyKnob);
    mobileUI.appendChild(joyBase);

    // 射擊
    const shootBtn = document.createElement('div');
    shootBtn.id = 'm-btn-shoot';
    shootBtn.className = 'm-btn';
    shootBtn.textContent = '🔫';
    mobileUI.appendChild(shootBtn);

    // 跳躍
    const jumpBtn = document.createElement('div');
    jumpBtn.id = 'm-btn-jump';
    jumpBtn.className = 'm-btn';
    jumpBtn.textContent = '⤒';
    mobileUI.appendChild(jumpBtn);

    // 滑行
    const slideBtn = document.createElement('div');
    slideBtn.id = 'm-btn-slide';
    slideBtn.className = 'm-btn';
    slideBtn.textContent = '➠';
    mobileUI.appendChild(slideBtn);

    document.body.appendChild(mobileUI);

    // ── 搖桿事件 ──
    const joyRadius = 65;
    joyBase.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const t = e.changedTouches[0];
        mobileState.joystickTouchId = t.identifier;
        const rect = joyBase.getBoundingClientRect();
        mobileState.joystickCenterX = rect.left + rect.width / 2;
        mobileState.joystickCenterY = rect.top + rect.height / 2;
        updateJoystick(t.clientX, t.clientY, joyKnob, joyRadius);
    }, { passive: false });

    joyBase.addEventListener('touchmove', (e) => {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier === mobileState.joystickTouchId) {
                updateJoystick(t.clientX, t.clientY, joyKnob, joyRadius);
            }
        }
    }, { passive: false });

    const endJoy = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier === mobileState.joystickTouchId) {
                mobileState.joystickTouchId = null;
                mobileState.moveX = 0;
                mobileState.moveY = 0;
                joyKnob.style.left = '50%';
                joyKnob.style.top = '50%';
            }
        }
    };
    joyBase.addEventListener('touchend', endJoy);
    joyBase.addEventListener('touchcancel', endJoy);

    // ── 射擊按鈕（長按連射） ──
    let shootInterval = null;
    shootBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        shootBtn.classList.add('active');
        mobileState.shooting = true;
        shoot();
        shootInterval = setInterval(() => {
            if (mobileState.shooting) shoot();
        }, FIRE_RATE);
    }, { passive: false });
    const endShoot = (e) => {
        e && e.preventDefault && e.preventDefault();
        shootBtn.classList.remove('active');
        mobileState.shooting = false;
        if (shootInterval) { clearInterval(shootInterval); shootInterval = null; }
    };
    shootBtn.addEventListener('touchend', endShoot);
    shootBtn.addEventListener('touchcancel', endShoot);

    // ── 跳躍按鈕 ──
    jumpBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        jumpBtn.classList.add('active');
        mobileState.jumping = true;
    }, { passive: false });
    const endJump = (e) => {
        e && e.preventDefault && e.preventDefault();
        jumpBtn.classList.remove('active');
        mobileState.jumping = false;
    };
    jumpBtn.addEventListener('touchend', endJump);
    jumpBtn.addEventListener('touchcancel', endJump);

    // ── 滑行按鈕 ──
    slideBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (slideCooldownTimer > 0) return;
        slideBtn.classList.add('active');
        tryStartSlide();
    }, { passive: false });
    slideBtn.addEventListener('touchend', (e) => {
        e.preventDefault();
        slideBtn.classList.remove('active');
    });
    slideBtn.addEventListener('touchcancel', (e) => {
        slideBtn.classList.remove('active');
    });

    // ── 畫布拖曳轉視角 ──
    const lookArea = canvas;
    lookArea.addEventListener('touchstart', (e) => {
        // 只處理落在畫布上、不在 UI 上的觸控
        for (const t of e.changedTouches) {
            if (mobileState.lookTouchId === null && !isTouchOnUI(t)) {
                mobileState.lookTouchId = t.identifier;
                mobileState.lastLookX = t.clientX;
                mobileState.lastLookY = t.clientY;
                break;
            }
        }
    }, { passive: true });

    lookArea.addEventListener('touchmove', (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier === mobileState.lookTouchId) {
                const dx = t.clientX - mobileState.lastLookX;
                const dy = t.clientY - mobileState.lastLookY;
                mobileState.lastLookX = t.clientX;
                mobileState.lastLookY = t.clientY;
                const sens = 0.0045;
                yaw -= dx * sens;
                pitch -= dy * sens;
                pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
            }
        }
    }, { passive: true });

    const endLook = (e) => {
        for (const t of e.changedTouches) {
            if (t.identifier === mobileState.lookTouchId) {
                mobileState.lookTouchId = null;
            }
        }
    };
    lookArea.addEventListener('touchend', endLook);
    lookArea.addEventListener('touchcancel', endLook);

    // 更新 FOV
    updateResponsiveFOV();
}

// 判斷觸控是否落在 UI 元素上（避免 UI 誤觸轉視角）
function isTouchOnUI(touch) {
    if (!mobileUI) return false;
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!el) return false;
    return el.closest('#mobile-ui') !== null;
}

// 更新搖桿
function updateJoystick(clientX, clientY, knob, radius) {
    let dx = clientX - mobileState.joystickCenterX;
    let dy = clientY - mobileState.joystickCenterY;
    const dist = Math.hypot(dx, dy);
    if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
    }
    mobileState.moveX = dx / radius; // -1~1
    mobileState.moveY = dy / radius; // -1~1（下為正）
    knob.style.left = `calc(50% + ${dx}px)`;
    knob.style.top = `calc(50% + ${dy}px)`;
}

// ── 滑行邏輯 ──────────────────────────────────────────
function tryStartSlide() {
    if (!localPlayer || !localPlayer.alive) return;
    if (slideCooldownTimer > 0) return;
    if (isSliding) return;

    isSliding = true;
    slideTimer = SLIDE_DURATION;
    slideCooldownTimer = SLIDE_COOLDOWN;

    // 決定滑行方向：若有移動輸入，沿輸入方向；否則沿面向方向
    const dir = getMoveInputDirection();
    if (dir.lengthSq() > 0.0001) {
        slideDir.copy(dir).normalize();
    } else {
        slideDir.set(-Math.sin(yaw), 0, -Math.cos(yaw)).normalize();
    }
}

// 取得目前輸入的移動方向（世界座標，Y=0）
function getMoveInputDirection() {
    const out = new THREE.Vector3(0, 0, 0);
    let ix = 0, iz = 0;

    if (isMobile) {
        ix = mobileState.moveX;
        iz = mobileState.moveY;
        // 只有超過死區才有效
        if (Math.hypot(ix, iz) < 0.15) return out;
    } else {
        if (keys['KeyW']) iz -= 1;
        if (keys['KeyS']) iz += 1;
        if (keys['KeyA']) ix -= 1;
        if (keys['KeyD']) ix += 1;
        if (ix === 0 && iz === 0) return out;
    }

    // 相機相對方向
    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    // 注意：iz 為正代表「往下/往後」，所以 forward 要乘 -iz
    out.x = forward.x * -iz + right.x * ix;
    out.z = forward.z * -iz + right.z * ix;
    return out;
}

// ── 射擊 ──────────────────────────────────────────────
function shoot() {
    const now = performance.now();
    if (now - lastShootTime < FIRE_RATE) return;
    lastShootTime = now;
    shakeIntensity = 0.5;

    const randomPitch = 0.95 + Math.random() * 0.1;
    soundManager.play('shoot', 0.8, randomPitch);

    const camera = getCamera();
    const shootRaycaster = new THREE.Raycaster();
    shootRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    shootRaycaster.far = GUN_RANGE;

    const hitsMap = shootRaycaster.intersectObjects(collidableMeshes, false);
    const hitsRemote = shootRaycaster.intersectObjects(getRemotePlayerMeshes(), true);

    const wallDist = hitsMap.length ? hitsMap[0].distance : Infinity;
    const remDist = hitsRemote.length ? hitsRemote[0].distance : Infinity;

    // Always replicate the shot so other clients see the tracer
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const gunOffset = new THREE.Vector3(0.2, -0.2, -0.5).applyMatrix4(camera.matrixWorld);
    syncManager?.sendShoot(gunOffset, dir);

    // Priority: remote player if closer than wall
    if (remDist < wallDist) {
        const remoteId = findRemoteIdByObject(hitsRemote[0].object);
        if (remoteId) {
            const dmg = 25;
            syncManager?.sendHit(remoteId, dmg, hitsRemote[0].point);
            import('./main.js').then(m => m.hud?.showHitmarker());
            spawnBulletTracer(gunOffset, hitsRemote[0].point, null, true, null);
            return;
        }
    }

    // Wall / miss
    let hitPoint, hitNormal = null, isHit = false;
    if (hitsMap.length > 0) {
        hitPoint = hitsMap[0].point;
        hitNormal = hitsMap[0].face.normal.clone().transformDirection(hitsMap[0].object.matrixWorld);
        isHit = true;
    } else {
        hitPoint = shootRaycaster.ray.at(GUN_RANGE, new THREE.Vector3());
    }
    spawnBulletTracer(gunOffset, hitPoint, hitNormal, isHit, hitPoint);
}

// ── OBB 建構 ─────────────────────────────────────────
function buildOBB(mesh) {
    const m = mesh.userData.originalData;
    const isPlane = m.type === 'plane';

    let sx = 1, sy = 1, sz = 1;
    if (Array.isArray(m.size)) {
        sx = isPlane ? m.size[0] : m.size[0];
        sy = isPlane ? 0.1 : m.size[1];
        sz = isPlane ? m.size[1] : m.size[2];
    }

    const isSlope = Math.abs(mesh.rotation.x) > 0.01 || Math.abs(mesh.rotation.z) > 0.01;

    return {
        isSlope: isSlope,
        position: new THREE.Vector3(mesh.position.x, mesh.position.y, mesh.position.z),
        halfSize: new THREE.Vector3(sx / 2, sy / 2, sz / 2),
        rotation: mesh.rotation.clone()
    };
}

// ── 初始化遊戲 ────────────────────────────────────────
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

    localPlayer = { position: spawnPos, velocityY: 0, onGround: false, alive: true };

    // 重置滑行狀態
    isSliding = false;
    slideTimer = 0;
    slideCooldownTimer = 0;

    updateResponsiveFOV();
}

// ── 碰撞穿透計算 ──────────────────────────────────────
function getPenetration(x, z, obb, buffer = PLAYER_RADIUS) {
    const dx = x - obb.position.x;
    const dz = z - obb.position.z;
    const cos = Math.cos(-obb.rotation.y);
    const sin = Math.sin(-obb.rotation.y);

    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;

    const extentX = obb.halfSize.x + buffer;
    const extentZ = obb.halfSize.z + buffer;

    if (Math.abs(localX) < extentX && Math.abs(localZ) < extentZ) {
        const overlapX = extentX - Math.abs(localX);
        const overlapZ = extentZ - Math.abs(localZ);

        if (overlapX < overlapZ) {
            const pushDir = Math.sign(localX) || 1;
            return { pushX: Math.cos(obb.rotation.y) * overlapX * pushDir, pushZ: Math.sin(obb.rotation.y) * overlapX * pushDir };
        } else {
            const pushDir = Math.sign(localZ) || 1;
            return { pushX: -Math.sin(obb.rotation.y) * overlapZ * pushDir, pushZ: Math.cos(obb.rotation.y) * overlapZ * pushDir };
        }
    }
    return null;
}

function resolveCollisions(x, y, z, buffer = PLAYER_RADIUS) {
    let finalX = x;
    let finalZ = z;
    let steppedUp = false;

    for (let i = 0; i < 2; i++) {
        for (const c of colliders) {
            if (c.isSlope) continue;

            const feetY = y;
            const headY = y + PLAYER_HEIGHT;
            if (headY > c.position.y - c.halfSize.y && feetY < c.position.y + c.halfSize.y) {

                const push = getPenetration(finalX, finalZ, c, buffer);
                if (push) {
                    const topOfBox = c.position.y + c.halfSize.y;

                    if (topOfBox <= feetY + STEP_HEIGHT) {
                        y = topOfBox + 0.01;
                        steppedUp = true;
                    } else {
                        finalX += push.pushX;
                        finalZ += push.pushZ;
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

// ── 更新遊戲主迴圈 ────────────────────────────────────
export function updateGame() {
    if (!localPlayer) return;

    const camera = getCamera();
    const dt = Math.min(getClock().getDelta(), 0.1);

    // 更新滑行計時器
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

    // 更新滑行按鈕的可用狀態
    updateSlideButtonState();

    // 取得移動輸入（鍵盤或搖桿）
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
        // 滑行中：沿固定方向移動（不受輸入影響）
        moveX = slideDir.x * speed * dt;
        moveZ = slideDir.z * speed * dt;
    } else {
        // 注意：inputZ 為正代表「往後」，forward 要乘 -inputZ
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

    // 垂直移動
    const groundY = getGroundHeight(localPlayer.position.x, localPlayer.position.z, localPlayer.position.y);

    const jumpPressed = isMobile ? mobileState.jumping : keys['Space'];
    if (jumpPressed && localPlayer.onGround && !isSliding) {
        localPlayer.velocityY = JUMP_FORCE;
        localPlayer.onGround = false;
    }

    localPlayer.velocityY -= GRAVITY * dt;
    let nextY = localPlayer.position.y + (localPlayer.velocityY * dt);

    // 天花板碰撞
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

    // 地面 & 斜面
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

    // ── 滑行時降低視角高度（平滑插值） ──
    const targetEyeOffset = isSliding ? (SLIDE_HEIGHT - PLAYER_HEIGHT) : 0;
    // 用一個簡單的平滑追蹤
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

// 更新滑行按鈕可用狀態（手機）
function updateSlideButtonState() {
    if (!isMobile || !mobileUI) return;
    const btn = document.getElementById('m-btn-slide');
    if (!btn) return;
    if (slideCooldownTimer > 0 || isSliding) {
        btn.classList.add('disabled');
    } else {
        btn.classList.remove('disabled');
    }
}

// ── 對外介面 ─────────────────────────────────────────
export function getYaw() { return yaw; }
export function getPitch() { return pitch; }
export function getLocalPlayer() { return localPlayer; }

export function onServerJoined(serverId) {
    console.log("[game] server assigned id:", serverId);
}

export function onHitConfirmed(targetId, dmg, isKill) {
    // Hitmarker already shown optimistically in shoot()
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
    isSliding = false;
    slideTimer = 0;
    document.exitPointerLock();
    import('./main.js').then(m => {
        m.hud?.showDeathOverlay(5);
        m.soundManager?.play('death', 0.8, 1.0);
    });
}

export function onLocalRespawn(x, y, z) {
    if (!localPlayer) return;
    localPlayer.position.set(x, y, z);
    localPlayer.velocityY = 0;
    localPlayer.onGround = false;
    localPlayer.alive = true;
    localPlayer._eyeOffset = 0;

    isSliding = false;
    slideTimer = 0;
    slideCooldownTimer = 0;

    const cam = getCamera();
    cam.position.copy(localPlayer.position);

    import('./main.js').then(m => {
        m.hud?.hideDeathOverlay();
        m.hud?.setHealth(100);
    });
}
