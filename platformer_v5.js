// Journey to Hedgeheart 3D
// The same hedgehog, the same safari, but now running straight ahead down a
// three-lane track instead of left to right. Built on three.js (vendored in
// assets/). The characters are the original flat artwork stood up as cards in
// a 3D world, like a pop-up book.
//
// Carried over from platformer_v4.js: score is time left to the meeting date,
// passing an obstacle knocks time off, the game speeds up every few seconds,
// the sunglasses costume, clouds, rainbow, day/night cycle, the cyan heart
// finish and the AI websocket harness.

import * as THREE from './assets/three.module.min.js';

let dateOfMeetingInSeconds = new Date("2024-11-21T22:55:00");
// Once the meeting date has passed there is nothing left to count down to, so
// each run becomes a journey of this fixed length instead.
let fallbackJourneySeconds = 30 * 24 * 60 * 60;

let platformSpeed = 1;
let maxPlatformSpeed = 5;
let platToVelFactor = 6.5;       // world units per second for each unit of platform speed
let gravity = 26;
let jumpVelocity = 9.5;
let gameSpeedUpInterval = 10;    // seconds
let gameSpeedUpFactor = 0.2;     // addition to platform speed each interval
let obstacleMinGap = 2200;       // milliseconds, divided by platform speed
let obstacleMaxGap = 5000;

let laneWidth = 2.2;
let lanes = [-laneWidth, 0, laneWidth];
let spawnDistance = 110;         // how far ahead obstacles appear
let hitDepth = 0.5;              // half-depth of the collision window around the player
let playerYaw = -0.8;            // the side-on hedgehog card is turned to point up the track

let gameState = 'before'; // before / during / after
let winner = false;

let player;
// All inputs (keyboard, buttons, swipes, AI socket) write here; update() reads it.
// left and right are one-shot lane changes that update() consumes.
let inputState = {
    left: false,
    right: false,
    jump: false,
    down: false
};
let obstaclesArray = [];
let blockedLanes = [];           // arrival times of obstacles that cannot be jumped, per lane

let score = journeyLength();
let gameClock = 0;
let highscoreKey = 'j2hh_highscore_3d';
let highscore = parseInt(localStorage.getItem(highscoreKey) || '0');

let shadesEquipped = false;
let shades = null;

let AIControl = false; // set to true to be driven over the websocket
let socket;
let WSreconnectInterval = 3000;
let WSretryCount = 0;
let WSmaxRetries = 5;
let WSSendNow = false;
let startingReward = 0;

// three.js plumbing
let renderer, scene, camera, clock;
let container, hud, scoreboard, messageText, highscoreText, hudButton;
let chips = [];                  // the 3D score chips floating over passed obstacles
let textures = {};
let sounds = {};
let pathTexture, grassTexture, pathMaterial, grassMaterial;
let hemiLight, sunLight, sun, stars;
let scenery = [];
let clouds = [];
let rainbow = null;
let nightAmount = 0;             // 0 = day, 1 = night; eased towards nightTarget
let nightTarget = 0;
let elapsed = 0;                 // seconds since the page loaded
let timers = { second: 1, obstacle: 3, shades: 30, rainbow: 20 };

const dayColour = new THREE.Color(0x87CEEB);
const nightColour = new THREE.Color(0x0a0a2e);
const white = new THREE.Color(0xffffff);
const nightTint = new THREE.Color(0x5560a0);

preload().then(() => {
    create();
    renderer.setAnimationLoop(update);
});

function journeyLength() {
    let secondsToGo = Math.round((dateOfMeetingInSeconds - Date.now()) / 1000);
    return secondsToGo > 0 ? secondsToGo : fallbackJourneySeconds;
}

function preload() {
    const images = {
        hedgehog: 'hedgehog', hedgehogShades: 'hedgehogShades', flamingo: 'flamingo',
        crab: 'crab', cactusL: 'cactus', cactusS: 'cactus', bird: 'bird', cloud: 'cloud',
        eagle: 'eagle', lizard: 'lizard', zebra: 'zebra', unicorn: 'unicorn',
        rainbow: 'rainbow', cyanHeart: 'cyanHeart'
    };
    const loader = new THREE.TextureLoader();
    const jobs = Object.entries(images).map(([key, file]) =>
        loader.loadAsync('assets/' + file + '.png').then((texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = 4;
            textures[key] = texture;
        }));

    ['obstacleHit', 'obstaclePass', 'playerJump', 'playerLR', 'winner'].forEach((name) => {
        sounds[name] = new Audio('assets/sounds/' + name + '.mp3');
    });
    sounds.playerLR.volume = 0.2;

    return Promise.all(jobs);
}

function create() {
    container = document.getElementById('game-container');
    hud = document.getElementById('hud');
    scoreboard = document.getElementById('hud-scoreboard');
    messageText = document.getElementById('hud-message');
    highscoreText = document.getElementById('hud-best');
    hudButton = document.getElementById('hud-button');

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.insertBefore(renderer.domElement, hud);

    scene = new THREE.Scene();
    scene.background = dayColour.clone();
    scene.fog = new THREE.Fog(dayColour.clone(), 60, 210);

    // The camera sits behind and above the hedgehog, looking up the track
    camera = new THREE.PerspectiveCamera(55, 4 / 3, 0.1, 600);
    camera.position.set(0, 3.7, 6.8);
    camera.lookAt(0, 1.1, -7);

    hemiLight = new THREE.HemisphereLight(0xffffff, 0x8a7a4a, 1.6);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(0xfff2cc, 1.8);
    sunLight.position.set(-30, 50, 20);
    scene.add(sunLight);

    createGround();
    createScenery();
    createSky();
    createPlayer();

    setupControls();
    new ResizeObserver(resize).observe(container);
    resize();

    hudButton.addEventListener('click', () => startGame());

    clock = new THREE.Clock();
    if (AIControl) connectWebSocket();
}

function resize() {
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    // Keep all three lanes in view on tall, narrow screens by widening the lens
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(30));
    const fovForLanes = THREE.MathUtils.radToDeg(2 * Math.atan(halfWidth / camera.aspect));
    camera.fov = Math.min(100, Math.max(55, fovForLanes));
    camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- world

function canvasTexture(width, height, draw) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
}

