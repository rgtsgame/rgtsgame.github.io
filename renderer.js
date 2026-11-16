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
