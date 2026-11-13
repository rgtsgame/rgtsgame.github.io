import * as THREE from 'three';
import { getCamera, getClock, toggleHitboxes, getLoadedMeshes } from './renderer.js';

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
const STEP_HEIGHT = 0.6; // THIS IS NOW ACTIVE!

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

    camera.position.copy(localPlayer.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = yaw;
    camera.rotation.x = pitch;
}

export function getYaw() { return yaw; }
export function getPitch() { return pitch; }
export function getLocalPlayer() { return localPlayer; }