function speckle(ctx, w, h, colours, count, size) {
    for (let i = 0; i < count; i++) {
        ctx.fillStyle = colours[i % colours.length];
        const s = size * (0.5 + Math.random());
        ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
    }
}

function createGround() {
    const length = 420;

    // Savannah on either side of the track
    grassTexture = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#b9c46a';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, ['#a9b85c', '#c9d17c', '#9fae55', '#d3c98a'], 900, 5);
    });
    grassTexture.repeat.set(40, length / 10);
    grassMaterial = new THREE.MeshLambertMaterial({ map: grassTexture });
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, length), grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    grass.position.z = -length / 2 + 20;
    scene.add(grass);

    // The sandy three-lane track
    pathTexture = canvasTexture(256, 256, (ctx, w, h) => {
        ctx.fillStyle = '#e3c78f';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, ['#d8ba80', '#ecd3a2', '#cfae72'], 500, 4);
        ctx.fillStyle = '#c59d5f';
        ctx.fillRect(0, 0, 8, h);
        ctx.fillRect(w - 8, 0, 8, h);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(w / 3 - 3, 0, 6, h / 2);
        ctx.fillRect(2 * w / 3 - 3, 0, 6, h / 2);
    });
    pathTexture.repeat.set(1, length / 8);
    pathMaterial = new THREE.MeshLambertMaterial({ map: pathTexture });
    const path = new THREE.Mesh(new THREE.PlaneGeometry(laneWidth * 3, length), pathMaterial);
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.01, -length / 2 + 20);
    scene.add(path);

    // Distant hills on the horizon
    const hillMaterial = new THREE.MeshLambertMaterial({ color: 0x9aae62, flatShading: true });
    for (let i = 0; i < 9; i++) {
        const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), hillMaterial);
        const size = 25 + Math.random() * 30;
        hill.scale.set(size * 1.6, size * 0.5, size);
        const x = -200 + i * 50 + Math.random() * 20;
        hill.position.set(Math.abs(x) < 35 ? x + 70 : x, -2, -175 - Math.random() * 20);
        scene.add(hill);
    }
}

function createScenery() {
    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x7a5a3a, flatShading: true });
    const leafMaterial = new THREE.MeshLambertMaterial({ color: 0x6f9a3c, flatShading: true });
    const rockMaterial = new THREE.MeshLambertMaterial({ color: 0x9c948a, flatShading: true });
    const tuftMaterial = new THREE.MeshLambertMaterial({ color: 0x8aa548, flatShading: true });
    const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.3, 3, 6);
    const leafGeometry = new THREE.IcosahedronGeometry(1, 1);
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const tuftGeometry = new THREE.ConeGeometry(0.5, 1, 5);

    for (let i = 0; i < 70; i++) {
        let item;
        const kind = i % 5;
        if (kind === 0) {
            // flat-topped acacia tree
            item = new THREE.Group();
            const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
            trunk.position.y = 1.5;
            const canopy = new THREE.Mesh(leafGeometry, leafMaterial);
            canopy.scale.set(2.6, 0.7, 2.6);
            canopy.position.y = 3.3;
            item.add(trunk, canopy);
            item.scale.setScalar(0.9 + Math.random() * 0.8);
        } else if (kind === 1) {
            item = new THREE.Mesh(rockGeometry, rockMaterial);
            const s = 0.4 + Math.random() * 0.9;
            item.scale.set(s * 1.3, s * 0.8, s);
            item.rotation.y = Math.random() * 6;
        } else {
            item = new THREE.Mesh(tuftGeometry, tuftMaterial);
            const s = 0.5 + Math.random() * 0.7;
            item.scale.set(s, s, s);
            item.position.y = s * 0.5;
        }
        placeScenery(item, -Math.random() * 230);
        scene.add(item);
        scenery.push(item);
    }
}

function placeScenery(item, z) {
    const side = Math.random() < 0.5 ? -1 : 1;
    item.position.x = side * (laneWidth * 1.5 + 1.5 + Math.random() * Math.random() * 45);
    item.position.z = z;
}

function createSky() {
    sun = new THREE.Mesh(
        new THREE.CircleGeometry(14, 32),
        new THREE.MeshBasicMaterial({ color: 0xfff3b0, fog: false }));
    sun.position.set(-110, 95, -380);
    scene.add(sun);

    const positions = [];
    for (let i = 0; i < 400; i++) {
        positions.push((Math.random() - 0.5) * 1000, 20 + Math.random() * 320, -450);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
        color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false
    }));
    scene.add(stars);

    for (let i = 0; i < 12; i++) littleFluffyClouds(-60 - Math.random() * 300);
}

// Stand a piece of the flat artwork up in the world, with its feet on the origin
function makeCard(textureName, width, options = {}) {
    const texture = textures[textureName];
    const height = width * texture.image.height / texture.image.width;
    const geometry = new THREE.PlaneGeometry(width, height);
    geometry.translate(0, height / 2, 0);
    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.05,
        side: THREE.DoubleSide,
        fog: options.fog !== false,
        opacity: options.opacity === undefined ? 1 : options.opacity
    });
    const card = new THREE.Mesh(geometry, material);
    card.userData.height = height;
    return card;
}

