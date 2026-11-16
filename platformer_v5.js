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
let stepHeight = 0.55;           // the tallest ledge the hedgehog can step up sideways
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
let humps = [];                  // raised stretches of a single lane
let particles = [];              // dust, flying spines and stars
let shake = 0;                   // how hard the camera is shaking
let cameraX = 0, cameraLift = 0;
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
let pathTexture, grassTexture, pathMaterial, grassMaterial;
let hemiLight, sunLight, sun, stars;
let scenery = [];
let clouds = [];
let rainbow = null;
let nightAmount = 0;             // 0 = day, 1 = night; eased towards nightTarget
let nightTarget = 0;
let elapsed = 0;                 // seconds since the page loaded
let timers = { second: 1, obstacle: 3, hump: 8, shades: 30, rainbow: 20 };

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
    createTerrain();
    createPlayer();

    setupControls();
    new ResizeObserver(resize).observe(container);
    resize();

    hudButton.addEventListener('click', () => startGame());
    setupSound();

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

// ---------------------------------------------------------------- humps, potholes and particles

let humpMaterial, humpSideMaterial, potholeMaterial;
let particleKinds = {};

function createTerrain() {
    // the top of a hump: sand, with a pale line down each edge
    const humpTexture = canvasTexture(128, 256, (ctx, w, h) => {
        ctx.fillStyle = '#e8cd96';
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, ['#d8ba80', '#f0d9aa', '#cfae72'], 300, 4);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        ctx.fillRect(0, 0, 5, h);
        ctx.fillRect(w - 5, 0, 5, h);
    });
    humpMaterial = new THREE.MeshLambertMaterial({ map: humpTexture, side: THREE.DoubleSide });
    humpSideMaterial = new THREE.MeshLambertMaterial({ color: 0xb98f55, side: THREE.DoubleSide });

    // a pothole: a ragged dark hole with a crumbling rim
    const potholeTexture = canvasTexture(128, 128, (ctx, w, h) => {
        const blob = (radius, jitter, colour) => {
            ctx.fillStyle = colour;
            ctx.beginPath();
            for (let i = 0; i <= 18; i++) {
                const angle = i / 18 * Math.PI * 2;
                const r = radius * (1 - jitter * (0.5 + 0.5 * Math.sin(i * 5.3) * Math.cos(i * 2.1)));
                ctx.lineTo(w / 2 + Math.cos(angle) * r, h / 2 + Math.sin(angle) * r);
            }
            ctx.fill();
        };
        blob(62, 0.12, '#a9844c');
        blob(54, 0.14, '#5b4126');
        blob(47, 0.16, '#24160d');
        blob(36, 0.2, '#0b0705');
    });
    potholeTexture.wrapS = potholeTexture.wrapT = THREE.ClampToEdgeWrapping;
    potholeMaterial = new THREE.MeshBasicMaterial({
        map: potholeTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4
    });

    // a five-pointed star, for seeing stars
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 0.45 : 1, a = i / 10 * Math.PI * 2 + Math.PI / 2;
        star[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    const starGeometry = new THREE.ExtrudeGeometry(star, { depth: 0.3, bevelEnabled: false });
    starGeometry.center();

    particleKinds = {
        spine: {
            geometry: new THREE.ConeGeometry(0.06, 0.3, 5), size: 1, gravity: 1, life: 0.9,
            material: new THREE.MeshLambertMaterial({ color: 0x8a5a46, emissive: 0x2a1a14, flatShading: true })
        },
        dust: {
            geometry: new THREE.IcosahedronGeometry(1, 0), size: 0.16, gravity: -0.05, life: 0.6,
            material: new THREE.MeshLambertMaterial({ color: 0xe6d2a4, emissive: 0x4a4030, flatShading: true })
        },
        star: {
            geometry: starGeometry, size: 0.16, gravity: 0.6, life: 0.9,
            material: new THREE.MeshBasicMaterial({ color: 0xffd93b })
        }
    };
}

// The shape of a hump along its length: up a ramp, along the top, down a ramp
function humpProfile(t) {
    const ramp = 0.3;
    const u = THREE.MathUtils.clamp(Math.min(t, 1 - t) / ramp, 0, 1);
    return u * u * (3 - 2 * u);
}

// How high the road is at a point: zero, except on a hump
function groundHeight(x, z) {
    let height = 0;
    humps.forEach((hump) => {
        if (Math.abs(x - hump.x) < laneWidth / 2 && Math.abs(z - hump.z) < hump.length / 2) {
            height = Math.max(height, hump.height * hump.grow * humpProfile((z - hump.z) / hump.length + 0.5));
        }
    });
    return height;
}

