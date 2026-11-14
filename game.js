import * as THREE from 'three';
import {
    getCamera, getClock, toggleHitboxes, getLoadedMeshes,
    spawnBulletTracer, spawnNPCMesh, removeNPCMesh, flashNPC, npcMeshes
} from './renderer.js';
import { soundManager } from './main.js';

const keys = {};
const direction = new THREE.Vector3();
let yaw = 0, pitch = 0;

let colliders = [];
let collidableMeshes = [];
let spawnPoints = [];
let powerups = [];
let localPlayer = null;

const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.4;
const GRAVITY = 30;
const JUMP_FORCE = 11;
const MOVE_SPEED = 12;
const STEP_HEIGHT = 0.6;

let lastShootTime = 0;
const FIRE_RATE = 150;
const GUN_RANGE = 100;

let shakeIntensity = 0;
const SHAKE_DECAY = 15;
const SHAKE_STRENGTH = 0.5;

let npcs = [];
const NPC_SPEED = 3;
const NPC_HEALTH = 100;

const raycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);

export function initInput(canvas) {
    canvas.addEventListener('click', () => canvas.requestPointerLock());
    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== canvas) return;
        yaw -= e.movementX * 0.002;
        pitch -= e.movementY * 0.002;
        pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch));
    });
    addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'KeyH') toggleHitboxes(colliders);
    });
    addEventListener('keyup', (e) => keys[e.code] = false);

    addEventListener('mousedown', (e) => {
        if (document.pointerLockElement === canvas && e.button === 0) {
            shoot();
        }
    });
}