const shadowGeometry = new THREE.CircleGeometry(0.5, 20);
function makeShadow(width) {
    const shadow = new THREE.Mesh(shadowGeometry, new THREE.MeshBasicMaterial({
        color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false
    }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.set(width, width * 0.55, 1);
    shadow.userData.width = width;
    return shadow;
}

// Shrink and fade a shadow as the thing casting it climbs
function liftShadow(shadow, height) {
    const k = 1 / (1 + height * 0.35);
    shadow.scale.set(shadow.userData.width * k, shadow.userData.width * 0.55 * k, 1);
    shadow.material.opacity = 0.25 * k;
}

function createPlayer() {
    const group = new THREE.Group();
    const model = createHedgehog();
    const shadow = makeShadow(1.3);
    group.add(model);
    scene.add(group, shadow);

    player = {
        group, model, shadow,
        legs: model.userData.legs,
        shades: model.userData.shades,
        materials: model.userData.materials,
        lane: 1,          // 0 left, 1 middle, 2 right
        x: 0, y: 0,
        velocityY: 0,
        halfWidth: 0.4,
        height: 0.85,
        stride: 0,        // where the legs are in their running cycle
        spin: 0
    };
    glowPlayer(null);
}

// The hedgehog, built from simple shapes and facing up the track (towards -z).
// Colours are taken from the original artwork.
function createHedgehog() {
    const materials = [];
    const paint = (colour) => {
        const material = new THREE.MeshLambertMaterial({ color: colour, flatShading: true });
        materials.push(material);
        return material;
    };
    const skin = paint(0xf2b98c);
    const ear = paint(0xd9966c);
    const spines = paint(0x8a5a46);
    const dark = paint(0x2b1d1a);
    const lens = paint(0x2a1b4d);

    const model = new THREE.Group();
    const add = (geometry, material, x, y, z, parent = model) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y, z);
        parent.add(mesh);
        return mesh;
    };
    const ball = new THREE.IcosahedronGeometry(1, 2);

    add(ball, skin, 0, 0.6, 0).scale.set(0.5, 0.4, 0.76);              // body
    add(ball, skin, 0, 0.62, -0.74).scale.setScalar(0.34);              // head
    const snout = add(new THREE.ConeGeometry(0.19, 0.42, 8), skin, 0, 0.55, -1.1);
    snout.rotation.x = -Math.PI / 2;
    add(ball, dark, 0, 0.55, -1.32).scale.setScalar(0.08);             // nose
    [-1, 1].forEach((side) => {
        add(ball, ear, side * 0.29, 0.93, -0.66).scale.set(0.15, 0.16, 0.08);
        add(ball, dark, side * 0.17, 0.74, -1.02).scale.setScalar(0.055); // eyes
    });

    // The coat of spines: a dome over the back with a cone for every spine
    const coatSize = new THREE.Vector3(0.55, 0.42, 0.72);
    const coat = new THREE.Group();
    coat.position.set(0, 0.64, 0.2);
    coat.rotation.x = 0.35; // tipped back, to leave the face clear
    model.add(coat);
    const dome = add(new THREE.SphereGeometry(1, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.5), spines, 0, 0, 0, coat);
    dome.scale.copy(coatSize);

    const spineCount = 70;
    const cones = new THREE.InstancedMesh(new THREE.ConeGeometry(0.065, 0.2, 5), spines, spineCount);
    const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < spineCount; i++) {
        // spread the spines evenly over the dome
        const polar = Math.acos(1 - (i + 0.5) / spineCount * 0.97);
        const around = i * 2.39996;
        const direction = new THREE.Vector3(
            Math.sin(polar) * Math.cos(around), Math.cos(polar), Math.sin(polar) * Math.sin(around));
        const normal = direction.clone().divide(coatSize).normalize();
        const position = direction.multiply(coatSize).addScaledVector(normal, 0.06);
        matrix.compose(position, quaternion.setFromUnitVectors(up, normal), one);
        cones.setMatrixAt(i, matrix);
    }
    coat.add(cones);

    // Four legs, each hinged at the hip so it can swing
    const legGeometry = new THREE.CylinderGeometry(0.11, 0.09, 0.36, 6);
    legGeometry.translate(0, -0.18, 0);
    const legs = [[-1, -0.42], [1, -0.42], [-1, 0.42], [1, 0.42]].map(([side, z]) => {
        const hip = new THREE.Group();
        hip.position.set(side * 0.34, 0.4, z);
        add(legGeometry, skin, 0, 0, 0, hip);
        add(ball, skin, 0, -0.36, -0.05, hip).scale.set(0.12, 0.07, 0.17); // foot
        model.add(hip);
        return hip;
    });

    // The sunglasses costume, hidden until collected
    const shades = new THREE.Group();
    [-1, 1].forEach((side) => {
        add(ball, lens, side * 0.18, 0.75, -1.0, shades).scale.set(0.14, 0.12, 0.07);
        const arm = add(new THREE.BoxGeometry(0.03, 0.03, 0.4), dark, side * 0.31, 0.77, -0.8, shades);
        arm.rotation.y = side * -0.15;
    });
    add(new THREE.BoxGeometry(0.2, 0.03, 0.03), dark, 0, 0.78, -1.04, shades);
    shades.visible = false;
    model.add(shades);

    model.scale.setScalar(0.85);
    model.userData = { legs, shades, materials };
    return model;
}

// Tint the whole hedgehog. With no colour it gets a faint glow of its own, so
// that it stays easy to see at night.
function glowPlayer(colour) {
    player.materials.forEach((material) => {
        if (colour === null) material.emissive.copy(material.color).multiplyScalar(0.22);
        else material.emissive.set(colour);
    });
}

function littleFluffyClouds(z) {
    const height = 22 + Math.random() * 45;
    const cloud = makeCard('cloud', 14 + Math.random() * 22, { fog: false, opacity: 0.5 + Math.random() * 0.3 });
    cloud.material.depthWrite = false;
    cloud.position.set((Math.random() - 0.5) * 420, height, z);
    cloud.userData.speed = 0.15 + Math.random() * 0.25; // parallax: clouds drift past more slowly than the ground
    scene.add(cloud);
    clouds.push(cloud);
}

function spawnRainbow() {
    if (rainbow) return;
    rainbow = makeCard('rainbow', 190, { fog: false, opacity: 0 });
    rainbow.material.depthWrite = false;
    rainbow.position.set((Math.random() - 0.5) * 160, -75, -330);
    rainbow.userData.age = 0;
    scene.add(rainbow);
}

// ---------------------------------------------------------------- game flow

function startGame() {
    // clear away whatever is left of the last run
    obstaclesArray.forEach((obstacle) => scene.remove(obstacle.group, obstacle.shadow));
    obstaclesArray = [];
    blockedLanes = [];
    if (shades) removeShades();

    gameState = 'during';
    gameClock = 0;
    platformSpeed = 2;
    score = journeyLength();
    startingReward = score;
    winner = false;
    shadesEquipped = false;
    nightTarget = 0;
    timers = { second: 1, obstacle: 1.5, shades: randomBetween(20, 50), rainbow: randomBetween(15, 40) };
    sounds.obstaclePass.playbackRate = 1;

    player.lane = 1;
    player.x = 0;
    player.y = 0;
    player.velocityY = 0;
    player.spin = 0;
    player.flash = 0;
    player.shades.visible = false;
    player.model.visible = true;
    player.model.rotation.set(0, 0, 0);
    player.group.rotation.set(0, 0, 0);
    glowPlayer(null);
    chips.forEach(removeChip);
    chips = [];
    messageText.textContent = '';

    hudButton.classList.add('hidden');
    hudButton.blur();
}