// Raise one lane of the road for a stretch. Whatever is in that lane rides up
// and over it; from the side it is a ledge too high to step onto.
function addHump() {
    const lane = randomBetween(0, 2, true);
    const length = randomBetween(16, 24), height = randomBetween(1, 1.5);
    const half = laneWidth / 2, segments = 28;
    const top = [], topUV = [], sides = [];
    for (let i = 0; i < segments; i++) {
        const t0 = i / segments, t1 = (i + 1) / segments;
        const z0 = (t0 - 0.5) * length, z1 = (t1 - 0.5) * length;
        const y0 = humpProfile(t0) * height, y1 = humpProfile(t1) * height;
        top.push(-half, y0, z0, half, y0, z0, half, y1, z1, -half, y0, z0, half, y1, z1, -half, y1, z1);
        const v0 = t0 * length / 6, v1 = t1 * length / 6;
        topUV.push(0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1);
        [-half, half].forEach((x) => {
            sides.push(x, 0, z0, x, y0, z0, x, y1, z1, x, 0, z0, x, y1, z1, x, 0, z1);
        });
    }
    const topGeometry = new THREE.BufferGeometry();
    topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(top, 3));
    topGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(topUV, 2));
    topGeometry.computeVertexNormals();
    const sideGeometry = new THREE.BufferGeometry();
    sideGeometry.setAttribute('position', new THREE.Float32BufferAttribute(sides, 3));
    sideGeometry.computeVertexNormals();

    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(topGeometry, humpMaterial), new THREE.Mesh(sideGeometry, humpSideMaterial));
    const hump = { mesh, lane, x: lanes[lane], z: -spawnDistance - length / 2, length, height, grow: 0 };
    mesh.position.set(hump.x, 0.012, hump.z);
    scene.add(mesh);
    humps.push(hump);
}

function removeHump(hump) {
    scene.remove(hump.mesh);
    hump.mesh.children.forEach((part) => part.geometry.dispose());
}

function updateHumps(dt, speed) {
    humps = humps.filter((hump) => {
        hump.z += speed * dt;
        hump.grow = Math.min(1, hump.grow + dt * 2); // swell up out of the road rather than blink in
        hump.mesh.position.z = hump.z;
        hump.mesh.scale.y = Math.max(0.001, hump.grow);
        if (hump.z - hump.length / 2 < 14) return true;
        removeHump(hump);
        return false;
    });
}

function makePothole(width) {
    const geometry = new THREE.PlaneGeometry(width, width * 1.6);
    geometry.rotateX(-Math.PI / 2);
    const hole = new THREE.Mesh(geometry, potholeMaterial);
    hole.userData.height = 0;
    return hole;
}

// Throw out a puff of particles: 'spine', 'dust' or 'star'
function burst(kind, x, y, z, count, speed) {
    const type = particleKinds[kind];
    for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(type.geometry, type.material);
        const around = Math.random() * Math.PI * 2, up = 0.3 + Math.random() * 0.9;
        mesh.position.set(x, y, z);
        mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        const size = type.size * (0.6 + Math.random() * 0.8);
        scene.add(mesh);
        particles.push({
            mesh, type, size, age: 0, life: type.life * (0.6 + Math.random() * 0.6),
            velocity: new THREE.Vector3(Math.cos(around) * speed, up * speed, Math.sin(around) * speed * 0.6)
        });
    }
}

