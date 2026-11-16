// characterPreview.js
import * as THREE from 'three';

let previewRenderer, previewScene, previewCamera;
let characterGroup;
let animId = null;
let clock;

export function initCharacterPreview(canvasId = 'character-preview') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.warn('[preview] canvas not found');
        return;
    }

    const w = canvas.clientWidth  || 320;
    const h = canvas.clientHeight || 420;

    // --- Renderer ---
    previewRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,               // transparent background — menu shows through
    });
    previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    previewRenderer.setSize(w, h, false);
    previewRenderer.shadowMap.enabled = true;
    previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // --- Scene ---
    previewScene = new THREE.Scene();
    // No background color — transparent

    // --- Camera ---
    previewCamera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
    previewCamera.position.set(0, 1.6, 4.2);
    previewCamera.lookAt(0, 1.2, 0);

    // --- Lights ---
    const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.9);
    previewScene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(3, 5, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width  = 512;
    keyLight.shadow.mapSize.height = 512;
    previewScene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xed8e18, 1.2);   // accent color
    rimLight.position.set(-3, 2, -2);
    previewScene.add(rimLight);

    // --- Character ---
    characterGroup = buildCharacter();
    previewScene.add(characterGroup);

    // --- Resize handling ---
    const onResize = () => {
        const nw = canvas.clientWidth  || 320;
        const nh = canvas.clientHeight || 420;
        previewRenderer.setSize(nw, nh, false);
        previewCamera.aspect = nw / nh;
        previewCamera.updateProjectionMatrix();
    };
    addEventListener('resize', onResize);

    // --- Animate ---
    clock = new THREE.Clock();
    animate();
}

function buildCharacter() {
    // Matches the blocky remote-player style from renderer.js
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.6 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xffccaa, roughness: 0.7 });
    const accentMat = new THREE.MeshStandardMaterial({
        color: 0xed8e18, emissive: 0xed8e18, emissiveIntensity: 0.25,
    });

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

    // Small "weapon" block held in right hand — adds visual interest
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), accentMat);
    gun.position.set(0.55, 0.9, -0.35);
    gun.castShadow = true;
    group.add(gun);

    // Store references for animation
    group.userData = { armL, armR, head };
    return group;
}

function animate() {
    animId = requestAnimationFrame(animate);

    const t = clock.getElapsedTime();

    // Slow idle rotation
    if (characterGroup) {
        characterGroup.rotation.y = t * 0.4;

        // Subtle breathing bob on the body (not the group, so the floor stays put)
        const bob = Math.sin(t * 1.6) * 0.01;
        characterGroup.position.y = bob;

        // Slight head bob, opposite phase
        if (characterGroup.userData.head) {
            characterGroup.userData.head.position.y = 1.8 + Math.sin(t * 1.6 + 0.5) * 0.012;
        }

        // Idle arm sway
        const sway = Math.sin(t * 1.6) * 0.05;
        if (characterGroup.userData.armL) characterGroup.userData.armL.rotation.z =  sway;
        if (characterGroup.userData.armR) characterGroup.userData.armR.rotation.z = -sway;
    }

    previewRenderer.render(previewScene, previewCamera);
}

export function stopCharacterPreview() {
    if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
    }
}

export function disposeCharacterPreview() {
    stopCharacterPreview();
    if (previewScene) {
        previewScene.traverse(obj => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
    }
    if (previewRenderer) {
        previewRenderer.dispose();
        previewRenderer = null;
    }
}