function countGameTime() {
    if (gameState === 'during') gameClock += 1;

    // the meeting gets a second closer whether or not anyone is playing
    if (score > 0 && gameState !== 'after') score -= 1;

    // speed the game up as it goes on
    if (gameState === 'during' && gameClock > 0 && gameClock % gameSpeedUpInterval === 0) {
        platformSpeed = Math.min(maxPlatformSpeed, platformSpeed + gameSpeedUpFactor);
        sounds.obstaclePass.playbackRate = Math.min(3, sounds.obstaclePass.playbackRate + 0.05);
        updateDayNightCycle();
    }
}

function worldSpeed() {
    return platformSpeed * platToVelFactor;
}

// How fast an obstacle closes on the hedgehog. speedFactor 1 stands still on
// the track; anything higher runs or flies towards the player.
function approachSpeed(obs) {
    if (obs.speedFactor === 0) return 0;
    return worldSpeed() * (1 + (obs.speedFactor - 1) * 0.25);
}

function addObstacle() {
    // name, speedFactor (how fast it comes at you), width (world units), flyHeight,
    // jumpable (can the hedgehog clear it?), tween (animation), score (seconds knocked off)
    let obstacles = [
        { name: 'cactusS', speedFactor: 1, width: 1.2, jumpable: true, tween: false, score: 3600 },
        { name: 'flamingo', speedFactor: 1.3, width: 1.5, jumpable: false, tween: 'wobble', score: 3600 },
        { name: 'crab', speedFactor: 0.8, width: 1.3, jumpable: true, tween: 'leftright', score: 3600 },
        { name: 'cactusL', speedFactor: 1, width: 2.2, jumpable: false, tween: false, score: 10800 },
        { name: 'bird', speedFactor: 2, width: 1.2, flyHeight: 1.5, jumpable: true, tween: 'updown', score: 7200 },
        { name: 'cactusCluster', score: 18000 },
        { name: 'eagle', speedFactor: 4, width: 2, jumpable: false, tween: 'divebomb', score: 1000 },
        { name: 'zebra', speedFactor: 3, width: 2.3, jumpable: false, tween: 'trot', score: 10000 },
        { name: 'lizard', speedFactor: 5, width: 1.4, jumpable: true, tween: 'wobble', score: 0 },
        { name: 'unicorn', speedFactor: 2.5, width: 2, jumpable: false, tween: 'trot', score: 14400 }
    ];

    // the faster the game, the more of the list is in play
    let numberOfObsToChooseFrom = Math.min(obstacles.length, Math.round(platformSpeed * 3));
    let chosenObstacle = obstacles[randomBetween(0, numberOfObsToChooseFrom - 1, true)];
    let lane = randomBetween(0, 2, true);

    switch (chosenObstacle.name) {
        case 'cactusCluster':
            // a big cactus to dodge with a small one in each other lane: jump or lose
            lane = fairLane(lane, obstacles[3]);
            renderObstacle({ ...obstacles[3], score: chosenObstacle.score, lane: lane });
            [0, 1, 2].filter((l) => l !== lane).forEach((l) => {
                renderObstacle({ ...obstacles[0], score: 0, lane: l });
            });
            break;
        default:
            if (!chosenObstacle.jumpable) lane = fairLane(lane, chosenObstacle);
            renderObstacle({ ...chosenObstacle, lane: lane });
            break;
    }
}

// Obstacles that cannot be jumped must never close off all three lanes at once.
// If the other two lanes are already blocked when this one would arrive, it
// joins one of them instead.
function fairLane(lane, obs) {
    const arrival = elapsed + spawnDistance / approachSpeed(obs);
    blockedLanes = blockedLanes.filter((b) => b.time > elapsed - 1);
    const clashing = (l) => blockedLanes.some((b) => b.lane === l && Math.abs(b.time - arrival) < 0.8);
    const others = [0, 1, 2].filter((l) => l !== lane);
    if (others.every(clashing)) lane = others[randomBetween(0, 1, true)];
    blockedLanes.push({ lane: lane, time: arrival });
    return lane;
}

function renderObstacle(obs) {
    const group = new THREE.Group();
    const card = makeCard(obs.name, obs.width, { opacity: obs.tween === 'appear' ? 0 : 1 });
    const shadow = makeShadow(obs.width * 0.9);
    group.add(card);

    const obstacle = {
        parameters: obs,
        group, card, shadow,
        baseX: obs.x !== undefined ? obs.x : lanes[obs.lane],
        x: 0,
        y: obs.flyHeight || 0,
        z: obs.z !== undefined ? obs.z : -spawnDistance,
        previousZ: 0,
        width: obs.width,
        height: card.userData.height,
        phase: Math.random() * Math.PI * 2,
        age: 0,
        passed: false,  // has the hedgehog got past it yet?
        score: obs.score * platformSpeed
    };
    obstacle.x = obstacle.baseX;
    obstacle.previousZ = obstacle.z;

    scene.add(group, shadow);
    obstaclesArray.push(obstacle);
    animateObstacle(obstacle, 0);
    return obstacle;
}