function updateParticles(dt) {
    particles = particles.filter((particle) => {
        particle.age += dt;
        if (particle.age >= particle.life) {
            scene.remove(particle.mesh);
            return false;
        }
        const mesh = particle.mesh;
        particle.velocity.y -= gravity * particle.type.gravity * dt;
        mesh.position.addScaledVector(particle.velocity, dt);
        mesh.rotation.x += dt * 9;
        mesh.rotation.z += dt * 7;
        mesh.scale.setScalar(particle.size * (1 - particle.age / particle.life));
        return true;
    });
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
    // group moves the hedgehog about; tumble turns it around the middle of its body
    const group = new THREE.Group();
    const tumble = new THREE.Group();
    const model = createHedgehog();
    tumble.position.y = 0.5;
    model.position.y = -0.5;
    tumble.add(model);
    group.add(tumble);
    const shadow = makeShadow(1.3);

    // the stars it sees after a knock
    const stars = new THREE.Group();
    for (let i = 0; i < 3; i++) {
        const star = new THREE.Mesh(particleKinds.star.geometry, particleKinds.star.material);
        star.scale.setScalar(0.13);
        stars.add(star);
    }
    stars.visible = false;
    scene.add(group, shadow, stars);

    player = {
        group, tumble, model, shadow, stars,
        legs: model.userData.legs,
        shades: model.userData.shades,
        materials: model.userData.materials,
        lane: 1,          // 0 left, 1 middle, 2 right
        x: 0, y: 0, z: 0,
        velocityY: 0,
        onFloor: true,
        halfWidth: 0.4,
        height: 0.85,
        stride: 0,        // where the legs are in their running cycle
        bump: 0,          // sideways jolt after walking into a ledge
        flash: 0,
        hit: null         // the knock-out animation in progress, if any
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
    humps.forEach(removeHump);
    humps = [];
    particles.forEach((particle) => scene.remove(particle.mesh));
    particles = [];
    chips.forEach(removeChip);
    chips = [];
    if (shades) removeShades();

    gameState = 'during';
    gameClock = 0;
    platformSpeed = 2;
    score = journeyLength();
    startingReward = score;
    winner = false;
    shadesEquipped = false;
    nightTarget = 0;
    shake = 0;
    passRate = 1;
    combo = 0;
    timers = {
        second: 1, obstacle: 1.5, hump: randomBetween(6, 12),
        shades: randomBetween(20, 50), rainbow: randomBetween(15, 40)
    };

    player.lane = 1;
    player.x = player.y = player.z = 0;
    player.velocityY = 0;
    player.onFloor = true;
    player.bump = 0;
    player.flash = 0;
    player.hit = null;
    player.shades.visible = false;
    player.stars.visible = false;
    player.model.visible = true;
    player.tumble.rotation.set(0, 0, 0);
    player.tumble.scale.setScalar(1);
    player.group.rotation.set(0, 0, 0);
    glowPlayer(null);

    messageText.textContent = '';
    hudButton.classList.add('hidden');
    hudButton.blur();
    startMusic();
}

function countGameTime() {
    if (gameState === 'during') gameClock += 1;

    // the meeting gets a second closer whether or not anyone is playing
    if (score > 0 && gameState !== 'after') score -= 1;

    // speed the game up as it goes on
    if (gameState === 'during' && gameClock > 0 && gameClock % gameSpeedUpInterval === 0) {
        platformSpeed = Math.min(maxPlatformSpeed, platformSpeed + gameSpeedUpFactor);
        passRate = Math.min(2, passRate + 0.05);
        playSound('speedUp');
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
    // flat (lies in the road: only a hedgehog on the ground falls in),
    // jumpable (can the hedgehog clear it?), tween (animation), score (seconds knocked off)
    let obstacles = [
        { name: 'cactusS', speedFactor: 1, width: 1.2, jumpable: true, tween: false, score: 3600 },
        { name: 'flamingo', speedFactor: 1.3, width: 1.5, jumpable: false, tween: 'wobble', score: 3600 },
        { name: 'crab', speedFactor: 0.8, width: 1.3, jumpable: true, tween: 'leftright', score: 3600 },
        { name: 'pothole', speedFactor: 1, width: 1.5, jumpable: true, flat: true, tween: false, score: 1800 },
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
            lane = fairLane(lane, obstacles[4]);
            renderObstacle({ ...obstacles[4], score: chosenObstacle.score, lane: lane });
            [0, 1, 2].filter((l) => l !== lane).forEach((l) => {
                renderObstacle({ ...obstacles[0], score: 0, lane: l });
            });
            break;
        case 'pothole': {
            // holes open up in flat road only, never on a hump
            const flatLanes = [0, 1, 2].filter((l) => !humps.some((hump) =>
                hump.lane === l && Math.abs(hump.z + spawnDistance) < hump.length / 2 + 3));
            if (flatLanes.length === 0) break;
            renderObstacle({ ...chosenObstacle, lane: flatLanes[randomBetween(0, flatLanes.length - 1, true)] });
            break;
        }
        case 'crab':
            // now and then a crab scuttles the whole way across the road and back
            if (Math.random() < 0.4) chosenObstacle = { ...chosenObstacle, tween: 'crossing', lane: 1, score: 5400 };
            else chosenObstacle = { ...chosenObstacle, lane: lane };
            renderObstacle(chosenObstacle);
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
    const card = obs.flat ? makePothole(obs.width) : makeCard(obs.name, obs.width, { opacity: obs.tween === 'appear' ? 0 : 1 });
    const shadow = makeShadow(obs.width * 0.9);
    shadow.visible = !obs.flat;
    group.add(card);

    const obstacle = {
        parameters: obs,
        group, card, shadow,
        baseX: obs.x !== undefined ? obs.x : lanes[obs.lane],
        x: 0,
        y: obs.flyHeight || (obs.flat ? 0.02 : 0),   // height above the road
        ground: 0,                                   // height of the road beneath it
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
    obstacle.ground = groundHeight(obstacle.x, obstacle.z);

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
        case 'crossing':
            // from one edge of the road to the other
            obstacle.x = Math.sin(t * 2.2) * laneWidth * 1.15;
            card.scale.x = Math.cos(t * 2.2) > 0 ? -1 : 1;
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

    // follow the road up and over any hump
    const ground = groundHeight(obstacle.x, obstacle.z);
    obstacle.ground += (ground - obstacle.ground) * Math.min(1, dt * 18);

    obstacle.group.position.set(obstacle.x, obstacle.ground, obstacle.z);
    card.position.y = obstacle.y + hop;
    obstacle.shadow.position.set(obstacle.x, obstacle.ground + 0.03, obstacle.z);
    liftShadow(obstacle.shadow, obstacle.y + hop);
}

function collides(obstacle) {
    if (obstacle.parameters.flat) {
        // a pothole only catches a hedgehog with its feet on the road
        if (obstacle.z < -0.75 || obstacle.previousZ > 0.75) return false;
        if (Math.abs(obstacle.x - player.x) > obstacle.width * 0.33 + 0.15) return false;
        return player.y - obstacle.ground < 0.12;
    }
    // did the obstacle sweep through the hedgehog's slice of the track this frame?
    if (obstacle.z < -hitDepth || obstacle.previousZ > hitDepth) return false;
    if (Math.abs(obstacle.x - player.x) > obstacle.width * 0.32 + player.halfWidth) return false;
    if (obstacle.parameters.name === 'cyanHeart') return true; // there is no missing the heart
    // the artwork has soft edges, so the boxes are a little smaller than the pictures
    const bottom = obstacle.ground + obstacle.y + obstacle.height * 0.1;
    const top = obstacle.ground + obstacle.y + obstacle.height * 0.78;
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
        playerCollisionByee(obstacle);
        messageText.textContent = 'Journey Over! Only ' + convertSecondsIntoText(score) + ' to go to Hedgeheart';
    }

    hudButton.textContent = 'Play again?';
    hudButton.classList.remove('hidden');
}

function playerCollisionByee(obstacle) {
    stopMusic();
    if (obstacle.parameters.flat) {
        // down the hole
        player.hit = { type: 'hole', age: 0, x: obstacle.x };
        player.velocityY = 2;
        burst('dust', obstacle.x, 0.2, 0, 14, 2.5);
        shake = 0.2;
        playSound('hole');
        return;
    }

    // knocked into the air, head over heels
    player.hit = {
        type: 'knock', age: 0, bounces: 0, resting: false, spin: 13,
        velocityX: THREE.MathUtils.clamp((player.x - obstacle.x) * 2, -1.5, 1.5),
        velocityZ: 1.2
    };
    player.velocityY = 8.5;
    glowPlayer(0xaa0000); // flash red
    const y = player.y + 0.6;
    burst('spine', player.x, y, 0, 14, 5);
    burst('star', player.x, y, 0, 7, 4);
    burst('dust', player.x, player.y + 0.1, 0, 8, 2.5);
    shake = 0.5;
    const flash = document.getElementById('hud-flash');
    flash.classList.remove('on');
    void flash.offsetWidth; // restart the animation
    flash.classList.add('on');
    playSound('hit');
}

function updateHitAnimation(dt) {
    const hit = player.hit, tumble = player.tumble;
    hit.age += dt;

    if (hit.type === 'hole') {
        // slide to the middle of the hole and drop out of sight, spinning
        player.velocityY -= gravity * dt;
        player.y += player.velocityY * dt;
        player.x += (hit.x - player.x) * Math.min(1, dt * 10);
        tumble.rotation.y += 11 * dt;
        tumble.scale.setScalar(Math.max(0.35, 1 - hit.age * 1.1));
        player.legs.forEach((leg, i) => leg.rotation.x = Math.sin(elapsed * 30 + i * 1.6) * 0.9);
        if (player.y < -2.5 && player.model.visible) {
            player.model.visible = false;
            burst('dust', hit.x, 0.1, 0, 8, 1.5);
            burst('star', hit.x, 0.3, 0, 5, 3.5);
            playSound('thud', { level: 0.6 });
        }
        return;
    }

    if (hit.age < 0.07) {
        tumble.scale.set(1.3, 0.7, 0.8); // squashed against the obstacle for an instant
        return;
    }
    tumble.scale.setScalar(1);
    if (hit.age > 0.4 && !hit.cooled) {
        hit.cooled = true;
        glowPlayer(null);
    }

    const ground = groundHeight(player.x, player.z);
    if (!hit.resting) {
        player.velocityY -= gravity * dt;
        player.y += player.velocityY * dt;
        player.x += hit.velocityX * dt;
        player.z += hit.velocityZ * dt;
        tumble.rotation.x += hit.spin * dt;
        player.legs.forEach((leg, i) => leg.rotation.x = Math.sin(elapsed * 25 + i * 1.6) * 0.9);
        if (player.y <= ground) {
            player.y = ground;
            burst('dust', player.x, ground + 0.1, player.z, 6, 1.8);
            if (hit.bounces < 2) {
                // bounce, a little lower each time
                hit.bounces++;
                player.velocityY = hit.bounces === 1 ? 5 : 2.6;
                hit.velocityX *= 0.5;
                hit.velocityZ *= 0.5;
                hit.spin *= 0.6;
                shake = Math.max(shake, 0.18 / hit.bounces);
                playSound('thud', { level: 0.5 / hit.bounces });
            } else {
                hit.resting = true;
                hit.restedAt = hit.age;
                playSound('thud', { level: 0.2 });
            }
        }
    } else {
        // flat on its back, legs waving, seeing stars
        const rested = hit.age - hit.restedAt;
        const upsideDown = Math.round((tumble.rotation.x - Math.PI) / (Math.PI * 2)) * Math.PI * 2 + Math.PI;
        tumble.rotation.x += (upsideDown - tumble.rotation.x) * Math.min(1, dt * 10);
        tumble.rotation.z = Math.sin(rested * 7) * 0.25 * Math.exp(-rested * 1.5); // rock to a stop
        player.y = ground;
        player.legs.forEach((leg, i) => leg.rotation.x = Math.sin(elapsed * 9 + i * 1.9) * 0.45);

        player.stars.visible = true;
        player.stars.position.set(player.x, player.y + 1.45, player.z);
        player.stars.children.forEach((star, i) => {
            const angle = elapsed * 4 + i * Math.PI * 2 / 3;
            star.position.set(Math.cos(angle) * 0.6, Math.sin(angle * 2) * 0.06, Math.sin(angle) * 0.6);
            star.rotation.y = -angle;
        });
    }
}

function playerCollisionWinner() {
    glowPlayer(0x6a5000); // golden hedgehog
    stopMusic();
    playSound('win');

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
    const ground = groundHeight(lanes[shades.lane], shades.z);
    shades.card.position.y = ground + 0.35 + Math.sin(shades.age * 5) * 0.15; // bob enticingly
    shades.shadow.position.y = ground + 0.03;

    const reachable = Math.abs(shades.z) < 0.7 && Math.abs(lanes[shades.lane] - player.x) < 1 && player.y - ground < 1.3;
    if (reachable) {
        shadesEquipped = true;
        player.shades.visible = true;
        player.flash = 0.8;
        burst('star', player.x, player.y + 0.8, 0, 8, 3.5);
        playSound('shades');
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
    const top = obstacle.ground + obstacle.y + obstacle.height;
    chip.position.set(obstacle.x, THREE.MathUtils.clamp(top + 0.5, 1.9, 3.6), 0.4);
    chip.userData.age = 0;
    scene.add(chip);
    chips.push(chip);
    playSound('pass', { pan: obstacle.x / (laneWidth * 1.5) });
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

// ---------------------------------------------------------------- sound
// Everything goes through the Web Audio API. The original recordings are kept
// and layered with synthesised tones, panned across the road and given a
// little reverb. The music is sequenced live, so it can speed up with the game.

let audio = null;                // made on the first key press or tap: browsers insist
let muted = localStorage.getItem('j2hh_muted') === '1';
let passRate = 1;                // the passing sound creeps up in pitch as the game speeds up
let combo = 0, lastPassAt = -10; // quick successive passes climb a scale

function setupSound() {
    const muteButton = document.getElementById('hud-mute');
    const showMute = () => muteButton.textContent = muted ? '\u{1F507}' : '\u{1F50A}';
    const toggleMute = () => {
        muted = !muted;
        localStorage.setItem('j2hh_muted', muted ? '1' : '0');
        if (audio) audio.master.gain.setTargetAtTime(muted ? 0 : 1, audio.ctx.currentTime, 0.02);
        showMute();
    };
    showMute();
    muteButton.addEventListener('click', () => { toggleMute(); muteButton.blur(); });
    window.addEventListener('keydown', (event) => { if (event.code === 'KeyM' && !event.repeat) toggleMute(); });

    ['keydown', 'pointerdown'].forEach((type) => window.addEventListener(type, initAudio, true));
    // no music from a tab nobody is looking at
    document.addEventListener('visibilitychange', () => {
        if (!audio) return;
        if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume();
    });
}

function initAudio() {
    if (audio) {
        if (audio.ctx.state === 'suspended' && !document.hidden) audio.ctx.resume();
        return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    const ctx = new Context();
    const gain = (level) => { const node = ctx.createGain(); node.gain.value = level; return node; };
    const filter = (type, frequency) => {
        const node = ctx.createBiquadFilter();
        node.type = type;
        node.frequency.value = frequency;
        return node;
    };

    // master -> limiter -> speakers
    const master = gain(muted ? 0 : 1);
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -12;
    limiter.ratio.value = 8;
    const meter = ctx.createAnalyser();
    master.connect(limiter);
    limiter.connect(ctx.destination);
    limiter.connect(meter);

    // a small room for everything to echo in
    const seconds = 1.8, rate = ctx.sampleRate;
    const impulse = ctx.createBuffer(2, rate * seconds, rate);
    for (let channel = 0; channel < 2; channel++) {
        const data = impulse.getChannelData(channel);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3);
    }
    const reverb = ctx.createConvolver();
    reverb.buffer = impulse;
    const reverbLevel = gain(0.5);
    reverb.connect(reverbLevel);
    reverbLevel.connect(master);

    const effects = gain(0.8);
    const effectsEcho = gain(0.3);
    effects.connect(master);
    effects.connect(effectsEcho);
    effectsEcho.connect(reverb);

    // the music sits well under the effects, and can be muffled when the game ends
    const music = gain(0);
    const musicTone = filter('lowpass', 16000);
    const musicEcho = gain(0.12);
    const bass = filter('lowpass', 650);
    const stabs = filter('lowpass', 2200);
    music.connect(musicTone);
    musicTone.connect(master);
    musicTone.connect(musicEcho);
    musicEcho.connect(reverb);
    bass.connect(music);
    stabs.connect(music);

    const noise = ctx.createBuffer(1, rate, rate);
    const noiseData = noise.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;

    audio = { ctx, master, meter, effects, music, musicTone, bass, stabs, noise, samples: {}, playing: false, step: 0, nextStepAt: 0 };

    ['obstacleHit', 'obstaclePass', 'playerJump', 'playerLR', 'winner'].forEach((name) => {
        fetch('assets/sounds/' + name + '.mp3')
            .then((response) => response.arrayBuffer())
            .then((data) => ctx.decodeAudioData(data))
            .then((buffer) => audio.samples[name] = buffer)
            .catch(() => { });
    });

    setInterval(scheduleMusic, 25);
    if (gameState === 'during') startMusic();
}

function hz(midiNote) {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
}

// Send a sound on its way, placed left or right across the road
function sendOut(node, o) {
    if (o.pan && audio.ctx.createStereoPanner) {
        const panner = audio.ctx.createStereoPanner();
        panner.pan.value = THREE.MathUtils.clamp(o.pan, -1, 1);
        node.connect(panner);
        node = panner;
    }
    node.connect(o.out || audio.effects);
}

function envelope(o, at) {
    const env = audio.ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(o.level, at + (o.attack || 0.006));
    env.gain.exponentialRampToValueAtTime(0.0001, at + o.length);
    return env;
}

// A pitched note: { type, from, to (slide to this pitch), delay, at, length, level, pan, out }
function tone(o) {
    const at = o.at || audio.ctx.currentTime + (o.delay || 0);
    const oscillator = audio.ctx.createOscillator();
    oscillator.type = o.type || 'sine';
    oscillator.frequency.setValueAtTime(o.from, at);
    if (o.to) oscillator.frequency.exponentialRampToValueAtTime(o.to, at + o.length);
    const env = envelope(o, at);
    oscillator.connect(env);
    sendOut(env, o);
    oscillator.start(at);
    oscillator.stop(at + o.length + 0.05);
}

// A burst of filtered noise: { filter, from, to, q, delay, at, length, level, pan, out }
function hiss(o) {
    const at = o.at || audio.ctx.currentTime + (o.delay || 0);
    const source = audio.ctx.createBufferSource();
    source.buffer = audio.noise;
    source.loop = true;
    const shape = audio.ctx.createBiquadFilter();
    shape.type = o.filter || 'bandpass';
    shape.Q.value = o.q || 1;
    shape.frequency.setValueAtTime(o.from, at);
    if (o.to) shape.frequency.exponentialRampToValueAtTime(o.to, at + o.length);
    const env = envelope(o, at);
    source.connect(shape);
    shape.connect(env);
    sendOut(env, o);
    source.start(at, Math.random() * 0.5);
    source.stop(at + o.length + 0.05);
}

// One of the original recordings
function sample(name, level, o = {}) {
    const buffer = audio.samples[name];
    if (!buffer) return;
    const source = audio.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = o.rate || 1;
    const volume = audio.ctx.createGain();
    volume.gain.value = level;
    source.connect(volume);
    sendOut(volume, o);
    source.start();
}

function playSound(name, o = {}) {
    if (!audio || audio.ctx.state !== 'running') return;
    switch (name) {
        case 'jump':
            sample('playerJump', 0.4);
            tone({ from: 280, to: 740, length: 0.17, level: 0.22 });
            hiss({ filter: 'highpass', from: 2500, to: 6000, length: 0.12, level: 0.04 });
            break;
        case 'land':
            tone({ from: 150, to: 55, length: 0.1, level: 0.3 });
            hiss({ filter: 'lowpass', from: 900, to: 200, length: 0.07, level: 0.08 });
            break;
        case 'lane':
            // a swish that travels the way the hedgehog does
            sample('playerLR', 0.12, o);
            hiss({ from: o.pan > 0 ? 500 : 2600, to: o.pan > 0 ? 2600 : 500, q: 2, length: 0.14, level: 0.2, pan: o.pan });
            break;
        case 'bump':
            tone({ type: 'square', from: 120, to: 70, length: 0.09, level: 0.15 });
            tone({ from: 95, to: 50, length: 0.13, level: 0.4 });
            break;
        case 'pass': {
            // a three-note chime; passes in quick succession climb a scale
            const scale = [72, 74, 76, 79, 81, 84, 86, 88];
            combo = elapsed - lastPassAt < 2.5 ? Math.min(combo + 1, scale.length - 1) : 0;
            lastPassAt = elapsed;
            const note = scale[combo];
            sample('obstaclePass', 0.3, { rate: passRate, pan: o.pan });
            tone({ type: 'triangle', from: hz(note), length: 0.35, level: 0.2, pan: o.pan });
            tone({ from: hz(note + 7), delay: 0.07, length: 0.4, level: 0.13, pan: o.pan });
            tone({ from: hz(note + 12), delay: 0.14, length: 0.5, level: 0.08, pan: o.pan });
            break;
        }
        case 'hit':
            sample('obstacleHit', 0.6);
            tone({ from: 160, to: 38, length: 0.4, level: 0.9 });
            tone({ type: 'square', from: 95, to: 45, length: 0.18, level: 0.2 });
            hiss({ filter: 'lowpass', from: 2500, to: 150, length: 0.3, level: 0.5 });
            // and a sorry little tune to finish
            [64, 63, 62, 61].forEach((note, i) => tone({
                type: 'triangle', from: hz(note), to: hz(note - (i === 3 ? 3 : 0.4)),
                delay: 0.5 + i * 0.24, length: i === 3 ? 0.6 : 0.22, level: 0.16
            }));
            break;
        case 'hole':
            tone({ from: 820, to: 90, length: 0.55, level: 0.28 }); // a falling whistle
            hiss({ filter: 'lowpass', from: 1200, to: 200, length: 0.2, level: 0.25 });
            [60, 58, 55].forEach((note, i) => tone({
                type: 'triangle', from: hz(note), delay: 0.85 + i * 0.2, length: i === 2 ? 0.5 : 0.18, level: 0.16
            }));
            break;
        case 'thud':
            tone({ from: 130, to: 48, length: 0.14, level: o.level || 0.4 });
            hiss({ filter: 'lowpass', from: 900, to: 200, length: 0.08, level: (o.level || 0.4) * 0.3 });
            break;
        case 'shades':
            [84, 88, 91, 96, 100].forEach((note, i) => tone({ from: hz(note), delay: i * 0.06, length: 0.3, level: 0.14 }));
            break;
        case 'win':
            sample('winner', 0.8);
            [72, 76, 79, 84, 88, 91].forEach((note, i) => tone({
                type: 'triangle', from: hz(note), delay: i * 0.09, length: 0.5, level: 0.16
            }));
            break;
        case 'speedUp':
            tone({ type: 'triangle', from: hz(79), length: 0.12, level: 0.06 });
            tone({ type: 'triangle', from: hz(84), delay: 0.1, length: 0.16, level: 0.06 });
            break;
    }
}

// The tune: four bars of C, A minor, F and G, a bouncing bass, off-beat chord
// stabs and a lead line that comes and goes.
const musicChords = [
    { root: 36, notes: [60, 64, 67] },
    { root: 33, notes: [57, 60, 64] },
    { root: 29, notes: [53, 57, 60] },
    { root: 31, notes: [55, 59, 62] }
];
const musicLead = [
    [76, 0, 79, 0, 84, 0, 79, 0, 76, 0, 79, 0, 81, 79, 0, 0],
    [81, 0, 84, 0, 88, 0, 84, 0, 81, 0, 84, 0, 86, 84, 0, 0],
    [77, 0, 81, 0, 84, 0, 81, 0, 77, 0, 81, 0, 84, 81, 0, 0],
    [79, 0, 83, 0, 86, 0, 83, 0, 86, 0, 84, 0, 83, 0, 79, 0]
];

function startMusic() {
    if (!audio) return;
    const now = audio.ctx.currentTime;
    audio.playing = true;
    audio.step = 0;
    audio.nextStepAt = now + 0.08;
    audio.musicTone.frequency.cancelScheduledValues(now);
    audio.musicTone.frequency.setValueAtTime(16000, now);
    audio.music.gain.cancelScheduledValues(now);
    audio.music.gain.setValueAtTime(0.0001, now);
    audio.music.gain.linearRampToValueAtTime(0.36, now + 0.4);
}

function stopMusic() {
    if (!audio || !audio.playing) return;
    // the band winds down as if someone had thrown a blanket over it
    const now = audio.ctx.currentTime;
    audio.playing = false;
    audio.musicTone.frequency.setValueAtTime(audio.musicTone.frequency.value, now);
    audio.musicTone.frequency.exponentialRampToValueAtTime(250, now + 0.4);
    audio.music.gain.setValueAtTime(audio.music.gain.value, now);
    audio.music.gain.linearRampToValueAtTime(0.0001, now + 0.9);
}

// Queue up the notes that fall in the next fraction of a second
function scheduleMusic() {
    if (!audio || !audio.playing || audio.ctx.state !== 'running') return;
    const now = audio.ctx.currentTime;
    if (audio.nextStepAt < now) audio.nextStepAt = now + 0.03; // catching up after a pause
    while (audio.nextStepAt < now + 0.15) {
        playMusicStep(audio.step, audio.nextStepAt);
        const beatsPerMinute = 118 + (platformSpeed - 2) * 12; // the faster the game, the faster the band
        audio.nextStepAt += 60 / beatsPerMinute / 4;
        audio.step++;
    }
}

function playMusicStep(step, at) {
    const bar = Math.floor(step / 16), s = step % 16;
    const chord = musicChords[bar % 4];
    const out = audio.music;

    // drums: kick on the beat, snare on two and four, hi-hat between
    if (s % 4 === 0) tone({ from: 150, to: 45, at, length: 0.14, level: 0.45, out });
    if (s === 4 || s === 12) {
        hiss({ from: 1800, q: 0.8, at, length: 0.11, level: 0.16, out });
        tone({ type: 'triangle', from: 200, to: 120, at, length: 0.08, level: 0.1, out });
    }
    if (s % 4 === 2) hiss({ filter: 'highpass', from: 7000, at, length: 0.04, level: 0.05, out });
    else if (s % 2 === 1 && platformSpeed >= 3) hiss({ filter: 'highpass', from: 8000, at, length: 0.025, level: 0.025, out });

    // bass: bouncing between the root and its octave
    if (s % 2 === 0) {
        tone({ type: 'sawtooth', from: hz(chord.root + (s % 4 === 2 ? 12 : 0)), at, length: 0.17, level: 0.2, out: audio.bass });
    }
    // chords stabbed on the off-beat
    if (s % 4 === 2) {
        chord.notes.forEach((note) => tone({ type: 'square', from: hz(note), at, length: 0.09, level: 0.03, out: audio.stabs }));
    }
    // the lead sits out the first four bars, then plays every other four
    const note = musicLead[bar % 4][s];
    if (note && Math.floor(bar / 4) % 2 === 1) {
        tone({ type: 'triangle', from: hz(note), at, length: 0.2, level: 0.07, out });
    }
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

    // every so often one lane of the road rears up
    timers.hump -= dt;
    if (timers.hump <= 0) {
        if (!winner) addHump();
        timers.hump = randomBetween(9, 20);
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
    updateHumps(dt, speed);
    updateParticles(dt);

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
    const clamp = THREE.MathUtils.clamp;

    if (gameState === 'during') {
        // change lanes, unless the next lane is a ledge too high to step onto
        if (inputState.left || inputState.right) {
            const direction = inputState.left ? -1 : 1;
            const lane = clamp(player.lane + direction, 0, 2);
            if (lane !== player.lane) {
                if (groundHeight(lanes[lane], 0) - player.y > stepHeight) {
                    player.bump = direction * 0.45;
                    shake = Math.max(shake, 0.08);
                    playSound('bump');
                } else {
                    player.lane = lane;
                    playSound('lane', { pan: direction * 0.6 });
                }
            }
        }
        if (inputState.jump && player.onFloor) {
            player.velocityY = jumpVelocity;
            player.onFloor = false;
            playSound('jump');
        } else if (inputState.down && !player.onFloor) {
            player.velocityY = Math.min(player.velocityY, -12); // pull jump down
        }
    }
    inputState.left = false;
    inputState.right = false;

    let bob = 0;
    if (player.hit) {
        updateHitAnimation(dt);
    } else if (gameState === 'after') {
        // victory bounce, turning round to show off
        player.y = groundHeight(player.x, 0) + Math.abs(Math.sin(elapsed * 5)) * 1.2;
        player.tumble.rotation.set(0, elapsed * 3, 0);
    } else {
        const dx = lanes[player.lane] - player.x;
        player.x += dx * Math.min(1, dt * 11);
        player.bump *= Math.exp(-dt * 12);
        // the body turns towards the new lane and leans into the corner
        const turn = -clamp(dx * 0.8 + player.bump, -1, 1);
        player.group.rotation.z = -dx * 0.1 - player.bump * 0.4;

        // stand on the road, wherever it has got to
        const ground = groundHeight(player.x, 0);
        const wasOnFloor = player.onFloor;
        const fallSpeed = player.velocityY;
        player.velocityY -= gravity * dt;
        player.y += player.velocityY * dt;
        if (player.y <= ground) {
            player.y = ground;
            player.velocityY = 0;
            player.onFloor = true;
            if (!wasOnFloor && fallSpeed < -4) {
                burst('dust', player.x, ground + 0.05, 0, 5, 1.5);
                playSound('land');
            }
        } else if (wasOnFloor && player.velocityY <= 0 && player.y - ground < 0.4) {
            // keep its feet on the road down the far side of a hump
            player.y = ground;
            player.velocityY = 0;
        } else {
            player.onFloor = false;
        }

        // Legs: diagonal pairs swing together while running, and stretch out in the air
        let pitch;
        if (player.onFloor) {
            player.stride += dt * (9 + platformSpeed * 3.5);
            const swing = Math.sin(player.stride) * 0.95;
            player.legs.forEach((leg, i) => leg.rotation.x = (i === 0 || i === 3) ? swing : -swing);
            bob = Math.abs(Math.cos(player.stride)) * 0.07;
            // nose up the ramp, nose down the far side
            const slope = (groundHeight(player.x, -0.6) - groundHeight(player.x, 0.6)) / 1.2;
            pitch = Math.atan(slope) + Math.sin(player.stride * 2) * 0.04;
        } else {
            player.legs.forEach((leg, i) => {
                const reach = i < 2 ? 0.9 : -0.9;
                leg.rotation.x += (reach - leg.rotation.x) * Math.min(1, dt * 14);
            });
            pitch = clamp(player.velocityY * 0.035, -0.4, 0.4); // nose up on the way up
        }
        player.tumble.rotation.set(pitch, turn, 0);
    }

    player.group.position.set(player.x + (player.hit ? 0 : player.bump), player.y + bob, player.z);
    const floor = player.hit && player.hit.type === 'hole' ? 0 : groundHeight(player.x, player.z);
    player.shadow.position.set(player.x, floor + 0.03, player.z);
    player.shadow.visible = player.y > floor - 0.3;
    liftShadow(player.shadow, Math.max(0, player.y - floor));

    // blink after picking up a costume
    if (player.flash > 0) {
        player.flash -= dt;
        player.model.visible = player.flash <= 0 || Math.floor(player.flash * 10) % 2 === 0;
    }

    // the camera drifts after the hedgehog, rides up the humps with it, and shakes when it is hit
    cameraX += (player.x * 0.45 - cameraX) * Math.min(1, dt * 6);
    const lift = player.hit ? 0 : groundHeight(player.x, 0) * 0.6;
    cameraLift += (lift - cameraLift) * Math.min(1, dt * 4);
    shake *= Math.exp(-dt * 7);
    camera.position.set(
        cameraX + (Math.random() - 0.5) * shake,
        3.7 + cameraLift + (Math.random() - 0.5) * shake,
        6.8);
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
    get humps() { return humps; },
    get audio() { return audio; },
    addHump, addObstacle, renderObstacle,
    inputState,
    setScore(value) { score = value; },
    setSpeed(value) { platformSpeed = value; updateDayNightCycle(); },
    gameStatusResponse
};