function shoot() {
    const now = performance.now();
    if (now - lastShootTime < FIRE_RATE) return; // Fire rate cooldown
    lastShootTime = now;

    shakeIntensity = 0.5;

    const randomPitch = 0.95 + Math.random() * 0.1;
    soundManager.play('shoot', 0.8, randomPitch);

    const camera = getCamera();

    // 1. Setup Raycaster from the center of the screen
    const shootRaycaster = new THREE.Raycaster();
    shootRaycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    shootRaycaster.far = GUN_RANGE;

    const hitsMap = shootRaycaster.intersectObjects(collidableMeshes, false);

    const hitsNPC = shootRaycaster.intersectObjects(npcMeshes, true);

    let hitPoint = null;
    let hitNormal = null;
    let isHit = false;

    if (hitsMap.length > 0) {
        hitPoint = hitsMap[0].point;
        // Get the normal (the angle the wall is facing) for the bullet hole
        hitNormal = hitsMap[0].face.normal.clone();

        // Transform the normal from local box space to world space
        hitNormal.transformDirection(hitsMap[0].object.matrixWorld);
        isHit = true;
    } else {
        hitPoint = shootRaycaster.ray.at(GUN_RANGE, new THREE.Vector3());
    }

    if (hitsNPC.length > 0) {
        const npcHit = hitsNPC[0];
        const distanceToWall = hitsMap.length > 0 ? hitsMap[0].distance : Infinity;

        if (npcHit.distance < distanceToWall) {
            // Find the root group of the NPC
            let npcGroup = npcHit.object;
            while (npcGroup.parent && npcGroup.userData.type !== 'npc') {
                npcGroup = npcGroup.parent;
            }

            if (npcGroup.userData.type === 'npc' && !npcGroup.userData.isDead) {
                // Damage the NPC
                const npcData = npcs.find(n => n.id === npcGroup.userData.id);
                if (npcData) {
                    npcData.health -= 34; // 3 shots to kill
                    flashNPC(npcData.id);

                    if (npcData.health <= 0) {
                        npcGroup.userData.isDead = true;
                        npcData.timer = 3; // Respawn timer

                        // Hide the mesh and disable collision
                        npcGroup.visible = false;
                    }
                }
            }

            const startPoint = camera.position.clone().add(
                camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.5)
            );
            spawnBulletTracer(startPoint, npcHit.point, null, true, null);
            return; // Stop here, don't register wall hit
        }
    }

    const startPoint = camera.position.clone().add(
        camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(0.5)
    );

    // Adjust start point to match the gun barrel position visually
    const gunOffset = new THREE.Vector3(0.2, -0.2, -0.5).applyMatrix4(camera.matrixWorld);
    startPoint.copy(gunOffset);

    spawnBulletTracer(startPoint, hitPoint, hitNormal, isHit, hitPoint);
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

    const isSlope = Math.abs(mesh.rotation.x) > 0.01 || Math.abs(mesh.rotation.z) > 0.01;

    return {
        isSlope: isSlope,
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

    localPlayer = { position: spawnPos, velocityY: 0, onGround: false };

    for (let i = 0; i < 5; i++) {
        const id = "npc_" + i;
        // Spawn them in a circle around the center
        const x = (Math.random() - 0.5) * 20;
        const z = (Math.random() - 0.5) * 20;
        const startY = getGroundHeight(x, z, 10) + 1.7; // Find floor height

        spawnNPCMesh(id, [x, startY - 1.7, z]); // Offset so feet are on ground
        npcs.push({
            id: id,
            position: new THREE.Vector3(x, startY - 1.7, z),
            health: NPC_HEALTH,
            targetDir: new THREE.Vector3(1, 0, 0),
            timer: 0
        });
    }
}

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

            // Check if we intersect this box on the Y axis
            const feetY = y; // y passed in is feet level
            const headY = y + PLAYER_HEIGHT;
            if (headY > c.position.y - c.halfSize.y && feetY < c.position.y + c.halfSize.y) {

                const push = getPenetration(finalX, finalZ, c, buffer);
                if (push) {
                    const topOfBox = c.position.y + c.halfSize.y;

                    // --- AUTO STEP LOGIC ---
                    // If the top of the box is low enough to step on, snap up!
                    if (topOfBox <= feetY + STEP_HEIGHT) {
                        // We can step up, so we don't push back horizontally
                        y = topOfBox + 0.01;
                        steppedUp = true;
                    } else {
                        // Too high to step, push back (Wall Collision)
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

    // Raycast for slopes
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

    const camera = getCamera();
    const dt = Math.min(getClock().getDelta(), 0.1);

    direction.set(0, 0, 0);
    if (keys['KeyW']) direction.z -= 1;
    if (keys['KeyS']) direction.z += 1;
    if (keys['KeyA']) direction.x -= 1;
    if (keys['KeyD']) direction.x += 1;
    direction.normalize();

    const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    let moveX = (forward.x * -direction.z + right.x * direction.x) * MOVE_SPEED * dt;
    let moveZ = (forward.z * -direction.z + right.z * direction.x) * MOVE_SPEED * dt;

    let nextX = localPlayer.position.x + moveX;
    let nextZ = localPlayer.position.z + moveZ;
    let feetY = localPlayer.position.y - PLAYER_HEIGHT;

    // Resolve X/Z collisions & Auto-Step
    const resolved = resolveCollisions(nextX, feetY, nextZ);
    nextX = resolved.x;
    nextZ = resolved.z;
    feetY = resolved.y; // Update feetY if we stepped up!

    localPlayer.position.x = nextX;
    localPlayer.position.z = nextZ;

    // If we stepped up, update the player's Y position immediately
    if (resolved.stepped) {
        localPlayer.position.y = feetY + PLAYER_HEIGHT;
        localPlayer.onGround = true;
        localPlayer.velocityY = 0;
    }

    // Vertical movement
    const groundY = getGroundHeight(localPlayer.position.x, localPlayer.position.z, localPlayer.position.y);

    if (keys['Space'] && localPlayer.onGround) {
        localPlayer.velocityY = JUMP_FORCE;
        localPlayer.onGround = false;
    }

    localPlayer.velocityY -= GRAVITY * dt;
    let nextY = localPlayer.position.y + (localPlayer.velocityY * dt);

    // Ceiling Collision
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

    // Ground & Slopes
    if (nextY - PLAYER_HEIGHT <= groundY) {
        nextY = groundY + PLAYER_HEIGHT;
        localPlayer.velocityY = 0;
        localPlayer.onGround = true;
    } else {
        localPlayer.onGround = false;
    }

    localPlayer.position.y = nextY;

    for (const npc of npcs) {
        const mesh = npcMeshes.find(m => m.userData.id === npc.id);
        if (!mesh) continue;

        if (mesh.userData.isDead) {
            // Handle Respawn
            npc.timer -= dt;
            if (npc.timer <= 0) {
                npc.health = NPC_HEALTH;
                mesh.userData.isDead = false;
                mesh.visible = true;
                // Move to a new random spot
                npc.position.x = (Math.random() - 0.5) * 20;
                npc.position.z = (Math.random() - 0.5) * 20;
            }
            continue;
        }

        // Simple wander AI
        npc.timer -= dt;
        if (npc.timer <= 0) {
            // Pick a new random direction every 2 seconds
            npc.targetDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
            npc.timer = 2.0;
        }

        // Move NPC
        npc.position.x += npc.targetDir.x * NPC_SPEED * dt;
        npc.position.z += npc.targetDir.z * NPC_SPEED * dt;

        // Keep them inside a 40x40 area
        if (Math.abs(npc.position.x) > 20) npc.targetDir.x *= -1;
        if (Math.abs(npc.position.z) > 20) npc.targetDir.z *= -1;

        // Snap to floor height
        const floorY = getGroundHeight(npc.position.x, npc.position.z, npc.position.y + 2);
        npc.position.y = floorY;

        // Update Mesh
        mesh.position.copy(npc.position);
        
        // Rotate to face movement direction
        if (npc.targetDir.lengthSq() > 0) {
            const angle = Math.atan2(npc.targetDir.x, npc.targetDir.z);
            mesh.rotation.y = angle;
        }
    }

    if (shakeIntensity > 0) {
        shakeIntensity -= SHAKE_DECAY * dt;
        if (shakeIntensity < 0) shakeIntensity = 0;
    }

    // Calculate random offset for position (X, Y, Z) and rotation (X, Y)
    const shakeX = (Math.random() - 0.5) * SHAKE_STRENGTH * shakeIntensity;
    const shakeY = (Math.random() - 0.5) * SHAKE_STRENGTH * shakeIntensity;
    const shakeZ = (Math.random() - 0.5) * SHAKE_STRENGTH * shakeIntensity;

    const shakePitch = (Math.random() - 0.5) * 0.1 * shakeIntensity;
    const shakeYaw = (Math.random() - 0.5) * 0.1 * shakeIntensity;

    // Apply position + shake
    camera.position.copy(localPlayer.position);
    camera.position.x += shakeX;
    camera.position.y += shakeY;
    camera.position.z += shakeZ;

    // Apply rotation + shake
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw + shakeYaw;
    camera.rotation.x = pitch + shakePitch;
}

export function getYaw() { return yaw; }
export function getPitch() { return pitch; }
export function getLocalPlayer() { return localPlayer; }