function animateObstacle(obstacle, dt) {
    const obs = obstacle.parameters;
    const card = obstacle.card;
    obstacle.age += dt;
    const t = obstacle.age + obstacle.phase;
    let hop = 0;

    switch (obs.tween) {
        case 'updown':
            obstacle.y = obs.flyHeight + Math.sin(t * 6) * 0.2;
            break;
        case 'trot':
            hop = Math.abs(Math.sin(t * 10)) * 0.3;
            break;
        case 'leftright':
            // scuttle from side to side across the lane lines
            obstacle.x = obstacle.baseX + Math.sin(t * 3) * laneWidth * 0.45;
            break;
        case 'leftrightX':
            obstacle.x = obstacle.baseX + Math.sin(t * 10) * 0.25;
            break;
        case 'wobble':
            card.rotation.z = Math.sin(t * 9) * 0.17;
            break;
        case 'divebomb': {
            // circle high, then swoop to ground level just in front of the hedgehog
            const k = THREE.MathUtils.clamp((-obstacle.z - 4) / 45, 0, 1);
            obstacle.y = 0.15 + 8 * k * k;
            card.rotation.z = 0.5 * Math.min(1, k * 2);
            break;
        }
        case 'winnerHeart':
            obstacle.y = 2.2 + (Math.sin(t * 3) + 1) * 0.7;
            break;
        case 'appear':
            card.material.opacity = Math.min(1, obstacle.age / 2);
            break;
        case 'flyby':
            obstacle.x -= obs.flySpeed * dt;
            if (obstacle.x < -30) obstacle.x = 30;
            obstacle.y = obs.flyHeight + Math.sin(t * 5) * 0.3;
            break;
        case 'party':
            // hop on the spot, shuffle across, turn round, repeat
            hop = Math.abs(Math.sin(t * 8)) * 0.4;
            obstacle.x = obstacle.baseX + Math.sin(t * 1.2) * 1.2;
            card.scale.x = Math.cos(t * 1.2) > 0 ? 1 : -1;
            break;
    }

    // pop into existence rather than blinking in
    const grow = Math.min(1, obstacle.age / 0.3 + 0.01);
    obstacle.group.scale.setScalar(grow);

    obstacle.group.position.set(obstacle.x, 0, obstacle.z);
    card.position.y = obstacle.y + hop;
    obstacle.shadow.position.x = obstacle.x;
    obstacle.shadow.position.z = obstacle.z;
    liftShadow(obstacle.shadow, obstacle.y + hop);
}

function collides(obstacle) {
    // did the obstacle sweep through the hedgehog's slice of the track this frame?
    if (obstacle.z < -hitDepth || obstacle.previousZ > hitDepth) return false;
    if (Math.abs(obstacle.x - player.x) > obstacle.width * 0.32 + player.halfWidth) return false;
    if (obstacle.parameters.name === 'cyanHeart') return true; // there is no missing the heart
    // the artwork has soft edges, so the boxes are a little smaller than the pictures
    const bottom = obstacle.y + obstacle.height * 0.1;
    const top = obstacle.y + obstacle.height * 0.78;
    return player.y < top && player.y + player.height > bottom;
}

function hitObstacle(obstacle) {
    gameState = 'after';
    window.j2hh.lastHit = obstacle;

    // Update highscore: lower score (closer to meeting) is better
    if (highscore === 0 || score < highscore) {
        highscore = Math.max(score, 1);
        localStorage.setItem(highscoreKey, highscore);
    }

    if (obstacle.parameters.name === 'cyanHeart') {
        playerCollisionWinner();
        messageText.textContent = 'Congratulations! You made it to Hedgeheart!';
    } else {
        playerCollisionByee();
        messageText.textContent = 'Journey Over! Only ' + convertSecondsIntoText(score) + ' to go to Hedgeheart';
    }

    hudButton.textContent = 'Play again?';
    hudButton.classList.remove('hidden');
}

function playerCollisionByee() {
    glowPlayer(0xaa0000);                     // flash red to show game over
    player.velocityY = 7;                     // knocked into the air, then off the scene
    player.spin = 9;
    playSound('obstacleHit');
}

function playerCollisionWinner() {
    glowPlayer(0x8a6a00); // golden hedgehog
    playSound('winner');

    // whatever is still on the track makes way for the party
    obstaclesArray.forEach((o) => scene.remove(o.group, o.shadow));
    obstaclesArray = [];

    // bring all the obstacles back in for a dance party
    const guest = (name, x, z, width, tween, extra = {}) =>
        renderObstacle({ name, x, z, width, tween, speedFactor: 0, score: 0, ...extra });
    guest('cyanHeart', 0, -13, 5, 'winnerHeart');
    guest('cactusS', -6.2, -7, 1.2, 'appear');
    guest('cactusL', -5.2, -8, 2.2, 'appear');
    guest('cactusS', -4.2, -7, 1.2, 'appear');
    guest('cactusS', 4.2, -7, 1.2, 'appear');
    guest('cactusL', 5.2, -8, 2.2, 'appear');
    guest('cactusS', 6.2, -7, 1.2, 'appear');
    guest('flamingo', 2.2, -5.5, 1.4, 'wobble');
    guest('flamingo', 3.2, -4.5, 1.4, 'wobble');
    guest('flamingo', 4.2, -3.5, 1.4, 'wobble');
    guest('crab', -2.2, -5.5, 1.2, 'leftrightX');
    guest('crab', -3.2, -4.5, 1.2, 'leftrightX');
    guest('crab', -4.2, -3.5, 1.2, 'leftrightX');
    guest('bird', 30, -12, 1.2, 'flyby', { flyHeight: 4.5, flySpeed: 9 });
    guest('bird', 18, -10, 1.2, 'flyby', { flyHeight: 3.6, flySpeed: 11 });
    guest('bird', 8, -14, 1.2, 'flyby', { flyHeight: 5.4, flySpeed: 8 });
    guest('eagle', 25, -16, 2, 'flyby', { flyHeight: 6.5, flySpeed: 13 });
    guest('eagle', 12, -18, 2, 'flyby', { flyHeight: 7.5, flySpeed: 12 });
    guest('lizard', 1.6, -1.5, 0.9, 'wobble');
    guest('zebra', -1.5, -4, 2, 'party');
    guest('unicorn', 1.5, -6.5, 2, 'party');
}

function addShades() {
    if (gameState !== 'during' || shadesEquipped || shades) return;
    const card = makeCard('hedgehogShades', 1.1);
    const shadow = makeShadow(0.9);
    shades = { card, shadow, lane: randomBetween(0, 2, true), z: -spawnDistance, age: 0 };
    card.position.x = shadow.position.x = lanes[shades.lane];
    scene.add(card, shadow);
}

function removeShades() {
    scene.remove(shades.card, shades.shadow);
    shades = null;
}

function updateShades(dt) {
    shades.age += dt;
    shades.z += worldSpeed() * dt;
    shades.card.position.z = shades.shadow.position.z = shades.z;
    shades.card.position.y = 0.35 + Math.sin(shades.age * 5) * 0.15; // bob enticingly

    const reachable = Math.abs(shades.z) < 0.7 && Math.abs(lanes[shades.lane] - player.x) < 1 && player.y < 1.3;
    if (reachable) {
        shadesEquipped = true;
        player.shades.visible = true;
        player.flash = 0.8;
        playSound('obstaclePass');
        removeShades();
    } else if (shades.z > 10) {
        // missed them: they will be back
        removeShades();
        timers.shades = randomBetween(10, 25);
    }
}

function showPassedCelebration(obstacle) {
    if (obstacle.score <= 0) return;
    // a chip showing the time saved pops up over the obstacle's head as it goes by
    const chip = makeChip(obstacle.score);
    const top = obstacle.y + obstacle.height;
    chip.position.set(obstacle.x, THREE.MathUtils.clamp(top + 0.5, 1.9, 3.4), 0.4);
    chip.userData.age = 0;
    scene.add(chip);
    chips.push(chip);
    playSound('obstaclePass');
}

// Split a time into scoreboard cells. Leading units that are zero are dropped
// unless keepAll is set.
function timeCells(totalSeconds, keepAll) {
    const total = Math.max(0, Math.round(totalSeconds));
    const cells = [
        { label: 'days', value: Math.floor(total / 86400) },
        { label: 'hrs', value: Math.floor(total % 86400 / 3600) },
        { label: 'min', value: Math.floor(total % 3600 / 60) },
        { label: 'sec', value: total % 60 }
    ];
    while (!keepAll && cells.length > 1 && cells[0].value === 0) cells.shift();
    cells.forEach((cell, i) => {
        // days and the leading cell of a chip run free; the rest keep two digits
        const pad = cell.label !== 'days' && (keepAll || i > 0);
        cell.text = pad ? String(cell.value).padStart(2, '0') : String(cell.value);
    });
    return cells;
}

// A chunky 3D token with the time saved on its face, laid out like the scoreboard
function makeChip(seconds) {
    const cells = timeCells(seconds, false);
    const cellWidth = 100, signWidth = 60, pad = 16, canvasHeight = 128;
    const canvasWidth = signWidth + cells.length * cellWidth + pad;

    const face = canvasTexture(canvasWidth, canvasHeight, (ctx) => {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.font = '800 68px Nunito, sans-serif';
        ctx.fillText('−', pad / 2 + signWidth / 2, 72);
        cells.forEach((cell, i) => {
            const x = pad / 2 + signWidth + i * cellWidth + cellWidth / 2;
            ctx.fillStyle = '#ffffff';
            ctx.font = '800 64px Nunito, sans-serif';
            ctx.fillText(cell.text, x, 72);
            ctx.fillStyle = '#0b3d5c';
            ctx.font = '800 24px Nunito, sans-serif';
            ctx.fillText(cell.label.toUpperCase(), x, 106);
        });
    });
    face.wrapS = face.wrapT = THREE.ClampToEdgeWrapping;

    const height = 0.78, width = height * canvasWidth / canvasHeight, radius = 0.2, depth = 0.12, bevel = 0.045;
    const w = width / 2 - bevel, h = height / 2 - bevel;
    const outline = new THREE.Shape();
    outline.moveTo(-w + radius, -h);
    outline.lineTo(w - radius, -h);
    outline.quadraticCurveTo(w, -h, w, -h + radius);
    outline.lineTo(w, h - radius);
    outline.quadraticCurveTo(w, h, w - radius, h);
    outline.lineTo(-w + radius, h);
    outline.quadraticCurveTo(-w, h, -w, h - radius);
    outline.lineTo(-w, -h + radius);
    outline.quadraticCurveTo(-w, -h, -w + radius, -h);
    const bodyGeometry = new THREE.ExtrudeGeometry(outline, {
        depth: depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6
    });
    bodyGeometry.center();

    const chip = new THREE.Group();
    const body = new THREE.Mesh(bodyGeometry, new THREE.MeshLambertMaterial({
        color: 0x12b5e0, emissive: 0x06506a, transparent: true
    }));
    const label = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({ map: face, transparent: true, fog: false, depthWrite: false }));
    label.position.z = depth / 2 + bevel + 0.004;
    chip.add(body, label);
    chip.userData.parts = [body, label];
    return chip;
}

function updateChips(dt) {
    chips = chips.filter((chip) => {
        const age = chip.userData.age += dt;
        if (age > 1.5) {
            removeChip(chip);
            return false;
        }
        // pop out, drift up with a swing that shows off its thickness, then fade
        const pop = Math.min(1, age / 0.18);
        chip.scale.setScalar(pop * (1.25 - 0.25 * Math.min(1, age / 0.35)));
        chip.position.y += 0.75 * dt;
        chip.rotation.set(-0.12, Math.sin(age * 5.5) * 0.45, 0);
        const opacity = Math.min(1, (1.5 - age) / 0.4);
        chip.userData.parts.forEach((part) => part.material.opacity = opacity);
        return true;
    });
}

function removeChip(chip) {
    scene.remove(chip);
    chip.userData.parts.forEach((part) => {
        part.geometry.dispose();
        if (part.material.map) part.material.map.dispose();
        part.material.dispose();
    });
}

// Show the countdown as a scoreboard: one tile each for days, hours, minutes and seconds
let scoreboardShowing = '';
function updateScoreboard() {
    const cells = timeCells(score, true);
    const showing = cells.map((cell) => cell.text).join(':');
    if (showing === scoreboardShowing) return;
    scoreboardShowing = showing;
    cells.forEach((cell, i) => scoreboard.children[i].firstElementChild.textContent = cell.text);
}

function playSound(name) {
    const sound = sounds[name];
    sound.currentTime = 0;
    sound.play().catch(() => { }); // browsers refuse sound until the player has touched the page
}

// ---------------------------------------------------------------- controls

function setupControls() {
    // Keyboard controls (for desktop)
    window.addEventListener('keydown', (event) => {
        if (event.repeat) return;
        switch (event.code) {
            case 'ArrowLeft': case 'KeyA': inputState.left = true; break;
            case 'ArrowRight': case 'KeyD': inputState.right = true; break;
            case 'ArrowUp': case 'KeyW': inputState.jump = true; break;
            case 'ArrowDown': case 'KeyS': inputState.down = true; break;
            case 'Space':
                if (gameState !== 'during') startGame();
                else inputState.jump = true;
                break;
            default: return;
        }
        event.preventDefault();
    });
    window.addEventListener('keyup', (event) => {
        switch (event.code) {
            case 'ArrowUp': case 'KeyW': case 'Space': inputState.jump = false; break;
            case 'ArrowDown': case 'KeyS': inputState.down = false; break;
        }
    });

    // On-screen buttons (for mobile)
    const press = (id, down, up) => {
        const button = document.getElementById(id);
        if (!button) return;
        button.addEventListener('pointerdown', (event) => { event.preventDefault(); down(); });
        if (up) ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, up));
    };
    press('left-btn', () => inputState.left = true);
    press('right-btn', () => inputState.right = true);
    press('jump-btn', () => inputState.jump = true, () => inputState.jump = false);

    // Swipes on the game itself: left and right change lane, up jumps, down drops
    let swipeStart = null;
    const canvas = renderer.domElement;
    canvas.addEventListener('pointerdown', (event) => {
        swipeStart = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!swipeStart) return;
        const dx = event.clientX - swipeStart.x;
        const dy = event.clientY - swipeStart.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
        swipeStart = null; // one swipe, one move
        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) inputState.left = true; else inputState.right = true;
        } else if (dy < 0) {
            inputState.jump = true;
            setTimeout(() => inputState.jump = false, 150);
        } else {
            inputState.down = true;
            setTimeout(() => inputState.down = false, 300);
        }
    });
    ['pointerup', 'pointercancel'].forEach((type) => canvas.addEventListener(type, () => swipeStart = null));
}

function connectWebSocket() {
    // AI websocket remote playing
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        console.log('WebSocket connection already open or connecting.');
        return;
    }

    socket = new WebSocket('ws://localhost:8081');

    socket.onopen = () => {
        console.log('Connected to WebSocket server');
        WSretryCount = 0;
    };

    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.action !== undefined) applyWebSocketAction(data.action);
        WSSendNow = true;
    };

    socket.onclose = () => {
        console.log('Disconnected from WebSocket server');
        if (WSretryCount < WSmaxRetries) {
            WSretryCount++;
            setTimeout(connectWebSocket, WSreconnectInterval);
        }
    };

    socket.onerror = (error) => {
        console.log('WebSocket error:', error);
        socket.close(); // closing triggers the retry in onclose
    };
}

function applyWebSocketAction(action) {
    inputState.left = false;
    inputState.right = false;
    inputState.jump = false;
    inputState.down = false;
    switch (action) {
        case 0: inputState.left = true; break;  // one lane left
        case 1: inputState.right = true; break; // one lane right
        case 2: inputState.jump = true; break;
        case 3: break;                          // idle
        case "Start":
            if (gameState != 'during') startGame();
            break;
        case "Reset":
            startGame();
            break;
    }
}

// ---------------------------------------------------------------- the loop

function update() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    const speed = gameState === 'after' ? 0 : worldSpeed();

    updateTimers(dt);
    updateWorld(dt, speed);
    updatePlayer(dt);

    if (shades && gameState === 'during') updateShades(dt);

    obstaclesArray.forEach((obstacle) => {
        if (gameState !== 'after') {
            obstacle.previousZ = obstacle.z;
            obstacle.z += approachSpeed(obstacle.parameters) * dt;
        }
        animateObstacle(obstacle, dt);

        if (gameState !== 'during') return;

        if (collides(obstacle)) {
            hitObstacle(obstacle);
        } else if (!obstacle.passed && obstacle.z > hitDepth + 0.6) {
            // safely past: knock its time off the journey
            score = Math.max(0, score - obstacle.score);
            showPassedCelebration(obstacle);
            obstacle.passed = true;
        }
    });

    // tidy up obstacles that have gone by behind the camera
    if (gameState !== 'after') {
        obstaclesArray = obstaclesArray.filter((obstacle) => {
            if (obstacle.z < 12) return true;
            scene.remove(obstacle.group, obstacle.shadow);
            return false;
        });
    }

    updateScoreboard();
    updateChips(dt);
    highscoreText.textContent = highscore > 0 ? 'Best: ' + convertSecondsIntoText(highscore) : '';

    if (score < 10 && winner == false && gameState === 'during') {
        // 10 seconds from the end the heart appears, right across the track
        winner = true;
        renderObstacle({ name: 'cyanHeart', speedFactor: 1, width: laneWidth * 3.4, lane: 1, z: -worldSpeed() * 6, tween: 'winnerHeart', score: 0 });
    }

    // Websockets response. Capture the current game state, send it to the server
    if (AIControl && socket && socket.readyState === WebSocket.OPEN && WSSendNow === true) {
        socket.send(JSON.stringify(gameStatusResponse()));
        WSSendNow = false;
    }

    renderer.render(scene, camera);
}

function updateTimers(dt) {
    timers.second -= dt;
    if (timers.second <= 0) {
        timers.second += 1;
        countGameTime();
    }

    if (gameState === 'after') return;

    timers.rainbow -= dt;
    if (timers.rainbow <= 0) {
        spawnRainbow();
        timers.rainbow = randomBetween(15, 40);
    }

    if (gameState !== 'during') return;

    // the faster the game, the shorter the gaps between obstacles; none once the heart is on its way
    timers.obstacle -= dt;
    if (timers.obstacle <= 0) {
        if (!winner) addObstacle();
        timers.obstacle = randomBetween(obstacleMinGap, obstacleMaxGap) / platformSpeed / 1000;
    }

    if (!shadesEquipped && !shades) {
        timers.shades -= dt;
        if (timers.shades <= 0) addShades();
    }
}

function updateWorld(dt, speed) {
    // the hedgehog stays put: the ground and everything on it slides towards the camera
    pathTexture.offset.y += speed * dt / 8;
    grassTexture.offset.y += speed * dt / 10;

    scenery.forEach((item) => {
        item.position.z += speed * dt;
        if (item.position.z > 15) placeScenery(item, item.position.z - 245);
    });

    clouds.forEach((cloud) => {
        cloud.position.z += speed * cloud.userData.speed * dt;
        if (cloud.position.z > -40) {
            cloud.position.z -= 330;
            cloud.position.x = (Math.random() - 0.5) * 420;
        }
    });

    if (rainbow) {
        // fade in, linger, fade away
        rainbow.userData.age += dt;
        const age = rainbow.userData.age;
        rainbow.material.opacity = 0.55 * Math.min(1, age / 2, Math.max(0, (10 - age) / 4));
        if (age > 10) {
            scene.remove(rainbow);
            rainbow = null;
        }
    }

    // ease the sky, fog and light between day and night
    nightAmount += (nightTarget - nightAmount) * Math.min(1, dt * 0.5);
    scene.background.lerpColors(dayColour, nightColour, nightAmount);
    scene.fog.color.copy(scene.background);
    hemiLight.intensity = 1.6 - 1.1 * nightAmount;
    sunLight.intensity = 1.8 - 1.5 * nightAmount;
    sun.material.color.setHex(0xfff3b0).lerp(white, nightAmount); // the sun becomes the moon
    sun.scale.setScalar(1 - 0.45 * nightAmount);
    stars.material.opacity = nightAmount;
    clouds.forEach((cloud) => cloud.material.color.lerpColors(white, nightTint, nightAmount));
}

function updatePlayer(dt) {
    if (gameState === 'during') {
        // change lanes
        if (inputState.left || inputState.right) {
            const lane = THREE.MathUtils.clamp(player.lane + (inputState.left ? -1 : 1), 0, 2);
            if (lane !== player.lane) {
                player.lane = lane;
                playSound('playerLR');
            }
        }
        const onFloor = player.y <= 0;
        if (inputState.jump && onFloor) {
            player.velocityY = jumpVelocity;
            playSound('playerJump');
        } else if (inputState.down && !onFloor) {
            player.velocityY = Math.min(player.velocityY, -12); // pull jump down
        }
    }
    inputState.left = false;
    inputState.right = false;

    const model = player.model;
    let turn = 0, pitch = 0;

    if (gameState === 'after' && !winner) {
        // tumble off the scene
        player.velocityY -= gravity * dt;
        player.y += player.velocityY * dt;
        player.group.rotation.z += player.spin * dt;
        if (player.y < -30) model.visible = false;
    } else if (gameState === 'after') {
        // victory bounce, turning round to show off
        player.y = Math.abs(Math.sin(elapsed * 5)) * 1.2;
        turn = elapsed * 3;
    } else {
        const targetX = lanes[player.lane];
        const dx = targetX - player.x;
        player.x += dx * Math.min(1, dt * 11);
        // the body turns towards the new lane and leans into the corner
        turn = -THREE.MathUtils.clamp(dx * 0.8, -1, 1);
        player.group.rotation.z = -dx * 0.1;

        player.velocityY -= gravity * dt;
        player.y += player.velocityY * dt;
        if (player.y <= 0) {
            player.y = 0;
            player.velocityY = 0;
        }
        pitch = THREE.MathUtils.clamp(player.velocityY * 0.035, -0.4, 0.4); // nose up on the way up
    }

    // Legs: diagonal pairs swing together while running, and stretch out in the air
    const running = gameState !== 'after' && player.y === 0;
    let bob = 0;
    if (running) {
        player.stride += dt * (9 + platformSpeed * 3.5);
        const swing = Math.sin(player.stride) * 0.95;
        player.legs.forEach((leg, i) => leg.rotation.x = (i === 0 || i === 3) ? swing : -swing);
        bob = Math.abs(Math.cos(player.stride)) * 0.07;
        pitch = Math.sin(player.stride * 2) * 0.04;
    } else {
        player.legs.forEach((leg, i) => {
            const reach = i < 2 ? 0.9 : -0.9;
            leg.rotation.x += (reach - leg.rotation.x) * Math.min(1, dt * 14);
        });
    }
    model.rotation.set(pitch, turn, 0);

    player.group.position.set(player.x, player.y + bob, 0);
    player.shadow.position.set(player.x, 0.03, 0);
    player.shadow.visible = player.y > -0.5;
    liftShadow(player.shadow, Math.max(0, player.y));

    // blink after picking up a costume
    if (player.flash > 0) {
        player.flash -= dt;
        model.visible = player.flash <= 0 || Math.floor(player.flash * 10) % 2 === 0;
    }

    // the camera drifts a little way after the hedgehog
    camera.position.x += (player.x * 0.45 - camera.position.x) * Math.min(1, dt * 6);
}

function updateDayNightCycle() {
    // Gradually shift from day to night over 10 speed increments
    const maxSteps = 10;
    const step = Math.min(Math.floor((platformSpeed - 2) / gameSpeedUpFactor + 0.001), maxSteps);
    nightTarget = step / maxSteps;
}

function gameStatusResponse() {
    // A 10x10 bird's-eye view of the track for the AI: the first index runs
    // across the lanes (left to right), the second runs from the horizon (0)
    // to the hedgehog (9). The player is 1 (2 while in the air), obstacles
    // not yet passed are floor(speedFactor)+2.
    const gridSizeX = 10;
    const gridSizeY = 10;
    const map = Array(gridSizeX).fill().map(() => Array(gridSizeY).fill(0));
    const column = (x) => Math.floor((x + laneWidth * 1.5) / (laneWidth * 3) * gridSizeX);
    const row = (z) => Math.floor((z + spawnDistance) / (spawnDistance + 0.001) * gridSizeY);
    const inGrid = (c, r) => c >= 0 && c < gridSizeX && r >= 0 && r < gridSizeY;

    obstaclesArray.forEach((obstacle) => {
        if (obstacle.passed) return;
        const c = column(obstacle.x), r = row(Math.min(obstacle.z, 0));
        if (inGrid(c, r)) map[c][r] = Math.floor(obstacle.parameters.speedFactor) + 2;
    });
    const playerColumn = column(player.x);
    if (inGrid(playerColumn, gridSizeY - 1)) map[playerColumn][gridSizeY - 1] = player.y > 0 ? 2 : 1;

    const reward = startingReward - score;
    startingReward = score;

    return {
        state: map,
        reward: reward,
        done: gameState === 'after'
    };
}

function randomBetween(min, max, whole = false) {
    return whole ? Math.floor(min + Math.random() * (max - min + 1)) : min + Math.random() * (max - min);
}

function convertSecondsIntoText(totalSeconds) {
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
    const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
    const seconds = Math.round(totalSeconds % 60);

    return [
        days > 0 ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
        hours > 0 ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
        minutes > 0 ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
        seconds > 0 ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}` : ''
    ].filter(Boolean).join(' ') || '0 seconds';
}

// A window onto the game for debugging and automated play-testing
window.j2hh = {
    get state() { return { gameState, score, platformSpeed, gameClock, winner, lane: player.lane, obstacles: obstaclesArray.length }; },
    get obstacles() { return obstaclesArray; },
    get player() { return player; },
    inputState,
    setScore(value) { score = value; },
    setSpeed(value) { platformSpeed = value; updateDayNightCycle(); },
    gameStatusResponse
};
